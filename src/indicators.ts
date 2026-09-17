/** Compact numbers from a close series. Used as Jev inputs, not as a trading gate. */

export function sma(xs: number[], n: number): number | null {
  if (xs.length < n || n <= 0) return null;
  let s = 0;
  for (let i = xs.length - n; i < xs.length; i++) s += xs[i]!;
  return s / n;
}

export function ema(xs: number[], n: number): number | null {
  if (xs.length < n || n <= 0) return null;
  const k = 2 / (n + 1);
  let e = 0;
  for (let i = 0; i < n; i++) e += xs[i]!;
  e /= n;
  for (let i = n; i < xs.length; i++) e = xs[i]! * k + e * (1 - k);
  return e;
}

export function rsi(xs: number[], n = 14): number | null {
  if (xs.length < n + 1 || n <= 0) return null;
  let gain = 0;
  let loss = 0;
  const start = xs.length - n;
  for (let i = start; i < xs.length; i++) {
    const d = xs[i]! - xs[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  const avgGain = gain / n;
  const avgLoss = loss / n;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export function realizedVolBps(xs: number[], n: number): number | null {
  if (xs.length < n + 1 || n <= 1) return null;
  const rets: number[] = [];
  for (let i = xs.length - n; i < xs.length; i++) {
    const a = xs[i - 1]!;
    const b = xs[i]!;
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 2) return null;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  let v = 0;
  for (const x of rets) v += (x - mean) ** 2;
  return Math.sqrt(v / (rets.length - 1)) * 10_000;
}

export function rangeWindow(xs: number[], n: number): { high: number; low: number; pos: number } | null {
  if (xs.length < n || n <= 0) return null;
  const slice = xs.slice(-n);
  let high = slice[0]!;
  let low = slice[0]!;
  for (const x of slice) {
    if (x > high) high = x;
    if (x < low) low = x;
  }
  const last = slice[slice.length - 1]!;
  return { high, low, pos: high === low ? 0.5 : (last - low) / (high - low) };
}

export function bpsBetween(from: number | null | undefined, to: number): number | null {
  if (from == null || !(from > 0) || !Number.isFinite(to)) return null;
  return ((to - from) / from) * 10_000;
}

export type IndicatorSnap = {
  sma20: number | null;
  sma50: number | null;
  ema20: number | null;
  midVsSma20Bps: number | null;
  midVsSma50Bps: number | null;
  rsi14: number | null;
  vol20Bps: number | null;
  high20: number | null;
  low20: number | null;
  rangePos20: number | null;
};

export function snapshotIndicators(closes: number[], mid: number): IndicatorSnap {
  const s20 = sma(closes, 20);
  const s50 = sma(closes, 50);
  const win = rangeWindow(closes, 20);
  return {
    sma20: s20,
    sma50: s50,
    ema20: ema(closes, 20),
    midVsSma20Bps: bpsBetween(s20, mid),
    midVsSma50Bps: bpsBetween(s50, mid),
    rsi14: rsi(closes, 14),
    vol20Bps: realizedVolBps(closes, 20),
    high20: win?.high ?? null,
    low20: win?.low ?? null,
    rangePos20: win?.pos ?? null,
  };
}

export type AssetCtx = {
  markPx: number | null;
  oraclePx: number | null;
  midPx: number | null;
  funding: number | null;
  premium: number | null;
  openInterest: number | null;
  prevDayPx: number | null;
  dayNtlVlm: number | null;
};

const emptyCtx = (): AssetCtx => ({
  markPx: null, oraclePx: null, midPx: null, funding: null,
  premium: null, openInterest: null, prevDayPx: null, dayNtlVlm: null,
});

function num(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function parseAssetCtx(raw: unknown): AssetCtx {
  if (!raw || typeof raw !== "object") return emptyCtx();
  const o = raw as Record<string, unknown>;
  return {
    markPx: num(o.markPx),
    oraclePx: num(o.oraclePx),
    midPx: num(o.midPx),
    funding: num(o.funding),
    premium: num(o.premium),
    openInterest: num(o.openInterest),
    prevDayPx: num(o.prevDayPx),
    dayNtlVlm: num(o.dayNtlVlm),
  };
}

export function venueFeatures(ctx: AssetCtx | null, mid: number) {
  const c = ctx ?? emptyCtx();
  return {
    markPx: c.markPx,
    oraclePx: c.oraclePx,
    fundingBps: c.funding != null ? c.funding * 10_000 : null,
    premiumBps: c.premium != null ? c.premium * 10_000 : null,
    openInterest: c.openInterest,
    dayNtlVlmUsd: c.dayNtlVlm,
    dayChangeBps: bpsBetween(c.prevDayPx, mid),
  };
}
