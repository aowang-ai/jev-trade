import type { PricePoint } from "./bot-types";

/** About five minutes of 200ms mids. Older candles stay on the venue tape. */
export const LIVE_CAP = 1500;

export function mergeLiveTape(tape: PricePoint[], live: PricePoint[]): PricePoint[] {
  if (!live.length) return tape;
  const cut = tape.length ? tape[tape.length - 1]!.ts : 0;
  const extra = live.filter((p) => p.ts > cut);
  return extra.length ? tape.concat(extra) : tape;
}

export function pushLive(live: PricePoint[], point: PricePoint, cap = LIVE_CAP): PricePoint[] {
  const last = live[live.length - 1];
  if (last && last.ts === point.ts && last.mid === point.mid) return live;
  const next = live.concat(point);
  return next.length > cap ? next.slice(next.length - cap) : next;
}
