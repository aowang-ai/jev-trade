import { expect, test } from "bun:test";
import { SNAPSHOT_HISTORY, clipHistory, clipTape } from "../src/snapshot";
import type { BlockEvent, PricePoint } from "../src/types";

const mid = (ts: number, px: number): PricePoint => ({ ts, mid: px });
const fill = (ts: number, px: number): PricePoint => ({
  ts, mid: px, fill: { side: "buy", price: px, size: 0.01, dir: "open", hash: "0x1" },
});

test("clipTape keeps every fill and the newest mids", () => {
  const points: PricePoint[] = [
    mid(1, 10), mid(2, 11), fill(3, 12), mid(4, 13), mid(5, 14), fill(6, 15),
  ];
  const clipped = clipTape(points, 2);
  expect(clipped.map((p) => [p.ts, Boolean(p.fill)])).toEqual([
    [3, true],
    [4, false],
    [5, false],
    [6, true],
  ]);
});

test("clipHistory keeps the tail", () => {
  const events = Array.from({ length: SNAPSHOT_HISTORY + 5 }, (_, i) => ({ block: i } as BlockEvent));
  expect(clipHistory(events).map((e) => e.block)).toEqual(
    Array.from({ length: SNAPSHOT_HISTORY }, (_, i) => i + 5),
  );
  expect(clipHistory(events.slice(0, 3))).toHaveLength(3);
});
