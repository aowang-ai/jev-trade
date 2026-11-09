import { assertImportAuth } from "./admin";
import { config } from "./config";
import type { HistoryStore } from "./history-store";
import { persistHistoryBundle } from "./r2-history";
import { clipHistory, clipSnapshotTape, clipTape, SNAPSHOT_HISTORY, TAPE_MIDS } from "./snapshot";
import type { BlockEvent, Fill, Meta, PricePoint, Quote } from "./types";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
const SNAP_MS = 400;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

function jsonMaybeGzip(req: Request, body: unknown, status = 200) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const accept = req.headers.get("accept-encoding") ?? "";
  if (accept.includes("gzip")) {
    return new Response(Bun.gzipSync(raw), {
      status,
      headers: {
        ...CORS,
        "content-type": "application/json",
        "content-encoding": "gzip",
        vary: "accept-encoding",
        "cache-control": "no-store",
      },
    });
  }
  return new Response(raw, {
    status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
  });
}

export type SleeveView = { coin: string; history: () => BlockEvent[]; tape: () => PricePoint[] };

export type ServerOpts = {
  history: HistoryStore;
  onHistoryImported?: () => Promise<void>;
};

/** GET /snapshot, GET /history, GET /tape, GET /events SSE */
export function startServer(meta: Meta, sleeves: SleeveView[], opts: ServerOpts) {
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const enc = new TextEncoder();
  const invalidateSnap = () => {
    snapCache = null;
  };
  const send = (c: ReadableStreamDefaultController<Uint8Array>, type: string, data: unknown) => {
    try { c.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { clients.delete(c); }
  };
  setInterval(() => clients.forEach((c) => send(c, "ping", Date.now())), 15_000);

  const snapshotClip = config.restorationMode ? Math.min(config.historySize, 500) : SNAPSHOT_HISTORY;

  const historyByCoin = () => {
    const out: Record<string, BlockEvent[]> = {};
    for (const s of sleeves) out[s.coin] = s.history();
    return out;
  };
  const tapeByCoin = () => {
    const out: Record<string, PricePoint[]> = {};
    for (const s of sleeves) out[s.coin] = clipTape(s.tape(), TAPE_MIDS);
    return out;
  };
  const snapshotBody = () => {
    const history: Record<string, BlockEvent[]> = {};
    const tape: Record<string, PricePoint[]> = {};
    for (const s of sleeves) {
      history[s.coin] = clipHistory(s.history(), snapshotClip);
      tape[s.coin] = clipSnapshotTape(s.tape());
    }
    return { ...meta, historyByCoin: history, tapeByCoin: tape };
  };
  const latestByCoin = () => {
    const out: Record<string, BlockEvent | null> = {};
    for (const s of sleeves) {
      const hist = s.history();
      let latest: BlockEvent | null = hist.at(-1) ?? null;
      if (config.restorationMode) {
        for (let i = hist.length - 1; i >= 0; i--) {
          const e = hist[i]!;
          if (e.decision && !e.decision.late) {
            latest = e;
            break;
          }
        }
      }
      out[s.coin] = latest;
    }
    return out;
  };

  type SnapCache = { at: number; json: string; event: Uint8Array };
  let snapCache: SnapCache | null = null;
  const snap = (): SnapCache => {
    const now = Date.now();
    if (snapCache && now - snapCache.at < SNAP_MS) return snapCache;
    const body = JSON.stringify(snapshotBody());
    snapCache = { at: now, json: body, event: enc.encode(`event: snapshot\ndata: ${body}\n\n`) };
    return snapCache;
  };

  async function handleImport(req: Request): Promise<Response> {
    const denied = assertImportAuth(req);
    if (denied) return denied;
    const coinHint = req.headers.get("x-coin")?.trim() || undefined;
    const encoding = req.headers.get("content-encoding") ?? "";
    let text: string;
    const body = await req.arrayBuffer();
    if (encoding.includes("gzip")) {
      text = new TextDecoder().decode(Bun.gunzipSync(body));
    } else {
      text = new TextDecoder().decode(body);
    }
    const result = opts.history.mergeJsonl(text, coinHint);
    await opts.history.saveAll();
    invalidateSnap();
    if (config.historyPersistR2Key) {
      await persistHistoryBundle(config.historyPersistR2Key, opts.history.exportBundle());
    }
    await opts.onHistoryImported?.();
    return json({ ok: true, ...result, stats: opts.history.stats() });
  }

  Bun.serve({
    port: config.port,
    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;
      if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
      if (pathname === "/admin/import-history" && req.method === "POST") return handleImport(req);
      if (pathname === "/admin/import-status" && req.method === "GET") {
        const denied = assertImportAuth(req);
        if (denied) return denied;
        return json({ ok: true, stats: opts.history.stats(), meta: { restorationMode: meta.restorationMode } });
      }
      if (pathname === "/") return json({ ...meta, latestByCoin: latestByCoin() });
      if (pathname === "/snapshot") return jsonMaybeGzip(req, snap().json);
      if (pathname === "/history") return jsonMaybeGzip(req, historyByCoin());
      if (pathname === "/tape") return jsonMaybeGzip(req, tapeByCoin());
      if (pathname === "/events") {
        const lite = url.searchParams.get("lite") === "1";
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            clients.add(c);
            if (lite) send(c, "ready", meta.startedAt);
            else {
              try { c.enqueue(snap().event); } catch { clients.delete(c); }
            }
          },
          cancel(c) { clients.delete(c); },
        });
        return new Response(stream, { headers: { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
      }
      return json({ error: "not found" }, 404);
    },
  });

  const broadcast = (type: string, data: unknown) => clients.forEach((c) => send(c, type, data));
  return {
    broadcast: (e: BlockEvent) => broadcast("block", e),
    broadcastQuote: (coin: string, block: number, quote: Quote) => broadcast("quote", { coin, block, quote }),
    broadcastFill: (coin: string, block: number, fill: Fill, ts?: number) => broadcast("fill", { coin, block, fill, ts }),
    broadcastPrice: (coin: string, print: { ts: number; mid: number; bestBid: number; bestAsk: number; spreadBps: number }) =>
      broadcast("price", { coin, ...print }),
    invalidateSnapshot: invalidateSnap,
  };
}
