#!/usr/bin/env bun
/**
 * Coordinator import: stream JSONL from a local tarball or directory into the bot.
 * Does not delete or overwrite R2 archive source objects (e.g. mig1/public-history.tgz).
 *
 * Filename scopes rows (never invent coin on legacy events.jsonl):
 *   events.jsonl        → __legacy_unscoped__
 *   events-BTC.jsonl    → BTC (lines usually also include coin)
 *
 * Examples:
 *   wrangler r2 object get jev-trade-mig-archive/mig1/restore-history-sanitized.tar.gz --file=restore.tgz
 *   tar -xzf restore.tgz
 *
 *   bun run scripts/import-migration-archive.ts \
 *     --api https://bot.jev-trade.com \
 *     --token "$HISTORY_IMPORT_SECRET" \
 *     --dir ./history
 *
 *   bun run scripts/import-migration-archive.ts \
 *     --api https://bot.jev-trade.com \
 *     --token "$HISTORY_IMPORT_SECRET" \
 *     --tgz ./restore.tgz
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inferJsonlFileScope } from "../src/history-import";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function extractTgz(tgz: string, dest: string) {
  const proc = Bun.spawn(["tar", "-xzf", tgz, "-C", dest], { stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`tar extract failed: ${err.slice(0, 200)}`);
  }
}

async function collectJsonlFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(p: string) {
    for (const name of await readdir(p, { withFileTypes: true })) {
      const full = join(p, name.name);
      if (name.isDirectory()) await walk(full);
      else if (name.name.endsWith(".jsonl")) out.push(full);
    }
  }
  await walk(dir);
  return out.sort();
}

async function postJsonl(api: string, token: string, file: string, fileScope?: string) {
  const body = await Bun.file(file).text();
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": "application/x-ndjson",
  };
  if (fileScope) headers["x-file-scope"] = fileScope;
  const r = await fetch(`${api.replace(/\/+$/, "")}/admin/import-history`, { method: "POST", headers, body });
  const text = await r.text();
  if (!r.ok) throw new Error(`${file}: ${r.status} ${text.slice(0, 300)}`);
  return JSON.parse(text) as { imported: number; total: number; coins: string[] };
}

async function main() {
  const api = arg("--api");
  const token = arg("--token");
  const tgz = arg("--tgz");
  const dir = arg("--dir");
  const jsonl = arg("--jsonl");
  if (!api || !token) {
    console.error("usage: --api URL --token SECRET (--tgz path | --dir path | --jsonl path)");
    process.exit(1);
  }
  const files: { path: string; scope?: string }[] = [];
  if (jsonl) {
    if (!existsSync(jsonl)) throw new Error(`missing ${jsonl}`);
    files.push({ path: jsonl, scope: inferJsonlFileScope(jsonl) });
  } else if (dir) {
    if (!existsSync(dir)) throw new Error(`missing ${dir}`);
    for (const f of await collectJsonlFiles(dir)) {
      files.push({ path: f, scope: inferJsonlFileScope(f) });
    }
  } else if (tgz) {
    if (!existsSync(tgz)) throw new Error(`missing ${tgz}`);
    const extractDir = join(tmpdir(), `jev-import-${Date.now()}`);
    await mkdir(extractDir, { recursive: true });
    try {
      await extractTgz(tgz, extractDir);
      for (const f of await collectJsonlFiles(extractDir)) {
        files.push({ path: f, scope: inferJsonlFileScope(f) });
      }
    } finally {
      await rm(extractDir, { recursive: true, force: true });
    }
  } else {
    throw new Error("pass --tgz, --dir, or --jsonl");
  }
  if (!files.length) throw new Error("no .jsonl files found");
  let totalImported = 0;
  for (const f of files) {
    const res = await postJsonl(api, token, f.path, f.scope);
    totalImported += res.imported;
    console.log(`${f.path} scope=${f.scope ?? "none"}: imported ${res.imported} (total events ${res.total}) coins=${res.coins.join(",")}`);
  }
  const status = await fetch(`${api.replace(/\/+$/, "")}/admin/import-status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  console.log(await status.text());
  console.log(`done. newly merged rows: ${totalImported}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
