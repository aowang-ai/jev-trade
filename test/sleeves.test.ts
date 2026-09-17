import { expect, test } from "bun:test";
import { coinDex, coinLabel, coinPair, loadSleeves, parseWalletsJson, sameCoin, tapePath } from "../src/sleeves";

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

test("parseWalletsJson reads sleeves array or coin map", () => {
  const keyA = `0x${"aa".repeat(32)}`;
  const keyB = `0x${"bb".repeat(32)}`;
  expect(parseWalletsJson(JSON.stringify({ sleeves: [{ coin: "ETH", privateKey: keyA }] })).get("ETH")).toBe(keyA);
  expect(parseWalletsJson(JSON.stringify({ SOL: keyB })).get("SOL")).toBe(keyB);
  expect(parseWalletsJson("not-json").size).toBe(0);
});

test("loadSleeves reads WALLETS_JSON for non-first coins", () => {
  const prevCoins = process.env.HL_COINS;
  const prevJson = process.env.WALLETS_JSON;
  const prevKey = process.env.PRIVATE_KEY;
  const btc = `0x${"11".repeat(32)}`;
  const eth = `0x${"22".repeat(32)}`;
  process.env.HL_COINS = "TESTBTC,TESTETH";
  process.env.PRIVATE_KEY = btc;
  process.env.WALLETS_JSON = JSON.stringify({ sleeves: [{ coin: "TESTETH", privateKey: eth }] });
  try {
    const sleeves = loadSleeves();
    expect(sleeves[0]!.privateKey).toBe(btc);
    expect(sleeves[1]!.privateKey).toBe(eth);
  } finally {
    if (prevCoins == null) delete process.env.HL_COINS;
    else process.env.HL_COINS = prevCoins;
    if (prevJson == null) delete process.env.WALLETS_JSON;
    else process.env.WALLETS_JSON = prevJson;
    if (prevKey == null) delete process.env.PRIVATE_KEY;
    else process.env.PRIVATE_KEY = prevKey;
  }
});
