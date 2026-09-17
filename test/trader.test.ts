import { expect, test } from "bun:test";
import { leverageRungs, parseLeverage, planQuote, quoteAction } from "../src/plan";

test("open long buys and open short sells", () => {
  expect(quoteAction("open", "long")).toBe("buy");
  expect(quoteAction("open", "short")).toBe("sell");
  expect(planQuote({ intent: "open", bias: "long", positionSz: -2, quoteSz: 0.01 })).toEqual({
    side: "buy", size: 0.01, reduceOnly: false,
  });
  expect(planQuote({ intent: "open", bias: "short", positionSz: 2, quoteSz: 0.01 })).toEqual({
    side: "sell", size: 0.01, reduceOnly: false,
  });
});

test("close flattens that side and skips when flat", () => {
  expect(quoteAction("close", "long")).toBe("sell");
  expect(quoteAction("close", "short")).toBe("buy");
  expect(planQuote({ intent: "close", bias: "long", positionSz: 0.08, quoteSz: 0.01 })).toEqual({
    side: "sell", size: 0.08, reduceOnly: true,
  });
  expect(planQuote({ intent: "close", bias: "short", positionSz: -0.08, quoteSz: 0.01 })).toEqual({
    side: "buy", size: 0.08, reduceOnly: true,
  });
  expect(planQuote({ intent: "close", bias: "long", positionSz: 0, quoteSz: 0.01 })).toBe(null);
  expect(planQuote({ intent: "close", bias: "short", positionSz: 0.08, quoteSz: 0.01 })).toBe(null);
});

test("leverage rungs follow the coin max", () => {
  expect(leverageRungs(10)).toEqual([1, 2, 3, 5, 10]);
  expect(leverageRungs(50)).toEqual([1, 2, 3, 5, 10, 20, 40, 50]);
  expect(leverageRungs(15)).toEqual([1, 2, 3, 5, 10, 15]);
  expect(parseLeverage("7", 10, 1)).toBe(5);
  expect(parseLeverage("50", 10, 1)).toBe(10);
});
