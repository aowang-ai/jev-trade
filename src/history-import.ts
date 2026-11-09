import type { BlockEvent, PricePoint } from "./types";

export function blockEventKey(e: BlockEvent): string {
  return `${e.coin}:${e.block}:${e.ts}`;
}

export function dedupeSortEvents(events: BlockEvent[]): BlockEvent[] {
  const map = new Map<string, BlockEvent>();
  for (const e of events) {
    if (!e?.coin || typeof e.block !== "number" || typeof e.ts !== "number") continue;
    map.set(blockEventKey(e), e);
  }
  return [...map.values()].sort((a, b) => a.ts - b.ts || a.block - b.block);
}

export function dedupeSortTape(points: PricePoint[]): PricePoint[] {
  const out: PricePoint[] = [];
  const seen = new Set<string>();
  for (const p of points) {
    if (typeof p.ts !== "number" || typeof p.mid !== "number") continue;
    const k = p.fill
      ? `f:${p.ts}:${p.fill.side}:${p.fill.price}:${p.fill.size}:${p.fill.hash ?? ""}`
      : `m:${p.ts}:${p.mid}:${p.bar ?? ""}:${p.block ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function asNumber(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Normalize archive JSONL rows into wire BlockEvents (no fabrication). */
export function normalizeArchiveEvent(raw: unknown): BlockEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const coin = typeof o.coin === "string" ? o.coin : undefined;
  const block = asNumber(o.block);
  const ts = asNumber(o.ts ?? o.timestamp ?? o.time);
  const mid = asNumber(o.mid);
  if (!coin || block == null || ts == null || mid == null) return null;
  const event = raw as BlockEvent;
  return {
    ...event,
    coin,
    block,
    ts,
    mid,
    bestBid: asNumber(o.bestBid) ?? mid,
    bestAsk: asNumber(o.bestAsk) ?? mid,
    spreadBps: asNumber(o.spreadBps) ?? 0,
  };
}

export function normalizeArchiveTape(raw: unknown): PricePoint | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.kind === "block" || o.type === "block") return null;
  const ts = asNumber(o.ts ?? o.timestamp);
  const mid = asNumber(o.mid ?? o.close ?? o.price);
  if (ts == null || mid == null) return null;
  return raw as PricePoint;
}

export function parseJsonl(text: string): { events: BlockEvent[]; tape: PricePoint[] } {
  const events: BlockEvent[] = [];
  const tape: PricePoint[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const asTape = normalizeArchiveTape(parsed);
    if (asTape && !normalizeArchiveEvent(parsed)) {
      tape.push(asTape);
      continue;
    }
    const ev = normalizeArchiveEvent(parsed);
    if (ev) events.push(ev);
  }
  return { events: dedupeSortEvents(events), tape: dedupeSortTape(tape) };
}

/** Derive mid tape prints from imported block events when the archive has no separate tape file. */
export function tapeFromEvents(events: BlockEvent[]): PricePoint[] {
  const points: PricePoint[] = [];
  for (const e of events) {
    points.push({
      ts: e.ts,
      mid: e.mid,
      block: e.block,
    });
    if (e.fill) {
      points.push({
        ts: e.ts,
        mid: e.fill.price,
        fill: {
          side: e.fill.side,
          price: e.fill.price,
          size: e.fill.size,
          dir: e.fill.dir,
          hash: e.fill.txHash ?? undefined,
          closedPnl: e.fill.closedPnl,
          feeUsd: e.fill.feeUsd,
        },
      });
    }
  }
  return dedupeSortTape(points);
}

export function historicalThroughTs(events: BlockEvent[]): number | null {
  if (!events.length) return null;
  return events[events.length - 1]!.ts;
}
