import { expect, test } from "bun:test";
import { coinDex, coinLabel, coinPair, loadSleeves, sameCoin, tapePath } from "../src/sleeves";

test("coin helpers split HIP-3 names", () => {
  expect(coinLabel("xyz:NVDA")).toBe("NVDA");
  expect(coinDex("xyz:NVDA")).toBe("xyz");
  expect(coinPair("xyz:GOLD")).toBe("GOLD-USD");
  expect(coinLabel("BTC")).toBe("BTC");
  expect(coinDex("BTC")).toBeUndefined();
  expect(coinPair("ETH")).toBe("ETH-USD");
  expect(tapePath("ETH")).toBe("data/events-ETH.jsonl");
});

test("sameCoin matches dex prefix or label", () => {
  expect(sameCoin("xyz:NVDA", "xyz:NVDA")).toBe(true);
  expect(sameCoin("NVDA", "xyz:NVDA")).toBe(true);
  expect(sameCoin("xyz:NVDA", "NVDA")).toBe(true);
  expect(sameCoin("BTC", "ETH")).toBe(false);
  expect(sameCoin(undefined, "BTC")).toBe(false);
});

test("loadSleeves follows HL_COINS", () => {
  const prev = process.env.HL_COINS;
  process.env.HL_COINS = "BTC,xyz:GOLD";
  try {
    const sleeves = loadSleeves();
    expect(sleeves.map((s) => s.coin)).toEqual(["BTC", "xyz:GOLD"]);
    expect(sleeves[0]!.label).toBe("BTC");
    expect(sleeves[1]!.label).toBe("GOLD");
    expect(sleeves[1]!.pair).toBe("GOLD-USD");
  } finally {
    if (prev == null) delete process.env.HL_COINS;
    else process.env.HL_COINS = prev;
  }
});
