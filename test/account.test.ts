import { expect, test } from "bun:test";
import { accountFromClearinghouse, fillDir, FillPnlBook } from "../src/account";

const state = {
  withdrawable: "546.14",
  marginSummary: { accountValue: "548.20" },
  assetPositions: [
    {
      position: {
        coin: "BTC",
        szi: "-0.007074",
        entryPx: "77180",
        unrealizedPnl: "-1.23",
        leverage: { type: "cross", value: 3 },
        liquidationPx: "82000",
      },
    },
  ],
};

test("accountFromClearinghouse reads HL position and mark pnl", () => {
  const a = accountFromClearinghouse(state, "BTC");
  expect(a.positionSz).toBeCloseTo(-0.007074, 8);
  expect(a.entryPrice).toBe(77180);
  expect(a.unrealizedUsd).toBeCloseTo(-1.23, 6);
  expect(a.accountValue).toBeCloseTo(548.2, 6);
  expect(a.withdrawable).toBeCloseTo(546.14, 6);
  expect(a.realizedUsd).toBe(0);
  expect(a.leverage).toBe(3);
  expect(a.liquidationPx).toBe(82000);
});

test("accountFromClearinghouse is flat when the coin is missing", () => {
  const a = accountFromClearinghouse(state, "ETH");
  expect(a.positionSz).toBe(0);
  expect(a.entryPrice).toBeNull();
  expect(a.unrealizedUsd).toBe(0);
  expect(a.accountValue).toBeCloseTo(548.2, 6);
});

test("FillPnlBook sums closedPnl and fees once per tid", () => {
  const book = new FillPnlBook();
  expect(book.add({ coin: "BTC", hash: "0x1", tid: 1, closedPnl: "2.5", fee: "0.1" }, "BTC")).toBe(true);
  expect(book.add({ coin: "BTC", hash: "0x1", tid: 1, closedPnl: "2.5", fee: "0.1" }, "BTC")).toBe(false);
  expect(book.add({ coin: "ETH", hash: "0x2", tid: 2, closedPnl: "9", fee: "1" }, "BTC")).toBe(false);
  expect(book.add({ coin: "BTC", hash: "0x3", tid: 3, closedPnl: "-0.4", fee: "0.05" }, "BTC")).toBe(true);
  expect(book.realized).toBeCloseTo(2.1, 8);
  expect(book.fees).toBeCloseTo(0.15, 8);
  const a = book.apply(accountFromClearinghouse(state, "BTC"));
  expect(a.realizedUsd).toBeCloseTo(2.1, 8);
  expect(a.unrealizedUsd).toBeCloseTo(-1.23, 6);
});

test("fillDir maps Hyperliquid dir", () => {
  expect(fillDir("Open Long")).toBe("open");
  expect(fillDir("Close Short")).toBe("close");
  expect(fillDir("Long > Short")).toBe("flip");
  expect(fillDir(undefined)).toBeUndefined();
});
