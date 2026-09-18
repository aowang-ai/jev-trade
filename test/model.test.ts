import { expect, test } from "bun:test";
import { jevQuestions, type TradeState } from "../src/model";

function fixture(side: TradeState["position"]["side"]): TradeState {
  return {
    coin: "BTC",
    market: "BTC-USD",
    tick: 1,
    horizonTicks: 100,
    tickMs: 500,
    mid: 77000,
    spreadBps: 0.13,
    bookImbalance: 0,
    depth: {},
    book: { bids: [], asks: [] },
    returnsBps: { last1: 0, last5: 0, last20: 0, last100: 0 },
    recentMids: "",
    trades: { count: 0, buySz: 0, sellSz: 0, cvdSz: 0, vwap: null, lastPrice: null, lastSide: null },
    recentTrades: [],
    recentFills: [],
    position: {
      coin: "BTC",
      side,
      size: side === "flat" ? 0 : 0.001,
      notionalUsd: side === "flat" ? 0 : 77,
      entry: side === "flat" ? null : 77000,
      leverage: 1,
      liquidationPx: null,
      distanceBps: null,
      unrealizedUsd: 0,
      realizedUsd: 0,
      feesUsd: 0,
      pnlUsd: 0,
      pnlPct: 0,
      equity: 200,
      withdrawable: 200,
    },
    indicators: {
      sma20: null, sma50: null, ema20: null, midVsSma20Bps: null, midVsSma50Bps: null,
      rsi14: null, vol20Bps: null, high20: null, low20: null, rangePos20: null,
    },
    asset: {
      markPx: null, oraclePx: null, fundingBps: null, premiumBps: null,
      openInterest: null, dayNtlVlmUsd: null, dayChangeBps: null, maxLeverage: 40,
    },
    maxLeverage: 40,
  };
}

function blob(side: TradeState["position"]["side"]) {
  return JSON.stringify(jevQuestions(fixture(side))).toLowerCase();
}

test("Jev questions name the actions and do not set a trade hurdle", () => {
  const flat = blob("flat");
  const long = blob("long");
  expect(flat).toContain("open btc on the long/short you picked.");
  expect(flat).toContain("stay flat. no order is sent.");
  expect(long).toContain("flatten the live btc position.");
  expect(long).toContain("leave the position as it is. send nothing.");
  for (const text of [flat, long]) {
    expect(text).not.toContain("worth paying");
    expect(text).not.toContain("not worth trading");
    expect(text).not.toContain("most ticks");
    expect(text).not.toContain("clears the spread");
    expect(text).not.toContain("round trip");
    expect(text).not.toContain("by more than the spread");
    expect(text).not.toContain("only when");
    expect(text).not.toContain("pick this when");
    expect(text).not.toContain("horizonTicks".toLowerCase());
  }
});
