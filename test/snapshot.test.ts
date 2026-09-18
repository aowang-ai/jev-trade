import { expect, test } from "bun:test";
import { SNAPSHOT_HISTORY, SNAPSHOT_MIDS, clipHistory, clipSnapshotTape, clipTape } from "../src/snapshot";
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

test("clipTape keeps 15m candles when dropping old 1m prints", () => {
  const points: PricePoint[] = [
    { ts: 1, mid: 10, bar: "15m" },
    { ts: 2, mid: 11, bar: "1m" },
    { ts: 3, mid: 12, bar: "1m" },
    { ts: 4, mid: 13, bar: "1m" },
  ];
  expect(clipTape(points, 1).map((p) => [p.ts, p.bar])).toEqual([
    [1, "15m"],
    [4, "1m"],
  ]);
});

test("clipSnapshotTape drops 15m and keeps a short 1m and fill tail", () => {
  const points: PricePoint[] = [
    { ts: 1, mid: 10, bar: "15m" },
    { ts: 2, mid: 11, bar: "1m" },
    { ts: 3, mid: 12, bar: "1m" },
    fill(4, 13),
    { ts: 5, mid: 14, bar: "1m" },
    fill(6, 15),
  ];
  expect(clipSnapshotTape(points, 2, 1).map((p) => [p.ts, Boolean(p.fill), p.bar])).toEqual([
    [3, false, "1m"],
    [5, false, "1m"],
    [6, true, undefined],
  ]);
});

test("clipSnapshotTape keeps a 1s tail next to the 1m fallback", () => {
  const points: PricePoint[] = [
    { ts: 1, mid: 10, bar: "15m" },
    { ts: 2, mid: 11, bar: "1m" },
    { ts: 3, mid: 12, bar: "1s" },
    { ts: 4, mid: 13, bar: "1s" },
    { ts: 5, mid: 14, bar: "1s" },
  ];
  expect(clipSnapshotTape(points, 1, 0, 2).map((p) => [p.ts, p.bar])).toEqual([
    [2, "1m"],
    [4, "1s"],
    [5, "1s"],
  ]);
});

test("default snapshot tape is a short 1m tail for the 15m window", () => {
  const points: PricePoint[] = Array.from({ length: 40 }, (_, i) => ({
    ts: i + 1, mid: 10 + i, bar: "1m" as const,
  }));
  expect(clipSnapshotTape(points)).toHaveLength(SNAPSHOT_MIDS);
});

test("clipHistory keeps the tail", () => {
  const events = Array.from({ length: SNAPSHOT_HISTORY + 5 }, (_, i) => ({ block: i } as BlockEvent));
  expect(clipHistory(events).map((e) => e.block)).toEqual(
    Array.from({ length: SNAPSHOT_HISTORY }, (_, i) => i + 5),
  );
  expect(clipHistory(events.slice(0, 3))).toHaveLength(3);
});
