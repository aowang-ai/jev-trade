import type { BlockEvent, PricePoint } from "./types";

/** Enough CALLS rows for the feed. The rest stay on /history. */
export const SNAPSHOT_HISTORY = 80;
/** Recent mids for the default 4H/12H chart. Older candles stay on /tape. */
export const SNAPSHOT_MIDS = 1600;

export function clipHistory(events: BlockEvent[], n = SNAPSHOT_HISTORY): BlockEvent[] {
  return events.length > n ? events.slice(-n) : events;
}

/** Keep every venue fill, drop the oldest mid-only prints. */
export function clipTape(points: PricePoint[], maxMids = SNAPSHOT_MIDS): PricePoint[] {
  let mids = 0;
  for (const p of points) if (!p.fill) mids++;
  if (mids <= maxMids) return points;
  let drop = mids - maxMids;
  const out: PricePoint[] = [];
  for (const p of points) {
    if (!p.fill && drop > 0) {
      drop--;
      continue;
    }
    out.push(p);
  }
  return out;
}
