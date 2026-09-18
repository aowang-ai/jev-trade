import type { PricePoint } from "./bot-types";

export const SECOND_MS = 1000;
export const MINUTE_MS = 60_000;
export const M15_MS = 15 * 60_000;
export type BarSize = "1s" | "1m" | "5m" | "15m" | "1H";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type FillMark = {
  time: number;
  side: "buy" | "sell";
};

export function barMs(bar: BarSize): number {
  if (bar === "1s") return SECOND_MS;
  if (bar === "1H") return 60 * MINUTE_MS;
  if (bar === "15m") return M15_MS;
  if (bar === "5m") return 5 * MINUTE_MS;
  return MINUTE_MS;
}

export function asUtcSec(tsMs: number): number {
  return Math.floor(tsMs / 1000);
}

function bucketTs(ts: number, interval: number): number {
  return Math.floor(ts / interval) * interval;
}

function isCandle(p: PricePoint): boolean {
  return !p.fill;
}

function asCandle(p: PricePoint): Candle | null {
  const close = p.close ?? p.mid;
  if (!Number.isFinite(p.ts) || p.ts < 0 || !(close > 0)) return null;
  const open = p.open ?? close;
  const high = p.high ?? Math.max(open, close);
  const low = p.low ?? Math.min(open, close);
  return {
    time: asUtcSec(p.ts),
    open,
    high: Math.max(high, open, close),
    low: Math.min(low, open, close),
    close,
  };
}

function mergeCandle(a: Candle, b: Candle): Candle {
  return {
    time: a.time,
    open: a.open,
    high: Math.max(a.high, b.high),
    low: Math.min(a.low, b.low),
    close: b.close,
  };
}

export function aggregateBars(points: PricePoint[], bar: BarSize): Candle[] {
  const interval = barMs(bar);
  const byTime = new Map<number, Candle>();
  for (const p of points) {
    if (!isCandle(p)) continue;
    const raw = asCandle({ ...p, ts: bucketTs(p.ts, interval) });
    if (!raw) continue;
    const prev = byTime.get(raw.time);
    byTime.set(raw.time, prev ? mergeCandle(prev, raw) : raw);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function barsForView(tape: PricePoint[], bar: BarSize): Candle[] {
  const tagged1s = tape.filter((p) => isCandle(p) && p.bar === "1s");
  const tagged1 = tape.filter((p) => isCandle(p) && p.bar === "1m");
  const tagged15 = tape.filter((p) => isCandle(p) && p.bar === "15m");
  const untagged = tape.filter((p) => isCandle(p) && p.bar == null);
  const m1 = tagged1.length ? tagged1 : untagged;
  if (bar === "1s") return aggregateBars(tagged1s, "1s");
  if (bar === "1m") return aggregateBars(m1, "1m");
  if (bar === "5m") return aggregateBars(m1, "5m");
  if (bar === "1H") {
    const from1 = aggregateBars(m1, "1H");
    if (!from1.length) return aggregateBars(tagged15, "1H");
    const first = from1[0]!.time;
    const older = aggregateBars(tagged15, "1H").filter((c) => c.time < first);
    return older.concat(from1);
  }
  const from1m = aggregateBars(m1, "15m");
  if (!from1m.length) return aggregateBars(tagged15, "15m");
  const first = from1m[0]!.time;
  const older = aggregateBars(tagged15, "15m").filter((c) => c.time < first);
  return older.concat(from1m);
}

export function fillMarks(tape: PricePoint[], bar: BarSize): FillMark[] {
  const interval = barMs(bar);
  const out: FillMark[] = [];
  const seen = new Set<string>();
  for (const p of tape) {
    const f = p.fill;
    if (!f || !(p.ts > 0)) continue;
    const time = asUtcSec(bucketTs(p.ts, interval));
    const key = `${time}|${f.side}|${f.price}|${f.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ time, side: f.side });
  }
  return out;
}

function upsertBar(tape: PricePoint[], mid: number, ts: number, bar: "1s" | "1m" | "15m"): PricePoint[] {
  const interval = barMs(bar);
  const bucket = bucketTs(ts, interval);
  let idx = -1;
  for (let i = tape.length - 1; i >= 0; i--) {
    const p = tape[i]!;
    if (p.fill || p.bar !== bar) continue;
    if (p.ts === bucket) {
      idx = i;
      break;
    }
    if (p.ts < bucket) break;
  }
  if (idx >= 0) {
    const p = tape[idx]!;
    const open = p.open ?? p.mid;
    const next = tape.slice();
    next[idx] = {
      ...p,
      mid,
      open,
      high: Math.max(p.high ?? p.mid, mid),
      low: Math.min(p.low ?? p.mid, mid),
      close: mid,
      bar,
    };
    return next;
  }
  let sameOpen: number | null = null;
  let prevClose: number | null = null;
  for (let i = tape.length - 1; i >= 0; i--) {
    const p = tape[i]!;
    if (p.fill) continue;
    if (p.ts === bucket) sameOpen = p.open ?? p.mid;
    if (p.bar === bar && p.ts < bucket && prevClose == null) prevClose = p.close ?? p.mid;
  }
  const open = sameOpen ?? prevClose ?? mid;
  const point: PricePoint = { ts: bucket, mid, open, high: mid, low: mid, close: mid, bar };
  const next = tape.slice();
  let at = next.length;
  for (let i = 0; i < next.length; i++) {
    if (next[i]!.ts > bucket) {
      at = i;
      break;
    }
  }
  next.splice(at, 0, point);
  return next;
}

/** Fold a live mid into the forming 1s, 1m, and 15m candles. */
export function applyLiveMid(tape: PricePoint[], mid: number, ts: number): PricePoint[] {
  if (!(mid > 0) || !(ts > 0)) return tape;
  return upsertBar(upsertBar(upsertBar(tape, mid, ts, "1s"), mid, ts, "1m"), mid, ts, "15m");
}
