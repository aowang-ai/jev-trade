import { sameCoin } from "./sleeves";

export interface VenueAccount {
  /** Signed base size. Positive = long, negative = short. */
  positionSz: number;
  entryPrice: number | null;
  unrealizedUsd: number;
  realizedUsd: number;
  feesUsd: number;
  accountValue: number;
  withdrawable: number;
  leverage: number | null;
}

export interface ClearinghouseLike {
  withdrawable?: string;
  marginSummary?: { accountValue?: string };
  assetPositions?: Array<{
    position?: {
      coin?: string;
      szi?: string;
      entryPx?: string;
      unrealizedPnl?: string;
      leverage?: { type?: string; value?: number };
    };
  }>;
}

export interface FillPnlLike {
  coin?: string;
  closedPnl?: string | number;
  fee?: string | number;
  hash?: string;
  tid?: number | string;
  oid?: number | string;
  time?: number;
  px?: string | number;
  sz?: string | number;
  side?: string;
  dir?: string;
}

export type FillDir = "open" | "close" | "flip";

/** Hyperliquid `dir`: Open Long, Close Short, Long > Short, ... */
export function fillDir(dir?: string): FillDir | undefined {
  if (!dir) return undefined;
  const d = dir.toLowerCase();
  if (d.includes(">")) return "flip";
  if (d.includes("open")) return "open";
  if (d.includes("close")) return "close";
  return undefined;
}

export function fillKey(f: FillPnlLike): string {
  if (f.hash != null && f.tid != null) return `${f.hash}:${f.tid}`;
  if (f.oid != null && f.tid != null) return `${f.oid}:${f.tid}`;
  return `${f.hash ?? ""}:${f.oid ?? ""}:${f.closedPnl ?? ""}:${f.fee ?? ""}`;
}

/** Position, mark PnL and equity from Hyperliquid clearinghouseState. Realized/fees come from fills. */
export function accountFromClearinghouse(
  state: ClearinghouseLike,
  coin: string,
  prev?: VenueAccount | null,
): VenueAccount {
  const pos = state.assetPositions?.find((p) => sameCoin(p.position?.coin, coin))?.position;
  const szi = pos?.szi != null ? Number(pos.szi) : 0;
  const size = Number.isFinite(szi) ? szi : 0;
  const entry = pos?.entryPx != null ? Number(pos.entryPx) : NaN;
  const unreal = pos?.unrealizedPnl != null ? Number(pos.unrealizedPnl) : 0;
  const accountValue = Number(state.marginSummary?.accountValue ?? 0);
  const withdrawable = Number(state.withdrawable ?? 0);
  const lev = pos?.leverage?.value != null ? Number(pos.leverage.value) : NaN;
  return {
    positionSz: size,
    entryPrice: size && Number.isFinite(entry) ? entry : null,
    unrealizedUsd: Number.isFinite(unreal) ? unreal : 0,
    realizedUsd: prev?.realizedUsd ?? 0,
    feesUsd: prev?.feesUsd ?? 0,
    accountValue: Number.isFinite(accountValue) ? accountValue : 0,
    withdrawable: Number.isFinite(withdrawable) ? withdrawable : 0,
    leverage: Number.isFinite(lev) && lev > 0 ? lev : prev?.leverage ?? null,
  };
}

export class FillPnlBook {
  realized = 0;
  fees = 0;
  private seen = new Set<string>();

  add(fill: FillPnlLike, coin: string): boolean {
    if (fill.coin != null && !sameCoin(fill.coin, coin)) return false;
    const key = fillKey(fill);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    const closed = Number(fill.closedPnl ?? 0);
    const fee = Number(fill.fee ?? 0);
    if (Number.isFinite(closed)) this.realized += closed;
    if (Number.isFinite(fee)) this.fees += fee;
    return true;
  }

  apply(account: VenueAccount): VenueAccount {
    return { ...account, realizedUsd: this.realized, feesUsd: this.fees };
  }
}
