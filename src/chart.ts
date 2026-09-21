import { config } from "./config";
import type { PricePoint, Side } from "./types";

const INFO_URL = (testnet: boolean) =>
  testnet ? "https://api.hyperliquid-testnet.xyz/info" : "https://api.hyperliquid.xyz/info";

export const CHART_INTERVAL = "1m";
export const CHART_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const SECOND_MS = 1000;
const MAX_CANDLES = 5000;
const MAX_1S = 15 * 60;

export type BarSize = NonNullable<PricePoint["bar"]>;

export type Ohlc = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type VenueFill = {
  ts: number;
  side: Side;
  price: number;
  size: number;
  dir?: NonNullable<PricePoint["fill"]>["dir"];
  hash?: string;
  closedPnl?: number;
  feeUsd?: number;
};

export function fillKey(f: VenueFill): string {
  return `${f.ts}|${f.side}|${f.price}|${f.size}`;
}

export function candleBar(raw: { i?: unknown }): BarSize {
  if (raw.i === "15m") return "15m";
  if (raw.i === "1s") return "1s";
  return "1m";
}

export function candleOhlc(raw: { t?: unknown; o?: unknown; h?: unknown; l?: unknown; c?: unknown }): Ohlc | null {
  const ts = Number(raw.t);
  const close = Number(raw.c);
  if (!Number.isFinite(ts) || ts <= 0 || !Number.isFinite(close) || close <= 0) return null;
  const open = Number(raw.o);
  const high = Number(raw.h);
  const low = Number(raw.l);
  const o = Number.isFinite(open) && open > 0 ? open : close;
  const h = Number.isFinite(high) && high > 0 ? high : Math.max(o, close);
  const l = Number.isFinite(low) && low > 0 ? low : Math.min(o, close);
  return { ts, open: o, high: Math.max(h, o, close), low: Math.min(l, o, close), close };
}

/** @deprecated use candleOhlc */
export function candleMid(raw: { t?: unknown; c?: unknown }): { ts: number; mid: number } | null {
  const bar = candleOhlc(raw);
  return bar ? { ts: bar.ts, mid: bar.close } : null;
}

function toPoint(bar: BarSize, c: Ohlc): PricePoint {
  return { ts: c.ts, mid: c.close, open: c.open, high: c.high, low: c.low, close: c.close, bar };
}

/** Price candles from the venue. Marks from venue user fills. */
export class VenueChart {
  private candles1s = new Map<number, Ohlc>();
  private candles1m = new Map<number, Ohlc>();
  private candles15m = new Map<number, Ohlc>();
  private last1s: Ohlc | null = null;
  private fills: VenueFill[] = [];
  private seen = new Set<string>();
  private cached: PricePoint[] = [];
  private dirty = true;

  closes(limit = 80): number[] {
    const times = [...this.candles1m.keys()].sort((a, b) => a - b);
    return times.slice(-Math.max(1, limit)).map((ts) => this.candles1m.get(ts)!.close);
  }

  get points(): PricePoint[] {
    if (!this.dirty) return this.cached;
    this.cached = this.build();
    this.dirty = false;
    return this.cached;
  }

  async loadCandles(coin: string, now = Date.now()) {
    const minuteSpan = MAX_CANDLES * MINUTE_MS;
    await Promise.all([
      this.pullCandles(coin, "15m", now - CHART_LOOKBACK_MS, now),
      this.pullCandles(coin, "1m", now - minuteSpan, now),
    ]);
  }

  private async pullCandles(coin: string, interval: string, startTime: number, endTime: number) {
    const res = await fetch(INFO_URL(config.hlTestnet), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval, startTime, endTime } }),
    });
    if (!res.ok) throw new Error(`hl candleSnapshot HTTP ${res.status}`);
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (row && typeof row === "object") this.upsertCandle(row as { t?: unknown; o?: unknown; h?: unknown; l?: unknown; c?: unknown; i?: unknown });
    }
  }

  /** Fold a live mid into the forming 1s candle. Venue has no 1s snapshot. */
  addMid(mid: number, ts: number) {
    if (!(mid > 0) || !(ts > 0)) return;
    const bucket = Math.floor(ts / SECOND_MS) * SECOND_MS;
    const prev = this.candles1s.get(bucket);
    if (prev) {
      const high = Math.max(prev.high, mid);
      const low = Math.min(prev.low, mid);
      if (high === prev.high && low === prev.low && mid === prev.close) return;
      const next = { ts: bucket, open: prev.open, high, low, close: mid };
      this.candles1s.set(bucket, next);
      this.last1s = next;
    } else {
      const open = this.last1s && this.last1s.ts < bucket ? this.last1s.close : mid;
      const next = { ts: bucket, open, high: mid, low: mid, close: mid };
      this.candles1s.set(bucket, next);
      this.last1s = next;
      if (this.candles1s.size > MAX_1S) {
        const cutoff = bucket - MAX_1S * SECOND_MS;
        for (const t of this.candles1s.keys()) if (t < cutoff) this.candles1s.delete(t);
      }
    }
    this.dirty = true;
  }

  upsertCandle(raw: { t?: unknown; o?: unknown; h?: unknown; l?: unknown; c?: unknown; i?: unknown }) {
    const next = candleOhlc(raw);
    if (!next) return;
    const bar = candleBar(raw);
    const map = bar === "15m" ? this.candles15m : bar === "1s" ? this.candles1s : this.candles1m;
    const prev = map.get(next.ts);
    if (prev && prev.open === next.open && prev.high === next.high && prev.low === next.low && prev.close === next.close) return;
    map.set(next.ts, next);
    this.dirty = true;
  }

  addFill(fill: VenueFill): boolean {
    if (!Number.isFinite(fill.ts) || fill.ts <= 0) return false;
    if (!Number.isFinite(fill.price) || fill.price <= 0) return false;
    const key = fillKey(fill);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.fills.push(fill);
    this.dirty = true;
    return true;
  }

  addFills(fills: VenueFill[]) {
    for (const f of fills) this.addFill(f);
  }

  private build(): PricePoint[] {
    const pts: PricePoint[] = [];
    for (const c of this.candles15m.values()) pts.push(toPoint("15m", c));
    for (const c of this.candles1m.values()) pts.push(toPoint("1m", c));
    for (const c of this.candles1s.values()) pts.push(toPoint("1s", c));
    for (const f of this.fills) {
      pts.push({
        ts: f.ts,
        mid: f.price,
        fill: {
          side: f.side,
          price: f.price,
          size: f.size,
          dir: f.dir,
          hash: f.hash,
          closedPnl: f.closedPnl,
          feeUsd: f.feeUsd,
        },
      });
    }
    pts.sort((a, b) => a.ts - b.ts || (a.fill ? 1 : 0) - (b.fill ? 1 : 0) || (a.bar === "15m" ? -1 : 1));
    return pts;
  }
}
