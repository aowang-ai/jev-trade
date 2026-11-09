import { expect, test } from "bun:test";
import { Feed } from "../src/feed";
import { Market } from "../src/market";
import { DEFAULT_READ_ONLY_WALLETS } from "../src/sleeves";

test("Market read-only sleeve has address but no ExchangeClient", () => {
  const prevExec = process.env.EXECUTION_ENABLED;
  const prevRestore = process.env.RESTORATION_MODE;
  process.env.EXECUTION_ENABLED = "false";
  process.env.RESTORATION_MODE = "true";
  try {
    const feed = new Feed("BTC");
    const market = new Market(feed, {
      coin: "BTC",
      pair: "BTC-USD",
      label: "BTC",
      watchAddress: DEFAULT_READ_ONLY_WALLETS.BTC as `0x${string}`,
    });
    expect(market.address?.toLowerCase()).toBe(DEFAULT_READ_ONLY_WALLETS.BTC.toLowerCase());
    expect(market.wallet).toBeNull();
    expect(market.signingEnabled).toBe(false);
  } finally {
    if (prevExec == null) delete process.env.EXECUTION_ENABLED;
    else process.env.EXECUTION_ENABLED = prevExec;
    if (prevRestore == null) delete process.env.RESTORATION_MODE;
    else process.env.RESTORATION_MODE = prevRestore;
  }
});
