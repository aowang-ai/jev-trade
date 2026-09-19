import { expect, test } from "bun:test";
import { portfolioBalance, portfolioPnl, roePct, sleevePnl } from "../web/src/lib/pnl";
import type { BlockEvent } from "../src/types";

function event(partial: Partial<BlockEvent> & Pick<BlockEvent, "coin" | "position" | "totals">): BlockEvent {
  return {
    block: 1,
    ts: 1,
    mid: 100,
    bestBid: 99,
    bestAsk: 101,
    spreadBps: 1,
    decision: null,
    quote: null,
    fill: null,
    resting: { bidSz: 0, askSz: 0 },
    ...partial,
  };
}

test("sleevePnl splits open mark pnl from closed fills", () => {
  const open = event({
    coin: "BTC",
    position: { side: "long", size: 0.01, entryPrice: 100, leverage: 10, unrealizedUsd: 2.5, unrealizedSz: 0 },
    totals: {
      blocks: 1, decisions: 1, quotes: 1, fills: 2, reverted: 0, lateBlocks: 0,
      jevUsd: 0, gasSz: 0, gasUsd: 0.1, realizedUsd: -4, pnlUsd: -1.5, pnlSz: 0, pnlPct: 0,
    },
  });
  expect(sleevePnl(open)).toEqual({ coin: "BTC", unrealized: 2.5, realized: -4, open: true });
  const flat = event({
    coin: "ETH",
    position: { side: "flat", size: 0, entryPrice: null, leverage: 10, unrealizedUsd: 0, unrealizedSz: 0 },
    totals: {
      blocks: 1, decisions: 1, quotes: 0, fills: 1, reverted: 0, lateBlocks: 0,
      jevUsd: 0, gasSz: 0, gasUsd: 0, realizedUsd: 3, pnlUsd: 3, pnlSz: 0, pnlPct: 0,
    },
  });
  expect(sleevePnl(flat)).toEqual({ coin: "ETH", unrealized: 0, realized: 3, open: false });
  expect(portfolioPnl({ BTC: open, ETH: flat })).toEqual({ unrealized: 2.5, realized: -1 });
  expect(portfolioBalance({ BTC: { ...open, accountValue: 120.4 }, ETH: { ...flat, accountValue: 80 } })).toBeCloseTo(200.4);
  expect(portfolioBalance({ BTC: open, ETH: flat })).toBeNull();
});

test("roePct is unrealized over initial margin", () => {
  expect(roePct({ side: "flat", size: 0, entryPrice: null, leverage: 10, unrealizedUsd: 0 })).toBeNull();
  expect(roePct({ side: "long", size: 1, entryPrice: 100, leverage: 10, unrealizedUsd: 5 })).toBeCloseTo(0.5);
});
