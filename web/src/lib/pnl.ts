import type { BlockEvent, LiveAccountSnapshot } from "./bot-types";

export type SleevePnl = {
  coin: string;
  unrealized: number;
  realized: number;
  open: boolean;
};

export function sleevePnl(latest: BlockEvent | null | undefined): SleevePnl {
  const pos = latest?.position;
  const open = Boolean(pos && pos.side !== "flat" && pos.size > 0);
  const unrealized = open && typeof pos?.unrealizedUsd === "number" && Number.isFinite(pos.unrealizedUsd)
    ? pos.unrealizedUsd
    : 0;
  const realized = typeof latest?.totals?.realizedUsd === "number" && Number.isFinite(latest.totals.realizedUsd)
    ? latest.totals.realizedUsd
    : 0;
  return { coin: latest?.coin ?? "", unrealized, realized, open };
}

export function portfolioPnl(latestByCoin: Record<string, BlockEvent | null | undefined>): {
  unrealized: number;
  realized: number;
} {
  let unrealized = 0;
  let realized = 0;
  for (const latest of Object.values(latestByCoin)) {
    const row = sleevePnl(latest);
    unrealized += row.unrealized;
    realized += row.realized;
  }
  return { unrealized, realized };
}

export type PortfolioBalanceView = {
  /** Total account equity when known. */
  value: number | null;
  /** At least one live row exists (restoration / read-only wallets). */
  hasLive: boolean;
  /** Still waiting on first HL clearinghouse response. */
  pending: boolean;
  /** HL row failed or no wallet configured. */
  unavailable: boolean;
};

/** Sum Hyperliquid account equity. Prefers live clearinghouse snapshots over archived tick fields. */
export function portfolioBalanceView(
  latestByCoin: Record<string, BlockEvent | null | undefined>,
  liveByCoin?: Record<string, LiveAccountSnapshot>,
): PortfolioBalanceView {
  const live = liveByCoin ?? {};
  const keys = Object.keys(live);
  if (keys.length) {
    let sum = 0;
    let anyOk = false;
    let pending = false;
    let unavailable = false;
    for (const row of Object.values(live)) {
      if (row.status === "ok" && typeof row.accountValue === "number" && Number.isFinite(row.accountValue)) {
        sum += row.accountValue;
        anyOk = true;
      } else if (row.status === "pending") pending = true;
      else if (row.status === "unavailable") unavailable = true;
    }
    return {
      value: anyOk ? sum : null,
      hasLive: true,
      pending: pending && !anyOk,
      unavailable: unavailable && !anyOk && !pending,
    };
  }
  let sum = 0;
  let any = false;
  for (const latest of Object.values(latestByCoin)) {
    const v = latest?.accountValue;
    if (typeof v === "number" && Number.isFinite(v)) {
      sum += v;
      any = true;
    }
  }
  return {
    value: any ? sum : null,
    hasLive: false,
    pending: !any,
    unavailable: false,
  };
}

/** @deprecated use portfolioBalanceView */
export function portfolioBalance(latestByCoin: Record<string, BlockEvent | null | undefined>): number | null {
  return portfolioBalanceView(latestByCoin).value;
}

/** Unrealized as a percent of initial margin, when size, entry, and leverage exist. */
export function roePct(pos: {
  side: string;
  size: number;
  entryPrice: number | null;
  leverage: number | null;
  unrealizedUsd: number;
} | null | undefined): number | null {
  if (!pos || pos.side === "flat" || !(pos.size > 0) || !(pos.entryPrice && pos.entryPrice > 0)) return null;
  const lev = pos.leverage && pos.leverage > 0 ? pos.leverage : 1;
  const margin = (pos.size * pos.entryPrice) / lev;
  if (!(margin > 0)) return null;
  return pos.unrealizedUsd / margin;
}
