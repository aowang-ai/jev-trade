import { expect, test } from "bun:test";
import { decideFromJevAnswers, jevQuestions, marketFacing, type TradeState } from "../src/model";

function fixture(side: TradeState["position"]["side"]): TradeState {
  return {
    coin: "BTC",
    market: "BTC-USD",
    tick: 1,
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
    position: {
      coin: "BTC",
      side,
      size: side === "flat" ? 0 : 0.001,
      notionalUsd: side === "flat" ? 0 : 77,
      entry: side === "flat" ? null : 77000,
      leverage: 1,
      liquidationPx: null,
      distanceBps: null,
      unrealizedUsd: side === "flat" ? 0 : -1.25,
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

const scoreboard = [
  "recentfills",
  "this wallet",
  "realized",
  "feesusd",
  "pnlusd",
  "pnlpct",
  "pnl $",
  "equity=",
  "withdrawable",
  "worth paying",
  "not worth trading",
  "most ticks",
  "clears the spread",
  "round trip",
  "by more than the spread",
  "only when",
  "pick this when",
  "stay flat",
  "you are flat",
  "leave it alone",
  "ignored on a hold",
  "horizonticks",
  "post-only",
  "no order",
  "spread=",
];

test("Jev questions name the actions and do not coach a pick", () => {
  const flat = blob("flat");
  const long = blob("long");
  expect(flat).toContain("open or hold btc?");
  expect(flat).toContain('"open":"open"');
  expect(flat).toContain('"hold":"hold"');
  expect(long).toContain("open, close, or hold btc?");
  expect(long).toContain('"close":"close"');
  for (const text of [flat, long]) {
    for (const phrase of scoreboard) {
      expect(text).not.toContain(phrase);
    }
  }
});

test("evaluate state is the book and live position, not the wallet scoreboard", () => {
  const fat = {
    ...fixture("flat"),
    recentFills: ["sell 0.001 @ 77000 close"],
    horizonTicks: 100,
    position: {
      ...fixture("flat").position,
      realizedUsd: -10.5,
      feesUsd: 3.8,
      pnlUsd: -14.3,
      pnlPct: -7,
      equity: 185,
      withdrawable: 185,
    },
  };
  const seen = marketFacing(fat as TradeState);
  const text = JSON.stringify(seen).toLowerCase();
  expect(seen.book).toEqual(fat.book);
  expect(seen.trades).toEqual(fat.trades);
  expect(seen.position.side).toBe("flat");
  expect("unrealizedUsd" in seen.position).toBe(false);
  for (const phrase of ["recentfills", "realizedusd", "feesusd", "pnlusd", "pnlpct", "equity", "withdrawable", "horizonticks"]) {
    expect(text).not.toContain(phrase);
  }

  const open = marketFacing(fixture("long"));
  expect(open.position.unrealizedUsd).toBe(-1.25);
  expect(JSON.stringify(open).toLowerCase()).not.toContain("pnlusd");
});

test("a short answer keeps its case and still sells", () => {
  for (const choice of ["SHORT", "Short", " short "]) {
    const d = decideFromJevAnswers(
      { bias: { choice }, intent: { choice: "open" }, leverage: { choice: "2" } },
      "flat",
      40,
      1,
    );
    expect(d.bias).toBe("short");
    expect(d.intent).toBe("open");
    expect(d.action).toBe("sell");
  }
});

test("an unrecognised bias stands down instead of opening long", () => {
  const d = decideFromJevAnswers(
    { bias: { choice: "up" }, intent: { choice: "open" }, leverage: { choice: "5" } },
    "flat",
    40,
    1,
  );
  expect(d.intent).toBe("hold");
  expect(d.action).toBe("hold");
  expect(d.probabilities.long).toBe(d.probabilities.short);
  expect(d.probabilities.long).toBeLessThan(1);
});
