import type { Book, Side } from "./types";
import { config } from "./config";

export interface HlLevel { px: string; sz: string }

/** Perp tick: 10^-(6 - szDecimals). BTC szDecimals=5 => 0.1. */
export function priceTick(szDecimals: number): number {
  return 10 ** -Math.max(0, 6 - szDecimals);
}

export function alignPrice(price: number, szDecimals: number): number {
  const tick = priceTick(szDecimals);
  const decimals = Math.max(0, 6 - szDecimals);
  return Number((Math.round(price / tick) * tick).toFixed(decimals));
}

/**
 * Post-only price `quoteInsideTicks` inside the touch. Never crosses.
 * If the spread is too tight, join the touch.
 */
export function quotePrice(side: Side, book: Book, szDecimals: number, inside = config.quoteInsideTicks): number {
  const tick = priceTick(szDecimals);
  const step = inside * tick;
  let raw = side === "buy" ? book.bid + step : book.ask - step;
  if (side === "buy" && raw >= book.ask) raw = book.bid;
  if (side === "sell" && raw <= book.bid) raw = book.ask;
  return alignPrice(raw, szDecimals);
}

/**
 * Crossing limit for an Ioc exit. Walks `slippageBps` past the far touch so the
 * order clears the visible book instead of resting on it. Rounds away from the
 * touch so tick alignment can never pull the price back inside the spread.
 */
export function takerPrice(side: Side, book: Book, szDecimals: number, slippageBps = config.closeSlippageBps): number {
  const tick = priceTick(szDecimals);
  const decimals = Math.max(0, 6 - szDecimals);
  const bps = Math.max(0, slippageBps) / 10_000;
  const raw = side === "buy" ? book.ask * (1 + bps) : book.bid * (1 - bps);
  const away = side === "buy" ? Math.ceil(raw / tick) : Math.floor(raw / tick);
  return Number(Math.max(tick, away * tick).toFixed(decimals));
}

export function bookFromLevels(block: number, bids: HlLevel[], asks: HlLevel[]): Book | null {
  const bidLv: [number, number][] = [];
  const askLv: [number, number][] = [];
  for (const l of bids) {
    const px = Number(l.px), sz = Number(l.sz);
    if (px > 0 && sz > 0) bidLv.push([px, sz]);
  }
  for (const l of asks) {
    const px = Number(l.px), sz = Number(l.sz);
    if (px > 0 && sz > 0) askLv.push([px, sz]);
  }
  if (!bidLv.length && askLv.length) {
    const [ask, sz] = askLv[0]!;
    bidLv.push([ask * (1 - 0.0005), sz]);
  } else if (!askLv.length && bidLv.length) {
    const [bid, sz] = bidLv[0]!;
    askLv.push([bid * (1 + 0.0005), sz]);
  }
  if (!bidLv.length || !askLv.length) return null;
  bidLv.sort((a, b) => b[0] - a[0]);
  askLv.sort((a, b) => a[0] - b[0]);
  const bid = bidLv[0]![0], ask = askLv[0]![0];
  if (!(ask > bid)) return null;
  const mid = (bid + ask) / 2;
  const spreadBps = ((ask - bid) / mid) * 10_000;
  const near = (side: [number, number][], maxBps: number) => {
    let d = 0;
    for (const [px, sz] of side) {
      const bps = Math.abs(px - mid) / mid * 10_000;
      if (bps <= maxBps) d += sz;
    }
    return d;
  };
  const bid1 = near(bidLv, 100), ask1 = near(askLv, 100);
  const tot = bid1 + ask1;
  return {
    block,
    bid,
    ask,
    mid,
    spreadBps,
    imbalance: tot > 0 ? (bid1 - ask1) / tot : 0,
    levels: { bids: bidLv.slice(0, 5), asks: askLv.slice(0, 5) },
    depthBps: {
      "10": { bid: near(bidLv, 10), ask: near(askLv, 10) },
      "25": { bid: near(bidLv, 25), ask: near(askLv, 25) },
      "50": { bid: near(bidLv, 50), ask: near(askLv, 50) },
    },
  };
}
