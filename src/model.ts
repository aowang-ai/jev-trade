import { experimental_evaluate as evaluate } from "ai";
import { config } from "./config";
import type { Action, Side } from "./types";

/** What the model sees. Compact, relative, human-readable. */
export interface TradeState {
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
  allowed: { buy: boolean; sell: boolean };
}

export interface ModelDecision {
  action: Action;
  probabilities: Record<Action, number>;
  upIn10: number;
  latencyMs: number;
  inputTokens: number;
}

export interface Model {
  readonly name: string;
  decide(state: TradeState): Promise<ModelDecision>;
}

function questions(state: TradeState) {
  const market = state.market;
  const asset = market.replace(/-USD$/, "");
  return {
    direction: {
      type: "choice",
      instructions: {
        question: `Will ${asset} be higher or lower than the current mid after \`horizonTicks\` more ticks?`,
        goal: `Trade ${market} on Hyperliquid. Ticks are ~${config.tickMs}ms; \`horizonTicks\` is the horizon. A post-only limit order is quoted every tick on the chosen side. The move must beat the spread (\`spreadBps\`).`,
        timing: "The quote is a post-only limit order one tick inside the touch. It fills only if a taker hits it.",
        inputs: "Taker flow is the strongest signal: `trades.cvdSz` (taker buys minus taker sells over the horizon), `trades.lastSide` and `recentTrades` show who is hitting the book. `depth` and `book` show resting liquidity per side at several distances from mid; thin depth on one side means price moves easily that way. `returnsBps` and `recentMids` show the path over the horizon. If `allowed.buy` is false the trade will be a sell regardless, and vice versa.",
      },
      criteria: {
        buy: `Buy ${asset} now: mid more likely to be higher after \`horizonTicks\` ticks, by more than the spread.`,
        sell: `Sell ${asset} now: mid more likely to be lower after \`horizonTicks\` ticks, by more than the spread.`,
      },
    },
  } as const;
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
    const a = r.answers.direction;
    const p = a.probabilities ?? { buy: 0, sell: 0, [a.choice]: 1 };
    const buy = p.buy ?? 0, sell = p.sell ?? 0;
    return {
      action: a.choice as Action,
      probabilities: { buy, sell, hold: 0 },
      upIn10: buy,
      latencyMs: performance.now() - t0,
      inputTokens: r.usage?.inputTokens ?? 0,
    };
  }
}

/** Deterministic stand-in: momentum + imbalance + mean reversion toward flat. */
export class MockModel implements Model {
  readonly name = "mock";

  async decide(state: TradeState): Promise<ModelDecision> {
    const t0 = performance.now();
    const flow = state.trades.buySz + state.trades.sellSz ? state.trades.cvdSz / (state.trades.buySz + state.trades.sellSz) : 0;
    const signal = state.returnsBps.last20 / 8 + state.bookImbalance * 1.5 + flow * 2 + this.noise(state.tick);
    const buy = 1 / (1 + Math.exp(-signal));
    const probabilities = { buy, sell: 1 - buy, hold: 0 };
    const action: Action = buy >= 0.5 ? "buy" : "sell";
    await Bun.sleep(80);
    return {
      action, probabilities,
      upIn10: buy,
      latencyMs: performance.now() - t0,
      inputTokens: Math.round(JSON.stringify(state).length / 4),
    };
  }

  private noise(tick: number) {
    let h = tick * 2654435761 >>> 0;
    h ^= h >>> 15; h = (h * 2246822519) >>> 0; h ^= h >>> 13;
    return ((h % 1000) / 1000 - 0.5) * 3;
  }
}

export const createModel = (): Model => (config.model === "jev" ? new JevModel() : new MockModel());
