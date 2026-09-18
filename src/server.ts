import { config } from "./config";
import { clipHistory, clipSnapshotTape, clipTape, TAPE_MIDS } from "./snapshot";
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

/** GET /snapshot, GET /history, GET /tape, GET /events SSE */
export function startServer(meta: Meta, sleeves: SleeveView[]) {
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const enc = new TextEncoder();
  const send = (c: ReadableStreamDefaultController<Uint8Array>, type: string, data: unknown) => {
    try { c.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { clients.delete(c); }
  };
  setInterval(() => clients.forEach((c) => send(c, "ping", Date.now())), 15_000);

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
      history[s.coin] = clipHistory(s.history());
      tape[s.coin] = clipSnapshotTape(s.tape());
    }
    return { ...meta, historyByCoin: history, tapeByCoin: tape };
  };
  const latestByCoin = () => {
    const out: Record<string, BlockEvent | null> = {};
    for (const s of sleeves) out[s.coin] = s.history().at(-1) ?? null;
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

  Bun.serve({
    port: config.port,
    fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;
      if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
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
  };
}
