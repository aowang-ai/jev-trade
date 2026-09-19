import type { BlockEvent } from "./bot-types";

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

/** Sum of Hyperliquid account equity across sleeve wallets. */
export function portfolioBalance(latestByCoin: Record<string, BlockEvent | null | undefined>): number | null {
  let sum = 0;
  let any = false;
  for (const latest of Object.values(latestByCoin)) {
    const v = latest?.accountValue;
    if (typeof v === "number" && Number.isFinite(v)) {
      sum += v;
      any = true;
    }
  }
  return any ? sum : null;
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
