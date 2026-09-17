import { expect, test } from "bun:test";
import { allowQuote } from "../src/trader";

const base = {
  size: 0.001,
  positionSz: 0,
  restingBuy: 0,
  restingSell: 0,
  maxPosition: 0.01,
  hasWallet: false,
  marginUsdc: 100,
  px: 76000,
  leverage: 3,
};

test("allowQuote accepts both sides when flat and under cap", () => {
  expect(allowQuote({ ...base, side: "buy" })).toBe(true);
  expect(allowQuote({ ...base, side: "sell" })).toBe(true);
});

test("allowQuote blocks adding when already at max position", () => {
  expect(allowQuote({ ...base, side: "buy", positionSz: 0.01 })).toBe(false);
  expect(allowQuote({ ...base, side: "sell", positionSz: 0.01 })).toBe(true);
});

test("allowQuote lets a reducing order through even when over cap", () => {
  expect(allowQuote({ ...base, side: "sell", positionSz: 0.02, maxPosition: 0.01 })).toBe(true);
  expect(allowQuote({ ...base, side: "buy", positionSz: 0.02, maxPosition: 0.01 })).toBe(false);
});

test("allowQuote needs margin when a wallet is live", () => {
  expect(allowQuote({ ...base, side: "buy", hasWallet: true, marginUsdc: 0 })).toBe(false);
  expect(allowQuote({ ...base, side: "buy", hasWallet: true, marginUsdc: 50 })).toBe(true);
});
