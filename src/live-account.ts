import { config } from "./config";
import type { Market } from "./market";
import type { LiveAccountSnapshot } from "./types";

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** Hyperliquid clearinghouse row for one sleeve (read-only, not from archived ticks). */
export function liveAccountFromMarket(market: Market, updatedAt = Date.now()): LiveAccountSnapshot {
  const a = market.account;
  if (!market.address) {
    return {
      coin: market.coin,
      status: "unavailable",
      network: config.networkLabel,
      wallet: null,
      accountValue: null,
      withdrawable: null,
      updatedAt,
    };
  }
  if (!a) {
    return {
      coin: market.coin,
      status: "pending",
      network: config.networkLabel,
      wallet: market.address,
      accountValue: null,
      withdrawable: null,
      updatedAt,
    };
  }
  return {
    coin: market.coin,
    status: "ok",
    network: config.networkLabel,
    wallet: market.address,
    accountValue: Number.isFinite(a.accountValue) ? round(a.accountValue, 2) : null,
    withdrawable: Number.isFinite(a.withdrawable) ? round(a.withdrawable, 2) : null,
    updatedAt,
    position: {
      side: !a.positionSz ? "flat" : a.positionSz > 0 ? "long" : "short",
      size: Math.abs(a.positionSz),
      entryPrice: a.entryPrice,
      leverage: a.leverage,
      unrealizedUsd: a.unrealizedUsd,
      unrealizedSz: (() => {
        const mid = market.priceBook?.mid;
        return mid && mid > 0 ? a.unrealizedUsd / mid : 0;
      })(),
    },
  };
}

export function liveAccountsFromMarkets(markets: Market[]): Record<string, LiveAccountSnapshot> {
  const out: Record<string, LiveAccountSnapshot> = {};
  const at = Date.now();
  for (const m of markets) out[m.coin] = liveAccountFromMarket(m, at);
  return out;
}
