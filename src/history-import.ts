import type { BlockEvent, Decision, Fill, Position, PricePoint, Quote, Totals } from "./types";

/** Legacy `events.jsonl` rows have no coin; keep them out of per-sleeve streams. */
export const LEGACY_UNSCOPED_COIN = "__legacy_unscoped__";

export type ParseJsonlOptions = {
  /** From filename: `events.jsonl` → LEGACY_UNSCOPED_COIN, `events-BTC.jsonl` → BTC. */
  fileScope?: string;
};

export function inferJsonlFileScope(filename: string): string | undefined {
  const base = filename.split("/").pop() ?? filename;
  if (base === "events.jsonl") return LEGACY_UNSCOPED_COIN;
  const m = /^events-([A-Za-z0-9]+)\.jsonl$/i.exec(base);
  return m ? m[1]!.toUpperCase() : undefined;
}

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

function normalizeDecision(raw: unknown): Decision | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const p = d.probabilities;
  if (!p || typeof p !== "object") return null;
  const probs = p as Record<string, unknown>;
  const action = d.action === "buy" || d.action === "sell" || d.action === "hold" ? d.action : "hold";
  return {
    action,
    intent: typeof d.intent === "string" ? (d.intent as Decision["intent"]) : undefined,
    bias: typeof d.bias === "string" ? (d.bias as Decision["bias"]) : undefined,
    leverage: asNumber(d.leverage),
    probabilities: {
      buy: asNumber(probs.buy) ?? 0,
      sell: asNumber(probs.sell) ?? 0,
      hold: asNumber(probs.hold) ?? 0,
      long: asNumber(probs.long),
      short: asNumber(probs.short),
      open: asNumber(probs.open),
      close: asNumber(probs.close),
    },
    upIn10: asNumber(d.upIn10) ?? 0.5,
    latencyMs: asNumber(d.latencyMs) ?? 0,
    late: Boolean(d.late),
  };
}

function normalizeQuote(raw: unknown): Quote | null {
  if (raw == null) return null;
  if (typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  if (q.side !== "buy" && q.side !== "sell") return null;
  const status = q.status === "placed" || q.status === "reverted" || q.status === "sim" ? q.status : "sim";
  return {
    side: q.side,
    price: asNumber(q.price) ?? 0,
    size: asNumber(q.size) ?? 0,
    txHash: typeof q.txHash === "string" ? q.txHash : null,
    cancel: Array.isArray(q.cancel) ? (q.cancel as number[]) : [],
    status,
    orderId: asNumber(q.orderId) ?? null,
    capped: Boolean(q.capped),
    reduceOnly: Boolean(q.reduceOnly),
    unchanged: Boolean(q.unchanged),
    taker: Boolean(q.taker),
  };
}

function normalizeResting(raw: unknown): BlockEvent["resting"] {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    bidSz: asNumber(o.bidSz ?? o.bidMon) ?? 0,
    askSz: asNumber(o.askSz ?? o.askMon) ?? 0,
  };
}

function normalizePosition(raw: unknown): Position {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const side = o.side === "long" || o.side === "short" || o.side === "flat" ? o.side : "flat";
  return {
    side,
    size: asNumber(o.size) ?? 0,
    entryPrice: asNumber(o.entryPrice) ?? null,
    leverage: asNumber(o.leverage) ?? null,
    unrealizedUsd: asNumber(o.unrealizedUsd) ?? 0,
    unrealizedSz: asNumber(o.unrealizedSz ?? o.unrealizedMon) ?? 0,
  };
}

function normalizeTotals(raw: unknown): Totals {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    blocks: asNumber(o.blocks) ?? 0,
    decisions: asNumber(o.decisions) ?? 0,
    quotes: asNumber(o.quotes) ?? 0,
    fills: asNumber(o.fills) ?? 0,
    reverted: asNumber(o.reverted) ?? 0,
    lateBlocks: asNumber(o.lateBlocks) ?? 0,
    jevUsd: asNumber(o.jevUsd) ?? 0,
    gasSz: asNumber(o.gasSz ?? o.gasMon) ?? 0,
    gasUsd: asNumber(o.gasUsd) ?? 0,
    realizedUsd: asNumber(o.realizedUsd) ?? 0,
    pnlUsd: asNumber(o.pnlUsd) ?? 0,
    pnlSz: asNumber(o.pnlSz ?? o.pnlMon) ?? 0,
    pnlPct: asNumber(o.pnlPct) ?? 0,
  };
}

function resolveCoin(lineCoin: unknown, fileScope?: string): string | undefined {
  if (typeof lineCoin === "string" && lineCoin.trim()) return lineCoin.trim().toUpperCase();
  if (!fileScope) return undefined;
  return fileScope;
}

/** Normalize archive JSONL rows into wire BlockEvents (no fabricated coin except scoped file import). */
export function normalizeArchiveEvent(raw: unknown, fileScope?: string): BlockEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const block = asNumber(o.block);
  const ts = asNumber(o.ts ?? o.timestamp ?? o.time);
  const mid = asNumber(o.mid);
  const coin = resolveCoin(o.coin, fileScope);
  if (!coin || block == null || ts == null || mid == null) return null;

  const fillRaw = o.fill;
  let fill: Fill | null = null;
  if (fillRaw && typeof fillRaw === "object") {
    const f = fillRaw as Record<string, unknown>;
    if (f.side === "buy" || f.side === "sell") {
      fill = {
        side: f.side,
        size: asNumber(f.size) ?? 0,
        price: asNumber(f.price) ?? mid,
        txHash: typeof f.txHash === "string" ? f.txHash : null,
        orderId: asNumber(f.orderId) ?? 0,
        simulated: Boolean(f.simulated),
      };
    }
  }

  return {
    coin,
    block,
    ts,
    mid,
    bestBid: asNumber(o.bestBid) ?? mid,
    bestAsk: asNumber(o.bestAsk) ?? mid,
    spreadBps: asNumber(o.spreadBps) ?? 0,
    decision: normalizeDecision(o.decision),
    quote: normalizeQuote(o.quote),
    fill,
    resting: normalizeResting(o.resting),
    position: normalizePosition(o.position),
    totals: normalizeTotals(o.totals),
    accountValue: asNumber(o.accountValue) ?? null,
    withdrawable: asNumber(o.withdrawable) ?? null,
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

export function parseJsonl(text: string, opts: ParseJsonlOptions = {}): { events: BlockEvent[]; tape: PricePoint[] } {
  const events: BlockEvent[] = [];
  const tape: PricePoint[] = [];
  const fileScope = opts.fileScope;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const ev = normalizeArchiveEvent(parsed, fileScope);
    if (ev) {
      events.push(ev);
      continue;
    }
    const pt = normalizeArchiveTape(parsed);
    if (pt) tape.push(pt);
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

export function countEventsByCoin(events: BlockEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) out[e.coin] = (out[e.coin] ?? 0) + 1;
  return out;
}
