import { expect, test } from "bun:test";
import type { PricePoint } from "../web/src/lib/types";
import { mergeTape, shouldHydrateTape, snapshotTape } from "../web/src/lib/tape-state";

test("same-session snapshot keeps older points and updates matching bars", () => {
  const current: PricePoint[] = [
    { ts: 0, mid: 100, open: 100, high: 101, low: 99, close: 100, bar: "15m" },
    { ts: 60_000, mid: 101, open: 100, high: 101, low: 100, close: 101, bar: "1m" },
    { ts: 61_000, mid: 99, fill: { side: "buy", price: 99, size: 1 } },
  ];
  const incoming: PricePoint[] = [
    { ts: 60_000, mid: 102, open: 100, high: 102, low: 100, close: 102, bar: "1m" },
    { ts: 120_000, mid: 103, open: 102, high: 103, low: 102, close: 103, bar: "1m" },
    { ts: 121_000, mid: 103, fill: { side: "sell", price: 103, size: 1 } },
  ];

  expect(snapshotTape(current, incoming, true, 100)).toEqual([
    current[0],
    incoming[0],
    current[2],
    incoming[1],
    incoming[2],
  ]);
});

test("new-session snapshot drops points from the prior session", () => {
  const current: PricePoint[] = [{ ts: 1, mid: 100, bar: "1m" }];
  const incoming: PricePoint[] = [{ ts: 2, mid: 101, bar: "1m" }];

  expect(snapshotTape(current, incoming, false, 100)).toEqual(incoming);
});

test("tape refresh merges new points and replaces matching bars", () => {
  const current: PricePoint[] = [{ ts: 1, mid: 100, bar: "1m" }];
  const incoming: PricePoint[] = [
    { ts: 1, mid: 102, bar: "1m" },
    { ts: 2, mid: 103, bar: "1m" },
  ];

  expect(mergeTape(current, incoming, 100)).toEqual(incoming);
});

test("completed tape hydration can refresh after a snapshot", () => {
  expect(shouldHydrateTape("idle")).toBe(true);
  expect(shouldHydrateTape("done")).toBe(false);
  expect(shouldHydrateTape("done", true)).toBe(true);
  expect(shouldHydrateTape("loading", true)).toBe(false);
});
