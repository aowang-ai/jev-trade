import { expect, test } from "bun:test";
import { coinPair, loadSleeves, parseWalletsJson, sameCoin } from "../src/sleeves";

test("coinPair is the USD perp name", () => {
  expect(coinPair("BTC")).toBe("BTC-USD");
  expect(coinPair("ETH")).toBe("ETH-USD");
});

test("sameCoin is exact", () => {
  expect(sameCoin("BTC", "BTC")).toBe(true);
  expect(sameCoin("BTC", "ETH")).toBe(false);
  expect(sameCoin(undefined, "BTC")).toBe(false);
});

test("loadSleeves follows HL_COINS", () => {
  const prev = process.env.HL_COINS;
  process.env.HL_COINS = "BTC,ETH";
  try {
    const sleeves = loadSleeves();
    expect(sleeves.map((s) => s.coin)).toEqual(["BTC", "ETH"]);
    expect(sleeves[0]!.label).toBe("BTC");
    expect(sleeves[1]!.pair).toBe("ETH-USD");
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
