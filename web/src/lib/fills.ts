import type { PricePoint } from "./bot-types";

export type TapeFill = {
  key: string;
  ts: number;
  side: "buy" | "sell";
  price: number;
  size: number;
  dir?: "open" | "close" | "flip";
  hash?: string;
  closedPnl?: number;
  feeUsd?: number;
};

export type ClosedLot = {
  key: string;
  ts: number;
  openedTs: number | null;
  side: "long" | "short";
  size: number;
  entry: number | null;
  exit: number;
  pnl: number;
  fee: number;
  hash?: string;
};

const EPS = 1e-12;

/** Venue fills already sitting on the mid tape. Newest last. */
export function tapeFills(tape: PricePoint[]): TapeFill[] {
  const out: TapeFill[] = [];
  for (const p of tape) {
    const f = p.fill;
    if (!f || !(f.size > 0) || !(p.ts > 0)) continue;
    out.push({
      key: `${p.ts}|${f.side}|${f.price}|${f.size}|${f.dir ?? ""}|${f.hash ?? ""}`,
      ts: p.ts,
      side: f.side,
      price: f.price,
      size: f.size,
      dir: f.dir,
      hash: f.hash,
      closedPnl: f.closedPnl,
      feeUsd: f.feeUsd,
    });
  }
  return out;
}

function inferDir(pos: number, side: "buy" | "sell"): "open" | "close" {
  if (Math.abs(pos) <= EPS) return "open";
  const add = side === "buy" ? 1 : -1;
  return Math.sign(pos) === add ? "open" : "close";
}

function markPnl(side: "long" | "short", size: number, entry: number | null, exit: number): number {
  if (entry == null || !(size > 0)) return 0;
  return side === "long" ? (exit - entry) * size : (entry - exit) * size;
}

/** Closed lots from the fill tape. One row per close or flip, like a futures position history. */
export function closedLots(fills: TapeFill[]): ClosedLot[] {
  const sorted = [...fills].sort((a, b) => a.ts - b.ts || a.key.localeCompare(b.key));
  let pos = 0;
  let avgEntry: number | null = null;
  let openedTs: number | null = null;
  const out: ClosedLot[] = [];

  const emit = (f: TapeFill, side: "long" | "short", size: number) => {
    if (!(size > EPS)) return;
    const venue = f.closedPnl;
    const pnl = typeof venue === "number" && Number.isFinite(venue)
      ? venue
      : markPnl(side, size, avgEntry, f.price);
    const fee = typeof f.feeUsd === "number" && Number.isFinite(f.feeUsd) ? f.feeUsd : 0;
    out.push({
      key: `${f.key}|${side}|${size}`,
      ts: f.ts,
      openedTs,
      side,
      size,
      entry: avgEntry,
      exit: f.price,
      pnl,
      fee,
      hash: f.hash,
    });
  };

  for (const f of sorted) {
    let dir = f.dir ?? inferDir(pos, f.side);
    if (dir === "close" && Math.abs(pos) > EPS && f.size > Math.abs(pos) + EPS) dir = "flip";
    const sideNow: "long" | "short" = pos >= 0 ? "long" : "short";

    if (dir === "open") {
      const abs = Math.abs(pos);
      avgEntry = abs <= EPS ? f.price : ((avgEntry ?? f.price) * abs + f.price * f.size) / (abs + f.size);
      if (abs <= EPS) openedTs = f.ts;
      pos += f.side === "buy" ? f.size : -f.size;
      continue;
    }

    if (dir === "close") {
      const closedSz = Math.min(f.size, Math.abs(pos));
      emit(f, sideNow, closedSz);
      pos += pos > 0 ? -closedSz : closedSz;
      if (Math.abs(pos) <= EPS) {
        pos = 0;
        avgEntry = null;
        openedTs = null;
      }
      continue;
    }

    const closedSz = Math.abs(pos);
    if (closedSz > EPS) emit(f, sideNow, closedSz);
    const leftover = Math.max(0, f.size - closedSz);
    if (leftover > EPS) {
      pos = f.side === "buy" ? leftover : -leftover;
      avgEntry = f.price;
      openedTs = f.ts;
    } else {
      pos = 0;
      avgEntry = null;
      openedTs = null;
    }
  }

  return out;
}
