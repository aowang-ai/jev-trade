import type { Fill, Side } from "./types";

export interface TradePrint { block: number; price: number; size: number; side: Side }

/** One of our resting orders got hit. `side` is our maker side. */
export interface MakerFill {
  block: number;
  txHash: string;
  orderId: number;
  price: number;
  size: number;
  updatedSize: number;
  side: Side;
  feeUsd?: number;
  closedPnl?: number;
  dir?: Fill["dir"];
}

export interface TradeSummary {
  count: number;
  buySz: number;
  sellSz: number;
  cvdSz: number;
  vwap: number | null;
  lastPrice: number | null;
  lastSide: Side | null;
}

export interface Resting { side: Side; price: number; size: number; block: number }

export const emptySummary = (): TradeSummary => ({
  count: 0, buySz: 0, sellSz: 0, cvdSz: 0, vwap: null, lastPrice: null, lastSide: null,
});

const RING = 500;

/** WebSocket-backed print/fill ring. */
export class TradeFeed {
  private trades: TradePrint[] = [];
  private fresh: TradePrint[] = [];
  private fills: MakerFill[] = [];
  tick = 0;

  setTick(tick: number) {
    this.tick = tick;
  }

  pushPrint(p: Omit<TradePrint, "block"> & { block?: number }) {
    const t: TradePrint = { block: p.block ?? this.tick, price: p.price, size: p.size, side: p.side };
    if (t.size <= 0 || t.price <= 0) return;
    this.trades.push(t);
    this.fresh.push(t);
    if (this.trades.length > RING) this.trades.splice(0, this.trades.length - RING);
  }

  pushFill(f: MakerFill) {
    this.fills.push(f);
  }

  summary(lastTicks: number, currentTick: number): TradeSummary {
    const minTick = currentTick - lastTicks;
    let count = 0, buySz = 0, sellSz = 0, notional = 0;
    let lastPrice: number | null = null, lastSide: Side | null = null;
    for (const t of this.trades) {
      if (t.block <= minTick) continue;
      count++;
      if (t.side === "buy") buySz += t.size; else sellSz += t.size;
      notional += t.size * t.price;
      lastPrice = t.price;
      lastSide = t.side;
    }
    const vol = buySz + sellSz;
    return { count, buySz, sellSz, cvdSz: buySz - sellSz, vwap: vol > 0 ? notional / vol : null, lastPrice, lastSide };
  }

  recent(n: number): TradePrint[] {
    return this.trades.slice(-n);
  }

  drainPrints(): TradePrint[] {
    const out = this.fresh;
    this.fresh = [];
    return out;
  }

  drainFills(): MakerFill[] {
    const out = this.fills;
    this.fills = [];
    return out;
  }
}

export function takeLiveFills(orders: Map<number, Resting>, raw: MakerFill[]): (Fill & { block: number })[] {
  const out: (Fill & { block: number })[] = [];
  for (const f of raw) {
    const o = orders.get(f.orderId);
    const remaining = f.updatedSize >= 0 ? f.updatedSize : Math.max(0, (o?.size ?? 0) - f.size);
    if (remaining <= 0) orders.delete(f.orderId);
    else if (o) o.size = remaining;
    out.push({
      side: f.side,
      size: f.size,
      price: f.price,
      txHash: f.txHash,
      orderId: f.orderId,
      simulated: false,
      block: f.block,
      feeUsd: f.feeUsd,
      closedPnl: f.closedPnl,
      dir: f.dir,
    });
  }
  return out;
}

export function takeSimFills(orders: Map<number, Resting>, prints: TradePrint[]): (Fill & { block: number })[] {
  const out: (Fill & { block: number })[] = [];
  for (const p of prints) {
    for (const [id, o] of orders) {
      if (p.block < o.block || o.size <= 0) continue;
      const hit = o.side === "buy" ? p.side === "sell" && p.price <= o.price : p.side === "buy" && p.price >= o.price;
      if (!hit) continue;
      const size = Math.min(o.size, p.size);
      o.size -= size;
      if (o.size <= 1e-9) orders.delete(id);
      out.push({ side: o.side, size, price: o.price, txHash: null, orderId: id, simulated: true, block: p.block });
    }
  }
  return out;
}

export function aggregateFills(fills: Fill[]): Fill {
  const buy = fills.filter((f) => f.side === "buy").reduce((s, f) => s + f.size, 0);
  const sell = fills.filter((f) => f.side === "sell").reduce((s, f) => s + f.size, 0);
  const side: Side = buy >= sell ? "buy" : "sell";
  const same = fills.filter((f) => f.side === side);
  const size = same.reduce((s, f) => s + f.size, 0);
  const price = same.reduce((s, f) => s + f.size * f.price, 0) / size;
  const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
  return { side, size: round4(size), price, txHash: same[0]!.txHash, orderId: same[0]!.orderId, simulated: same[0]!.simulated, dir: same[0]!.dir };
}
