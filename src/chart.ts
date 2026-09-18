import { config } from "./config";
import type { PricePoint, Side } from "./types";

const INFO_URL = (testnet: boolean) =>
  testnet ? "https://api.hyperliquid-testnet.xyz/info" : "https://api.hyperliquid.xyz/info";

export const CHART_INTERVAL = "1m";
export const CHART_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const MAX_CANDLES = 5000;

export type VenueFill = {
  ts: number;
  side: Side;
  price: number;
  size: number;
  dir?: NonNullable<PricePoint["fill"]>["dir"];
  hash?: string;
};

export function fillKey(f: VenueFill): string {
  return `${f.ts}|${f.side}|${f.price}|${f.size}`;
}

export function candleMid(raw: { t?: unknown; c?: unknown }): { ts: number; mid: number } | null {
  const ts = Number(raw.t);
  const mid = Number(raw.c);
  if (!Number.isFinite(ts) || ts <= 0 || !Number.isFinite(mid) || mid <= 0) return null;
  return { ts, mid };
}

/** Price line from venue candles. Marks from venue user fills. Nothing we invent. */
export class VenueChart {
  private candles = new Map<number, number>();
  private fills: VenueFill[] = [];
  private seen = new Set<string>();
  private cached: PricePoint[] = [];
  private dirty = true;

  closes(limit = 80): number[] {
    const times = [...this.candles.keys()].sort((a, b) => a - b);
    return times.slice(-Math.max(1, limit)).map((ts) => this.candles.get(ts)!);
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
      if (row && typeof row === "object") this.upsertCandle(row as { t?: unknown; c?: unknown });
    }
  }

  upsertCandle(raw: { t?: unknown; c?: unknown }) {
    const next = candleMid(raw);
    if (!next) return;
    if (this.candles.get(next.ts) === next.mid) return;
    this.candles.set(next.ts, next.mid);
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
    const times = [...this.candles.keys()].sort((a, b) => a - b);
    for (const ts of times) pts.push({ ts, mid: this.candles.get(ts)! });
    for (const f of this.fills) {
      pts.push({
        ts: f.ts,
        mid: f.price,
        fill: { side: f.side, price: f.price, size: f.size, dir: f.dir, hash: f.hash },
      });
    }
    pts.sort((a, b) => a.ts - b.ts || (a.fill ? 1 : 0) - (b.fill ? 1 : 0));
    return pts;
  }
}
