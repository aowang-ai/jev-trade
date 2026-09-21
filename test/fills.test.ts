import { expect, test } from "bun:test";
import { closedLots, tapeFills } from "../web/src/lib/fills";

test("tapeFills reads venue marks off the mid series and skips empty prints", () => {
  const rows = tapeFills([
    { ts: 1000, mid: 100 },
    { ts: 1500, mid: 100.5, fill: { side: "buy", price: 100.5, size: 0.01, dir: "open", hash: "0xabc", closedPnl: 0, feeUsd: 0.01 } },
    { ts: 2000, mid: 102, fill: { side: "sell", price: 102, size: 0 } },
    { ts: 2500, mid: 101, fill: { side: "sell", price: 101, size: 0.02, dir: "close", closedPnl: -1.2, feeUsd: 0.02 } },
  ]);
  expect(rows).toEqual([
    { key: "1500|buy|100.5|0.01|open|0xabc", ts: 1500, side: "buy", price: 100.5, size: 0.01, dir: "open", hash: "0xabc", closedPnl: 0, feeUsd: 0.01 },
    { key: "2500|sell|101|0.02|close|", ts: 2500, side: "sell", price: 101, size: 0.02, dir: "close", hash: undefined, closedPnl: -1.2, feeUsd: 0.02 },
  ]);
});

test("closedLots turns an open then close into one settled row", () => {
  const lots = closedLots([
    { key: "a", ts: 1000, side: "buy", price: 100, size: 2, dir: "open" },
    { key: "b", ts: 2000, side: "sell", price: 110, size: 2, dir: "close", closedPnl: 18.5, feeUsd: 0.4, hash: "0x1" },
  ]);
  expect(lots).toEqual([{
    key: "b|long|2",
    ts: 2000,
    openedTs: 1000,
    side: "long",
    size: 2,
    entry: 100,
    exit: 110,
    pnl: 18.5,
    fee: 0.4,
    hash: "0x1",
  }]);
});

test("closedLots averages stacked entries and uses mark pnl when the venue omits it", () => {
  const lots = closedLots([
    { key: "a", ts: 1, side: "sell", price: 200, size: 1, dir: "open" },
    { key: "b", ts: 2, side: "sell", price: 180, size: 1, dir: "open" },
    { key: "c", ts: 3, side: "buy", price: 170, size: 2, dir: "close" },
  ]);
  expect(lots).toHaveLength(1);
  expect(lots[0]!.side).toBe("short");
  expect(lots[0]!.entry).toBe(190);
  expect(lots[0]!.exit).toBe(170);
  expect(lots[0]!.pnl).toBeCloseTo(40);
});

test("closedLots records the flattened side of a flip", () => {
  const lots = closedLots([
    { key: "a", ts: 1, side: "buy", price: 10, size: 1, dir: "open" },
    { key: "b", ts: 2, side: "sell", price: 12, size: 2, dir: "flip", closedPnl: 2 },
    { key: "c", ts: 3, side: "buy", price: 11, size: 1, dir: "close", closedPnl: 1 },
  ]);
  expect(lots.map((l) => [l.side, l.size, l.entry, l.exit, l.pnl])).toEqual([
    ["long", 1, 10, 12, 2],
    ["short", 1, 12, 11, 1],
  ]);
});
