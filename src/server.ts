import { config } from "./config";
import { clipHistory, clipTape } from "./snapshot";
import type { BlockEvent, Fill, Meta, PricePoint, Quote } from "./types";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

export type SleeveView = { coin: string; history: () => BlockEvent[]; tape: () => PricePoint[] };

/** GET / snapshot, GET /history, GET /tape, GET /events SSE */
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
    for (const s of sleeves) out[s.coin] = s.tape();
    return out;
  };
  const snapshotBody = () => {
    const history: Record<string, BlockEvent[]> = {};
    const tape: Record<string, PricePoint[]> = {};
    for (const s of sleeves) {
      history[s.coin] = clipHistory(s.history());
      tape[s.coin] = clipTape(s.tape());
    }
    return { ...meta, historyByCoin: history, tapeByCoin: tape };
  };
  const latestByCoin = () => {
    const out: Record<string, BlockEvent | null> = {};
    for (const s of sleeves) out[s.coin] = s.history().at(-1) ?? null;
    return out;
  };

  Bun.serve({
    port: config.port,
    fetch(req) {
      const { pathname } = new URL(req.url);
      if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
      if (pathname === "/") return json({ ...meta, latestByCoin: latestByCoin() });
      if (pathname === "/history") return json(historyByCoin());
      if (pathname === "/tape") return json(tapeByCoin());
      if (pathname === "/events") {
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            clients.add(c);
            send(c, "snapshot", snapshotBody());
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
