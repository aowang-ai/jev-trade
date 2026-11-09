import { expect, test } from "bun:test";
import { DEFAULT_READ_ONLY_WALLETS, loadSleeves, parseReadOnlyWalletsJson } from "../src/sleeves";

test("parseReadOnlyWalletsJson accepts map or sleeves array", () => {
  const a = parseReadOnlyWalletsJson(JSON.stringify({ BTC: DEFAULT_READ_ONLY_WALLETS.BTC }));
  expect(a.get("BTC")).toBe(DEFAULT_READ_ONLY_WALLETS.BTC);
  const b = parseReadOnlyWalletsJson(JSON.stringify({ sleeves: [{ coin: "ETH", address: DEFAULT_READ_ONLY_WALLETS.ETH }] }));
  expect(b.get("ETH")?.toLowerCase()).toBe(DEFAULT_READ_ONLY_WALLETS.ETH.toLowerCase());
});

test("loadSleeves attaches default read-only wallets in restoration mode", () => {
  const prev = process.env.RESTORATION_MODE;
  const prevCoins = process.env.HL_COINS;
  const prevKey = process.env.PRIVATE_KEY;
  process.env.RESTORATION_MODE = "true";
  process.env.HL_COINS = "BTC,ETH";
  delete process.env.PRIVATE_KEY;
  delete process.env.READ_ONLY_WALLETS_JSON;
  try {
    const sleeves = loadSleeves();
    expect(sleeves[0]!.watchAddress?.toLowerCase()).toBe(DEFAULT_READ_ONLY_WALLETS.BTC.toLowerCase());
    expect(sleeves[0]!.privateKey).toBeUndefined();
    expect(sleeves[1]!.watchAddress?.toLowerCase()).toBe(DEFAULT_READ_ONLY_WALLETS.ETH.toLowerCase());
  } finally {
    if (prev == null) delete process.env.RESTORATION_MODE;
    else process.env.RESTORATION_MODE = prev;
    if (prevCoins == null) delete process.env.HL_COINS;
    else process.env.HL_COINS = prevCoins;
    if (prevKey == null) delete process.env.PRIVATE_KEY;
    else process.env.PRIVATE_KEY = prevKey;
  }
});

test("assertRestorationSafety rejects PRIVATE_KEY", async () => {
  const prev = process.env.RESTORATION_MODE;
  const prevKey = process.env.PRIVATE_KEY;
  process.env.RESTORATION_MODE = "true";
  process.env.PRIVATE_KEY = `0x${"aa".repeat(32)}`;
  try {
    const { assertRestorationSafety } = await import("../src/config");
    expect(() => assertRestorationSafety()).toThrow(/PRIVATE_KEY/);
  } finally {
    if (prev == null) delete process.env.RESTORATION_MODE;
    else process.env.RESTORATION_MODE = prev;
    if (prevKey == null) delete process.env.PRIVATE_KEY;
    else process.env.PRIVATE_KEY = prevKey;
  }
});
