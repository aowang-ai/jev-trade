import { experimental_evaluate as evaluate } from "ai";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { assertJevCredentials, config } from "./config";
import { leverageRungs, liveIntent, parseLeverage, quoteAction, type Bias, type Intent } from "./plan";
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
  const cost = `An entry rests post-only and pays the maker fee. An exit crosses the touch and pays the taker fee. A full round trip costs roughly the maker fee plus the taker fee on top of the ${state.spreadBps} bps spread, so a move you cannot name in bps is not worth trading.`;
  const bias = {
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
  };
  const leverage = {
    type: "choice",
    instructions: {
      question: `What cross leverage should the ${asset} account use this tick?`,
      goal: `You pick leverage. Current ${levNow}. Hyperliquid max is ${state.maxLeverage}x. Read liquidationPx and equity before sizing risk.`,
      timing: "Leverage is updated on the wallet before the order is sent. It is ignored on a hold.",
      inputs: `${ctx} Allowed rungs: ${rungs.join(" ")}.`,
    },
    criteria: levCriteria,
  };
  const money = `equity=${pos.equity} withdrawable=${pos.withdrawable} notional=${pos.notionalUsd}`;
  if (pos.side === "flat") {
    return {
      bias,
      intent: {
        type: "choice",
        instructions: {
          question: `Take a ${asset} position this tick, or stay flat?`,
          goal: `You are flat, so there is nothing to close. Open starts a position in the long/short you picked. Hold stays flat and puts no order on the book. Holding is free and always available; most ticks do not carry an edge worth paying for.`,
          timing: "An entry is a post-only limit one tick inside the touch. It fills only when a taker hits it, which means it fills when the tape is running against it.",
          inputs: `${ctx} ${cost} Current: ${stance}. ${money}.`,
        },
        criteria: {
          open: `Open ${asset} on the long/short you picked. Only when the expected move over \`horizonTicks\` clears the spread and the round trip fee.`,
          hold: `Stay flat. No order is sent. Pick this when the tape is noise, the spread is wide against the move you expect, the book is thin, or the signals disagree.`,
        },
      },
      leverage,
    };
  }
  return {
    bias,
    intent: {
      type: "choice",
      instructions: {
        question: `Add to the ${asset} position, flatten it, or leave it alone this tick?`,
        goal: "Open adds in the long/short you picked. Close flattens the live Hyperliquid position, whatever side it is. Hold sends nothing and leaves the position untouched. Doing nothing is a real answer, not a fallback.",
        timing: "An add rests post-only and fills only if a taker hits it. A close crosses the touch and fills now at the taker fee. A hold also pulls any resting add, so the book carries no order you did not ask for.",
        inputs: `${ctx} ${cost} Current: ${stance}. ${money}.`,
      },
      criteria: {
        open: `Add to ${asset} on the long/short you picked. Only when the case is stronger than when the position was opened.`,
        close: `Flatten the live ${asset} position now, paying the taker fee to be out. Pick this when the reason for the position is gone, not merely because it is offside.`,
        hold: `Leave the position exactly as it is and send nothing. Pick this when the position still makes sense and adding would only raise the fee bill and the risk.`,
      },
    },
    leverage,
  };
}

interface Packed {
  intent: Intent;
  bias: Bias;
  leverage: number;
  longP: number;
  shortP: number;
  openP: number;
  closeP: number;
  holdP: number;
  latencyMs: number;
  inputTokens: number;
}

function pack(o: Packed): ModelDecision {
  const action = quoteAction(o.intent, o.bias);
  // long/short and open/close/hold are each a distribution. buy/sell are the legacy
  // pair: the mass behind the order actually being sent, discounted by the hold mass.
  const conviction = action === "buy"
    ? Math.max(o.longP, o.openP)
    : action === "sell"
      ? Math.max(o.shortP, o.closeP)
      : 0;
  const sized = conviction * (1 - o.holdP);
  return {
    action,
    intent: o.intent,
    bias: o.bias,
    leverage: o.leverage,
    probabilities: {
      buy: action === "buy" ? sized : 0,
      sell: action === "sell" ? sized : 0,
      hold: o.holdP,
      long: o.longP,
      short: o.shortP,
      open: o.openP,
      close: o.closeP,
    },
    upIn10: o.longP,
    latencyMs: o.latencyMs,
    inputTokens: o.inputTokens,
  };
}

function pick<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

/** Normalize a choice answer over `keys`. Missing probabilities fall back to the pick. */
function choiceProbs(answer: ChoiceAnswer | undefined, keys: readonly string[]): Record<string, number> {
  const p = answer?.probabilities ?? {};
  const raw = keys.map((k) => Math.max(0, p[k] ?? (answer?.choice === k ? 1 : 0)));
  const sum = raw.reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  if (sum <= 0) {
    const at = keys.indexOf(answer?.choice ?? "");
    keys.forEach((k, i) => (out[k] = i === (at >= 0 ? at : 0) ? 1 : 0));
    return out;
  }
  keys.forEach((k, i) => (out[k] = raw[i]! / sum));
  return out;
}

type ChoiceAnswer = { choice?: string; probabilities?: Record<string, number> };
type JevAnswers = { bias?: ChoiceAnswer; intent?: ChoiceAnswer; leverage?: ChoiceAnswer };

let typesafe: TypeSafeClient | undefined;

function typesafeClient(): TypeSafeClient {
  return (typesafe ??= new TypeSafeClient({
    apiKey: process.env.TYPESAFE_API_KEY,
    defaultModel: config.jevModelId,
    retry: { maxRetries: 0 },
  }));
}

async function callJev(state: TradeState): Promise<{ answers: JevAnswers; inputTokens: number }> {
  const qs = questions(state);
  if (config.jevProvider === "gateway") {
    const r = await evaluate({
      model: config.jevModelId,
      state: state as never,
      questions: qs,
      maxRetries: 0,
    });
    return { answers: r.answers, inputTokens: r.usage?.inputTokens ?? 0 };
  }
  const r = await typesafeClient().systemOne(
    {
      model: config.jevModelId,
      state: state as never,
      questions: qs,
    },
    { retry: { maxRetries: 0 } },
  );
  return { answers: r.answers, inputTokens: r.usage.input_tokens ?? 0 };
}

/** Real Jev. JEV_PROVIDER selects official TypeSafe or Vercel AI Gateway. */
export class JevModel implements Model {
  readonly name = "jev";

  async decide(state: TradeState): Promise<ModelDecision> {
    const t0 = performance.now();
    const r = await callJev(state);
    const flat = state.position.side === "flat";
    const bias = pick(r.answers.bias?.choice, ["long", "short"] as const, "long");
    // Standing down is the safe read of a missing or unusable answer.
    const choices = flat ? (["open", "hold"] as const) : (["open", "close", "hold"] as const);
    const intent = liveIntent(state.position.side, pick(r.answers.intent?.choice, choices, "hold"));
    const dir = choiceProbs(r.answers.bias, ["long", "short"]);
    const act = choiceProbs(r.answers.intent, choices);
    const leverage = parseLeverage(r.answers.leverage?.choice, state.maxLeverage, state.position.leverage ?? 1);
    return pack({
      intent,
      bias,
      leverage,
      longP: dir.long!,
      shortP: dir.short!,
      openP: act.open!,
      closeP: act.close ?? 0,
      holdP: act.hold!,
      latencyMs: performance.now() - t0,
      inputTokens: r.inputTokens,
    });
  }
}

/** Deterministic stand-in: momentum + imbalance. Jev-shaped open/close/hold/long/short/leverage. */
export class MockModel implements Model {
  readonly name = "mock";

  async decide(state: TradeState): Promise<ModelDecision> {
    const t0 = performance.now();
    const flow = state.trades.buySz + state.trades.sellSz ? state.trades.cvdSz / (state.trades.buySz + state.trades.sellSz) : 0;
    const signal = state.returnsBps.last20 / 8 + state.bookImbalance * 1.5 + flow * 2 + this.noise(state.tick);
    const longP = 1 / (1 + Math.exp(-signal));
    const bias: Bias = longP >= 0.5 ? "long" : "short";
    const against = (bias === "long" && state.position.side === "short") || (bias === "short" && state.position.side === "long");
    // A weak signal is not worth a round trip, so stand down instead of forcing a side.
    const weak = Math.abs(signal) < 0.35;
    const picked: Intent = against ? "close" : weak ? "hold" : "open";
    const intent = liveIntent(state.position.side, picked);
    const holdP = intent === "hold" ? 0.7 : 0.15;
    const closeP = intent === "close" ? 0.7 : 0.15;
    const leverage = parseLeverage(1 + Math.abs(signal) * 8, state.maxLeverage, state.position.leverage ?? 1);
    await Bun.sleep(80);
    return pack({
      intent,
      bias,
      leverage,
      longP,
      shortP: 1 - longP,
      openP: Math.max(0, 1 - holdP - closeP),
      closeP,
      holdP,
      latencyMs: performance.now() - t0,
      inputTokens: Math.round(JSON.stringify(state).length / 4),
    });
  }

  private noise(tick: number) {
    let h = tick * 2654435761 >>> 0;
    h ^= h >>> 15; h = (h * 2246822519) >>> 0; h ^= h >>> 13;
    return ((h % 1000) / 1000 - 0.5) * 3;
  }
}

export const createModel = (): Model => {
  if (config.model !== "jev") return new MockModel();
  assertJevCredentials(config.model, config.jevProvider, process.env);
  return new JevModel();
};
