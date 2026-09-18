import { expect, test } from "bun:test";
import { applyLiveMid, barsForView, fillMarks, M15_MS } from "../web/src/lib/ohlc";
import type { PricePoint } from "../src/types";

test("barsForView reads 1m ohlc and rolls them into 15m", () => {
  const tape: PricePoint[] = [
    { ts: 0, mid: 90, open: 80, high: 95, low: 70, close: 90, bar: "15m" },
    { ts: M15_MS, mid: 101, open: 100, high: 102, low: 99, close: 101, bar: "1m" },
    { ts: M15_MS + 60_000, mid: 104, open: 101, high: 105, low: 100, close: 104, bar: "1m" },
    { ts: M15_MS + 30_000, mid: 103, fill: { side: "buy", price: 103, size: 1 } },
  ];
  expect(barsForView(tape, "1m")).toEqual([
    { time: M15_MS / 1000, open: 100, high: 102, low: 99, close: 101 },
    { time: (M15_MS + 60_000) / 1000, open: 101, high: 105, low: 100, close: 104 },
  ]);
  expect(barsForView(tape, "15m")).toEqual([
    { time: 0, open: 80, high: 95, low: 70, close: 90 },
    { time: M15_MS / 1000, open: 100, high: 105, low: 99, close: 104 },
  ]);
  expect(fillMarks(tape, "1m")).toEqual([{ time: (M15_MS + 0) / 1000, side: "buy" }]);
});

test("barsForView 1s uses only 1s prints", () => {
  const tape: PricePoint[] = [
    { ts: 0, mid: 100, open: 100, high: 101, low: 99, close: 100, bar: "1m" },
    { ts: 60_000, mid: 102, open: 102, high: 103, low: 101, close: 102, bar: "1s" },
    { ts: 61_000, mid: 104, open: 102, high: 104, low: 102, close: 104, bar: "1s" },
  ];
  expect(barsForView(tape, "1s")).toEqual([
    { time: 60, open: 102, high: 103, low: 101, close: 102 },
    { time: 61, open: 102, high: 104, low: 102, close: 104 },
  ]);
});

test("barsForView 1H rolls 15m candles", () => {
  const hour = 60 * 60 * 1000;
  const tape: PricePoint[] = [
    { ts: 0, mid: 100, open: 100, high: 101, low: 99, close: 100, bar: "15m" },
    { ts: 15 * 60 * 1000, mid: 104, open: 100, high: 105, low: 100, close: 104, bar: "15m" },
    { ts: hour, mid: 98, open: 104, high: 104, low: 97, close: 98, bar: "15m" },
  ];
  expect(barsForView(tape, "1H")).toEqual([
    { time: 0, open: 100, high: 105, low: 99, close: 104 },
    { time: hour / 1000, open: 104, high: 104, low: 97, close: 98 },
  ]);
});

test("barsForView 1H stitches older 15m onto recent 1m", () => {
  const hour = 60 * 60 * 1000;
  const tape: PricePoint[] = [
    { ts: 0, mid: 100, open: 100, high: 101, low: 99, close: 100, bar: "15m" },
    { ts: hour, mid: 104, open: 104, high: 105, low: 103, close: 104, bar: "15m" },
    { ts: hour, mid: 104, open: 104, high: 105, low: 104, close: 105, bar: "1m" },
    { ts: hour + 60_000, mid: 98, open: 105, high: 105, low: 97, close: 98, bar: "1m" },
  ];
  expect(barsForView(tape, "1H")).toEqual([
    { time: 0, open: 100, high: 101, low: 99, close: 100 },
    { time: hour / 1000, open: 104, high: 105, low: 97, close: 98 },
  ]);
});

test("applyLiveMid updates the forming 1s, 1m and 15m bars", () => {
  const tape: PricePoint[] = [
    { ts: 0, mid: 100, open: 100, high: 100, low: 100, close: 100, bar: "1m" },
  ];
  const next = applyLiveMid(tape, 102, 20_000);
  expect(next.find((p) => p.bar === "1s" && p.ts === 20_000)).toMatchObject({
    open: 102, high: 102, low: 102, close: 102, mid: 102,
  });
  expect(next.find((p) => p.bar === "1m" && p.ts === 0)).toMatchObject({
    open: 100, high: 102, low: 100, close: 102, mid: 102,
  });
  expect(next.find((p) => p.bar === "15m" && p.ts === 0)).toMatchObject({
    open: 100, high: 102, close: 102,
  });
  const rolled = applyLiveMid(next, 98, 60_000);
  expect(rolled.find((p) => p.bar === "1s" && p.ts === 60_000)).toMatchObject({
    open: 102, high: 98, low: 98, close: 98,
  });
  expect(rolled.find((p) => p.bar === "1m" && p.ts === 60_000)).toMatchObject({
    open: 102, high: 98, low: 98, close: 98,
  });
});
