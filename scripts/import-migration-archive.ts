#!/usr/bin/env bun
/**
 * Coordinator import: stream JSONL from a local .tgz (public-history) or .jsonl into the bot.
 * Does not delete or overwrite R2 archive objects (mig1/*).
 *
 * Examples:
 *   bun run scripts/import-migration-archive.ts \
 *     --api https://bot.jev-trade.com \
 *     --token "$HISTORY_IMPORT_SECRET" \
 *     --tgz ./public-history.tgz
 *
 *   bun run scripts/import-migration-archive.ts \
 *     --api https://bot.jev-trade.com \
 *     --token "$HISTORY_IMPORT_SECRET" \
 *     --jsonl ./btc.jsonl --coin BTC
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

async function postJsonl(api: string, token: string, file: string, coin?: string) {
  const body = await Bun.file(file).text();
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": "application/x-ndjson",
  };
  if (coin) headers["x-coin"] = coin;
  const r = await fetch(`${api.replace(/\/+$/, "")}/admin/import-history`, { method: "POST", headers, body });
  const text = await r.text();
  if (!r.ok) throw new Error(`${file}: ${r.status} ${text.slice(0, 300)}`);
  return JSON.parse(text) as { imported: number; total: number; coins: string[] };
}

async function main() {
  const api = arg("--api");
  const token = arg("--token");
  const tgz = arg("--tgz");
  const jsonl = arg("--jsonl");
  const coin = arg("--coin");
  if (!api || !token) {
    console.error("usage: --api URL --token SECRET (--tgz path | --jsonl path [--coin BTC])");
    process.exit(1);
  }
  const files: { path: string; coin?: string }[] = [];
  if (jsonl) {
    if (!existsSync(jsonl)) throw new Error(`missing ${jsonl}`);
    files.push({ path: jsonl, coin });
  } else if (tgz) {
    if (!existsSync(tgz)) throw new Error(`missing ${tgz}`);
    const dir = join(tmpdir(), `jev-import-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    try {
      await extractTgz(tgz, dir);
      for (const f of await collectJsonlFiles(dir)) {
        const base = f.split("/").pop() ?? "";
        const guess = base.replace(/\.jsonl$/i, "").replace(/.*[-_]/, "").toUpperCase();
        files.push({ path: f, coin: /^[A-Z]{2,6}$/.test(guess) ? guess : undefined });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } else {
    throw new Error("pass --tgz or --jsonl");
  }
  let totalImported = 0;
  for (const f of files) {
    const res = await postJsonl(api, token, f.path, f.coin);
    totalImported += res.imported;
    console.log(`${f.path}: imported ${res.imported} (total events ${res.total}) coins=${res.coins.join(",")}`);
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
