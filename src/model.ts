import { experimental_evaluate as evaluate } from "ai";
import { config } from "./config";
import { leverageRungs, parseLeverage, quoteAction, type Bias, type Intent } from "./plan";
import type { Action, Side } from "./types";

/** What the model sees. Compact, relative, human-readable. */
export interface TradeState {
  coin: string;
  market: string;
  tick: number;
  horizonTicks: number;
  tickMs: number;
  mid: number;
  spreadBps: number;
  bookImbalance: number;
  /** Cumulative resting size within 10/25/50 bps of mid, per side. */
  depth: { [band: string]: { bid: number; ask: number } };
  /** Top 5 levels each side, best first, as "price x size". */
  book: { bids: string[]; asks: string[] };
  returnsBps: { last1: number; last5: number; last20: number; last100: number };
  recentMids: string;
  /** Taker prints over the last `horizonTicks`. cvdSz = taker buy size minus taker sell size. */
  trades: { count: number; buySz: number; sellSz: number; cvdSz: number; vwap: number | null; lastPrice: number | null; lastSide: Side | null };
  recentTrades: string[];
  recentFills: string[];
  position: {
    coin: string;
    side: "long" | "short" | "flat";
    size: number;
    notionalUsd: number;
    entry: number | null;
    leverage: number | null;
    liquidationPx: number | null;
    distanceBps: number | null;
    unrealizedUsd: number;
    realizedUsd: number;
    feesUsd: number;
    pnlUsd: number;
    pnlPct: number;
    equity: number;
    withdrawable: number;
  };
  indicators: {
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
  asset: {
    markPx: number | null;
    oraclePx: number | null;
    fundingBps: number | null;
    premiumBps: number | null;
    openInterest: number | null;
    dayNtlVlmUsd: number | null;
    dayChangeBps: number | null;
    maxLeverage: number;
  };
  maxLeverage: number;
}

export interface ModelDecision {
  action: Action;
  intent: Intent;
  bias: Bias;
  leverage: number;
  probabilities: {
    buy: number;
    sell: number;
    hold: number;
    long: number;
    short: number;
    open: number;
    close: number;
  };
  upIn10: number;
  latencyMs: number;
  inputTokens: number;
}

export interface Model {
  readonly name: string;
  decide(state: TradeState): Promise<ModelDecision>;
}

function questions(state: TradeState) {
  const asset = state.coin;
  const pos = state.position;
  const stance = pos.side === "flat"
    ? `flat ${asset}`
    : `${pos.side} ${pos.size} ${asset} @ ${pos.entry ?? "?"} pnl $${pos.pnlUsd} (${pos.pnlPct}%)`;
  const levNow = pos.leverage != null ? `${pos.leverage}x` : "unset";
  const rungs = leverageRungs(state.maxLeverage);
  const levCriteria: Record<string, string> = {};
  for (const n of rungs) {
    levCriteria[String(n)] = `${n}x cross leverage on ${asset}. Higher leverage uses less margin for the same quote and raises liquidation risk.`;
  }
  const ctx = `You trade only ${asset} (${state.market}) on Hyperliquid. position is the live book and PnL (unrealizedUsd, realizedUsd, feesUsd, pnlUsd, pnlPct, liquidationPx). indicators are from 1m closes (sma20, sma50, ema20, rsi14, vol20Bps, rangePos20, midVsSma20Bps). asset is mark/oracle/fundingBps/premiumBps/openInterest/dayChangeBps/dayNtlVlmUsd. trades and book are the live tape. recentFills are this wallet's fills.`;
  return {
    bias: {
      type: "choice",
      instructions: {
        question: `Should the ${asset} book be long or short after this tick?`,
        goal: `Trade ${state.market} on Hyperliquid. You pick long or short. The bot does not flip your side.`,
        timing: `Ticks are ~${config.tickMs}ms. Current position: ${stance}.`,
        inputs: ctx,
      },
      criteria: {
        long: `Long ${asset}: mid more likely higher after \`horizonTicks\` ticks, by more than the spread.`,
        short: `Short ${asset}: mid more likely lower after \`horizonTicks\` ticks, by more than the spread.`,
      },
    },
    intent: {
      type: "choice",
      instructions: {
        question: `Open a ${asset} position or close one this tick?`,
        goal: "Open adds in the long/short you picked. Close flattens that side with a reduce-only quote. Use position PnL and indicators to decide whether to add or flatten.",
        timing: "The quote is a post-only limit one tick inside the touch. It fills only if a taker hits it.",
        inputs: `${ctx} Current: ${stance}. equity=${pos.equity} withdrawable=${pos.withdrawable} notional=${pos.notionalUsd}.`,
      },
      criteria: {
        open: `Open or add ${asset} on the long/short you picked.`,
        close: `Close the ${asset} position on the long/short you picked. If that side is flat the quote is skipped.`,
      },
    },
    leverage: {
      type: "choice",
      instructions: {
        question: `What cross leverage should the ${asset} account use this tick?`,
        goal: `You pick leverage. Current ${levNow}. Hyperliquid max is ${state.maxLeverage}x. Read liquidationPx and equity before sizing risk.`,
        timing: "Leverage is updated on the wallet before the quote is posted.",
        inputs: `${ctx} Allowed rungs: ${rungs.join(" ")}.`,
      },
      criteria: levCriteria,
    },
  };
}

function pack(
  intent: Intent,
  bias: Bias,
  leverage: number,
  longP: number,
  shortP: number,
  openP: number,
  closeP: number,
  latencyMs: number,
  inputTokens: number,
): ModelDecision {
  const action = quoteAction(intent, bias);
  const buy = action === "buy" ? Math.max(longP, openP) : Math.max(shortP, closeP);
  const sell = 1 - buy;
  return {
    action,
    intent,
    bias,
    leverage,
    probabilities: {
      buy,
      sell,
      hold: 0,
      long: longP,
      short: shortP,
      open: openP,
      close: closeP,
    },
    upIn10: longP,
    latencyMs,
    inputTokens,
  };
}

function pick<T extends string>(raw: unknown, a: T, b: T): T {
  return raw === b ? b : a;
}

function pairProbs(answer: { choice?: string; probabilities?: Record<string, number> } | undefined, a: string, b: string): [number, number] {
  const p = answer?.probabilities ?? {};
  let left = p[a] ?? (answer?.choice === a ? 1 : 0);
  let right = p[b] ?? (answer?.choice === b ? 1 : 0);
  const sum = left + right;
  if (sum <= 0) return answer?.choice === b ? [0, 1] : [1, 0];
  return [left / sum, right / sum];
}

/** Real Jev via Vercel AI Gateway. Swap-in is the MODEL env var. */
export class JevModel implements Model {
  readonly name = "jev";

  async decide(state: TradeState): Promise<ModelDecision> {
    const t0 = performance.now();
    const r = await evaluate({
      model: config.jevModelId,
      state: state as never,
      questions: questions(state),
      maxRetries: 0,
    });
    const bias = pick(r.answers.bias?.choice, "long", "short");
    const intent = pick(r.answers.intent?.choice, "open", "close");
    const [longP, shortP] = pairProbs(r.answers.bias, "long", "short");
    const [openP, closeP] = pairProbs(r.answers.intent, "open", "close");
    const leverage = parseLeverage(r.answers.leverage?.choice, state.maxLeverage, state.position.leverage ?? 1);
    return pack(intent, bias, leverage, longP, shortP, openP, closeP, performance.now() - t0, r.usage?.inputTokens ?? 0);
  }
}

/** Deterministic stand-in: momentum + imbalance. Jev-shaped open/close/long/short/leverage. */
export class MockModel implements Model {
  readonly name = "mock";

  async decide(state: TradeState): Promise<ModelDecision> {
    const t0 = performance.now();
    const flow = state.trades.buySz + state.trades.sellSz ? state.trades.cvdSz / (state.trades.buySz + state.trades.sellSz) : 0;
    const signal = state.returnsBps.last20 / 8 + state.bookImbalance * 1.5 + flow * 2 + this.noise(state.tick);
    const longP = 1 / (1 + Math.exp(-signal));
    const bias: Bias = longP >= 0.5 ? "long" : "short";
    const against = (bias === "long" && state.position.side === "short") || (bias === "short" && state.position.side === "long");
    const weak = Math.abs(signal) < 0.35 && state.position.side !== "flat";
    const intent: Intent = against || weak ? "close" : "open";
    const closeP = intent === "close" ? 0.65 : 0.35;
    const leverage = parseLeverage(1 + Math.abs(signal) * 8, state.maxLeverage, state.position.leverage ?? 1);
    await Bun.sleep(80);
    return pack(intent, bias, leverage, longP, 1 - longP, 1 - closeP, closeP, performance.now() - t0, Math.round(JSON.stringify(state).length / 4));
  }

  private noise(tick: number) {
    let h = tick * 2654435761 >>> 0;
    h ^= h >>> 15; h = (h * 2246822519) >>> 0; h ^= h >>> 13;
    return ((h % 1000) / 1000 - 0.5) * 3;
  }
}

export const createModel = (): Model => (config.model === "jev" ? new JevModel() : new MockModel());
