import { expect, test } from "bun:test";
import { accountFromClearinghouse } from "../src/account";
import { Feed } from "../src/feed";
import { liveAccountFromMarket } from "../src/live-account";
import { Market } from "../src/market";
import { DEFAULT_READ_ONLY_WALLETS } from "../src/sleeves";

test("liveAccountFromMarket uses HL clearinghouse not archived ticks", () => {
  const prevRestore = process.env.RESTORATION_MODE;
  process.env.RESTORATION_MODE = "true";
  try {
    const feed = new Feed("BTC");
    const market = new Market(feed, {
      coin: "BTC",
      pair: "BTC-USD",
      label: "BTC",
      watchAddress: DEFAULT_READ_ONLY_WALLETS.BTC as `0x${string}`,
    });
    market.applyClearinghouse({
      withdrawable: "139.233997",
      marginSummary: { accountValue: "139.837925" },
      assetPositions: [
        {
          position: {
            coin: "BTC",
            szi: "-0.00008",
            entryPx: "77000",
            unrealizedPnl: "0.5",
            leverage: { value: 3 },
          },
        },
      ],
    });
    const row = liveAccountFromMarket(market);
    expect(row.status).toBe("ok");
    expect(row.accountValue).toBeCloseTo(139.84, 1);
    expect(row.withdrawable).toBeCloseTo(139.23, 1);
    expect(row.network).toBe("hyperliquid-testnet");
    expect(row.position?.side).toBe("short");
  } finally {
    if (prevRestore == null) delete process.env.RESTORATION_MODE;
    else process.env.RESTORATION_MODE = prevRestore;
  }
});

test("accountFromClearinghouse stays compatible with HL testnet info shape", () => {
  const state = {
    marginSummary: { accountValue: "139.837925" },
    withdrawable: "139.233997",
    assetPositions: [{ position: { coin: "BTC", szi: "-0.00008", entryPx: "77000", unrealizedPnl: "0.12" } }],
  };
  const a = accountFromClearinghouse(state, "BTC", null);
  expect(a.accountValue).toBeCloseTo(139.837925);
  expect(a.withdrawable).toBeCloseTo(139.233997);
});
