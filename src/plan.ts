import type { Action, Bias, Intent, Side } from "./types";

export type { Bias, Intent };

/** Hyperliquid integer rungs up to the coin's max leverage. */
export function leverageRungs(max: number): number[] {
  const cap = Math.max(1, Math.floor(Number(max) || 1));
  const out = [1, 2, 3, 5, 10, 20, 40, 50].filter((n) => n <= cap);
  if (!out.includes(cap)) out.push(cap);
  return out;
}

export function parseLeverage(raw: unknown, max: number, fallback: number): number {
  const n = typeof raw === "number" || typeof raw === "string" ? Number(raw) : NaN;
  const rungs = leverageRungs(max);
  const seed = Number.isFinite(n) && n >= 1 ? Math.round(n) : fallback;
  return rungs.reduce((best, x) => (Math.abs(x - seed) < Math.abs(best - seed) ? x : best), rungs[0]!);
}

/** Close is only a real choice when a position exists. Flat plus close means stand down. */
export function liveIntent(positionSide: "long" | "short" | "flat", picked: Intent): Intent {
  if (positionSide !== "flat") return picked;
  return picked === "open" ? "open" : "hold";
}

export function quoteAction(intent: Intent, bias: Bias): Action {
  if (intent === "hold") return "hold";
  if (intent === "open") return bias === "long" ? "buy" : "sell";
  return bias === "long" ? "sell" : "buy";
}

/**
 * One order per tick, or nothing. Entries rest post-only so they earn the spread.
 * Exits cross as Ioc takers: a resting exit only fills when the market moves your
 * way, which caps winners at the spread and lets losers run.
 */
export interface QuotePlan {
  side: Side;
  size: number;
  reduceOnly: boolean;
  taker: boolean;
}

/** Map Jev's open/close/hold + long/short onto one order. `null` means pull the book. */
export function planQuote(opts: {
  intent: Intent;
  bias: Bias;
  positionSz: number;
  quoteSz: number;
}): QuotePlan | null {
  if (opts.intent === "hold") return null;
  if (opts.intent === "open") {
    return opts.quoteSz > 0
      ? { side: quoteAction(opts.intent, opts.bias) as Side, size: opts.quoteSz, reduceOnly: false, taker: false }
      : null;
  }
  // Close flattens the live book. Long/short is the stance, not which side to reduce.
  if (opts.positionSz > 0) return { side: "sell", size: opts.positionSz, reduceOnly: true, taker: true };
  if (opts.positionSz < 0) return { side: "buy", size: -opts.positionSz, reduceOnly: true, taker: true };
  return null;
}
