import type { Side } from "./types";

export type Bias = "long" | "short";
export type Intent = "open" | "close";

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

export function quoteAction(intent: Intent, bias: Bias): Side {
  if (intent === "open") return bias === "long" ? "buy" : "sell";
  return bias === "long" ? "sell" : "buy";
}

/** Map Jev's open/close + long/short onto one post-only quote. */
export function planQuote(opts: {
  intent: Intent;
  bias: Bias;
  positionSz: number;
  quoteSz: number;
}): { side: Side; size: number; reduceOnly: boolean } | null {
  if (opts.intent === "open") {
    return opts.quoteSz > 0
      ? { side: quoteAction(opts.intent, opts.bias), size: opts.quoteSz, reduceOnly: false }
      : null;
  }
  const have = opts.bias === "long" ? Math.max(0, opts.positionSz) : Math.max(0, -opts.positionSz);
  if (have <= 0) return null;
  return { side: quoteAction(opts.intent, opts.bias), size: have, reduceOnly: true };
}
