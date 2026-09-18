import type { BlockEvent, PricePoint } from "./types";

/** Enough CALLS rows for the first paint. The rest stream in. */
export const SNAPSHOT_HISTORY = 12;
/** Recent 1s candles for the default 15m 秒K. */
export const SNAPSHOT_SECS = 900;
/** 1m fallback when the 1s tail is still short. */
export const SNAPSHOT_MIDS = 24;
export const SNAPSHOT_FILLS = 12;
/** 1s tail on /tape. Older time is 1m then 15m. */
export const TAPE_SECS = 900;
/** 24h of 1m on /tape. Older time is 15m bars. */
export const TAPE_MIDS = 1440;

function byTime(a: PricePoint, b: PricePoint): number {
  return a.ts - b.ts || (a.fill ? 1 : 0) - (b.fill ? 1 : 0);
}

function tail<T>(rows: T[], n: number): T[] {
  return rows.length > n ? rows.slice(-n) : rows;
}

export function clipHistory(events: BlockEvent[], n = SNAPSHOT_HISTORY): BlockEvent[] {
  return events.length > n ? events.slice(-n) : events;
}

function splitTape(points: PricePoint[]) {
  const sec: PricePoint[] = [];
  const min: PricePoint[] = [];
  const m15: PricePoint[] = [];
  const fills: PricePoint[] = [];
  for (const p of points) {
    if (p.fill) fills.push(p);
    else if (p.bar === "1s") sec.push(p);
    else if (p.bar === "15m") m15.push(p);
    else min.push(p);
  }
  return { sec, min, m15, fills };
}

/** Keep fills and 15m candles. Cap 1s and 1m separately. */
export function clipTape(points: PricePoint[], maxMids = TAPE_MIDS, maxSecs = TAPE_SECS): PricePoint[] {
  const { sec, min, m15, fills } = splitTape(points);
  if (sec.length <= maxSecs && min.length <= maxMids) return points;
  return m15.concat(tail(min, maxMids), tail(sec, maxSecs), fills).sort(byTime);
}

/** First paint: 1s tail, a short 1m fallback, and a short fill tail. */
export function clipSnapshotTape(
  points: PricePoint[],
  maxMids = SNAPSHOT_MIDS,
  maxFills = SNAPSHOT_FILLS,
  maxSecs = SNAPSHOT_SECS,
): PricePoint[] {
  const { sec, min, fills } = splitTape(points);
  return tail(min, maxMids).concat(tail(sec, maxSecs), tail(fills, maxFills)).sort(byTime);
}
