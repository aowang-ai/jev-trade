import type { PricePoint } from "./types";

export type TapeStatus = "idle" | "loading" | "done";

export function shouldHydrateTape(status: TapeStatus, refresh = false): boolean {
  return status !== "loading" && (status === "idle" || refresh);
}

function tapeKey(point: PricePoint): string {
  if (point.fill) {
    return `fill:${point.ts}:${point.fill.side}:${point.fill.price}:${point.fill.size}`;
  }
  return `bar:${point.bar ?? ""}:${point.ts}:${point.block ?? ""}`;
}

function tapeOrder(point: PricePoint): number {
  if (point.fill) return 3;
  if (point.bar === "15m") return 0;
  if (point.bar === "1m") return 1;
  if (point.bar === "1s") return 2;
  return 1;
}

export function mergeTape(current: PricePoint[], incoming: PricePoint[], limit: number): PricePoint[] {
  const points = new Map<string, PricePoint>();
  for (const point of current) points.set(tapeKey(point), point);
  for (const point of incoming) points.set(tapeKey(point), point);
  const cap = Math.max(0, Math.floor(limit));
  if (cap === 0) return [];
  return [...points.values()]
    .sort((a, b) => a.ts - b.ts || tapeOrder(a) - tapeOrder(b))
    .slice(-cap);
}

export function snapshotTape(
  current: PricePoint[],
  incoming: PricePoint[],
  sameSession: boolean,
  limit: number,
): PricePoint[] {
  if (sameSession) return mergeTape(current, incoming, limit);
  const cap = Math.max(0, Math.floor(limit));
  if (cap === 0) return [];
  return incoming.length > cap ? incoming.slice(-cap) : incoming;
}
