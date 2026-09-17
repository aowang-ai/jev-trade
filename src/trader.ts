import { config } from "./config";
import type { Market } from "./market";
import type { Model, ModelDecision, TradeState } from "./model";
import { tapePath } from "./sleeves";
import { appendEvent, loadTape, markTapeFill, stampFills } from "./tape";
import { aggregateFills, emptySummary, takeLiveFills, takeSimFills, type Resting, type TradeFeed } from "./trades";
import type { BlockEvent, Book, Fill, PricePoint, Quote, Side, Timing, Totals } from "./types";

const emptyTotals = (): Totals => ({
  blocks: 0, decisions: 0, quotes: 0, fills: 0, reverted: 0, lateBlocks: 0,
  jevUsd: 0, gasSz: 0, gasUsd: 0, realizedUsd: 0, pnlUsd: 0, pnlSz: 0, pnlPct: 0,
});

export function allowQuote(opts: {
  side: Side;
  size: number;
  positionSz: number;
  restingBuy: number;
  restingSell: number;
  maxPosition: number;
  hasWallet: boolean;
  marginUsdc: number;
  px: number;
  leverage: number;
}): boolean {
  const exposure = opts.side === "buy"
    ? opts.positionSz + opts.restingBuy + opts.size
    : opts.positionSz - opts.restingSell - opts.size;
  const over = Math.abs(exposure) > opts.maxPosition;
  const reducing = Math.abs(exposure) < Math.abs(opts.positionSz);
  if (over && !reducing) return false;
  if (!opts.hasWallet) return true;
  return opts.marginUsdc >= (opts.size * opts.px) / Math.max(1, opts.leverage);
}

/**
 * Every tick: read the book, ask the model buy or sell, post one post-only limit
 * on that side. One request in flight; a tick that arrives while busy is late.
 * Live position and PnL come from Hyperliquid. Dry run simulates fills against the tape.
 */
export class Trader {
  readonly history: BlockEvent[] = [];
  readonly tape: PricePoint[] = [];
  private mids: number[] = [];
  private busy = false;
  private lastBook: Book | null = null;
  private trades: TradeFeed | null = null;
  private orders = new Map<number, Resting>();
  private simId = 0;
  private position = { sz: 0, costUsd: 0 };
  private totals: Totals = emptyTotals();
  private tapeFile = "data/events.jsonl";

  constructor(
    private market: Market,
    private model: Model,
    private onEvent: (e: BlockEvent, timing?: Timing) => void,
    private onFill: (block: number, fill: Fill) => void = () => {},
    private onQuote: (block: number, quote: Quote) => void = () => {},
  ) {
    const named = tapePath(market.label);
    const legacy = market.label === "BTC" ? loadTape("data/events.jsonl") : [];
    this.tape.push(...loadTape(named));
    if (!this.tape.length && legacy.length) this.tape.push(...legacy);
    stampFills(this.tape, market.fillPrints);
    this.tapeFile = named;
  }

  attachTradeFeed(feed: TradeFeed) {
    this.trades = feed;
  }

  async onBlock(block: number) {
    this.totals.blocks++;
    if (this.totals.blocks % 5 === 0) this.market.refresh().catch(() => {});
    if (this.busy) {
      this.totals.lateBlocks++;
      if (this.lastBook) this.emit(block, this.lastBook, null, null, true);
      return;
    }
    this.busy = true;
    const t0 = performance.now();
    try {
      const book = this.market.readBook();
      const readMs = performance.now() - t0;
      this.lastBook = book;
      this.mids.push(book.mid);
      if (this.mids.length > 400) this.mids.shift();
      this.harvest();

      const decision = await this.model.decide(this.buildState(block, book));
      const wanted: Side = decision.action === "sell" ? "sell" : "buy";
      const other: Side = wanted === "buy" ? "sell" : "buy";
      let side: Side | null = this.allowed(wanted, book) ? wanted : this.allowed(other, book) ? other : null;
      if (side && this.market.quoteSize(book.mid) <= 0) side = null;
      this.totals.decisions++;
      this.totals.jevUsd += (decision.inputTokens / 1e6) * config.jevUsdPerMTok;

      let quote: Quote | null = null;
      if (side) {
        decision.action = side;
        const cancel = [...this.orders.keys()].filter((id) => id > 0);
        quote = await this.market.send(side, this.market.quoteSize(book.mid), book, cancel, side !== wanted);
        if (!quote.unchanged) this.totals.quotes++;
        if (quote.status === "reverted") {
          this.totals.reverted++;
          this.onQuote(block, quote);
        }
        if (quote.status === "sim") {
          this.orders.clear();
          this.orders.set(--this.simId, { side, price: quote.price, size: quote.size, block });
        } else if (quote.status === "placed" && quote.orderId != null) {
          this.orders.clear();
          this.orders.set(quote.orderId, { side: quote.side, price: quote.price, size: quote.size, block });
        }
      }
      this.emit(block, book, decision, quote, false, { readMs: Math.round(readMs), loopMs: Math.round(performance.now() - t0) });
    } catch (e) {
      console.error(`tick ${block}:`, (e as Error).message);
    } finally {
      this.busy = false;
    }
  }

  private harvest() {
    if (!this.trades) return;
    const prints = this.trades.drainPrints();
    const fills = this.market.wallet ? takeLiveFills(this.orders, this.trades.drainFills()) : takeSimFills(this.orders, prints);
    if (!fills.length) return;
    const byBlock = new Map<number, Fill[]>();
    for (const f of fills) {
      this.applyFill(f);
      byBlock.set(f.block, [...(byBlock.get(f.block) ?? []), f]);
    }
    for (const [block, fs] of byBlock) {
      const fill = aggregateFills(fs);
      const e = this.history.find((h) => h.block === block);
      if (e) e.fill = fill;
      markTapeFill(this.tape, { side: fill.side, price: fill.price, size: fill.size, dir: fill.dir }, { ts: e?.ts, block });
      this.onFill(block, fill);
    }
    this.market.refresh().catch(() => {});
  }

  private restingSz(side: Side) {
    let sz = 0;
    for (const o of this.orders.values()) if (o.side === side) sz += o.size;
    return sz;
  }

  private allowed(side: Side, book: Book) {
    this.syncFromVenue();
    return allowQuote({
      side,
      size: this.market.quoteSize(book.mid),
      positionSz: this.position.sz,
      restingBuy: this.restingSz("buy"),
      restingSell: this.restingSz("sell"),
      maxPosition: this.market.maxPositionSz(book.mid),
      hasWallet: Boolean(this.market.wallet),
      marginUsdc: this.market.margin.usdc,
      px: side === "buy" ? book.ask : book.bid,
      leverage: config.hlLeverage,
    });
  }

  private buildState(block: number, book: Book): TradeState {
    const m = this.mids, n = m.length, H = config.horizonBlocks;
    const ret = (k: number) => (n > k ? ((m[n - 1]! - m[n - 1 - k]!) / m[n - 1 - k]!) * 10_000 : 0);
    const sampled = m.slice(-H).filter((_, i, a) => (a.length - 1 - i) % 5 === 0);
    const lvl = (l: [number, number]) => `${l[0].toFixed(6)} x ${round(l[1], 1)}`;
    const depth: TradeState["depth"] = {};
    for (const [k, v] of Object.entries(book.depthBps)) depth[k + "bps"] = { bid: round(v.bid, 1), ask: round(v.ask, 1) };
    return {
      market: this.market.pair,
      tick: block,
      horizonTicks: H,
      tickMs: config.tickMs,
      mid: book.mid,
      spreadBps: round(book.spreadBps, 2),
      bookImbalance: round(book.imbalance, 3),
      depth,
      book: { bids: book.levels.bids.map(lvl), asks: book.levels.asks.map(lvl) },
      returnsBps: { last1: round(ret(1), 2), last5: round(ret(5), 2), last20: round(ret(20), 2), last100: round(ret(100), 2) },
      recentMids: sampled.map((x) => x.toFixed(6)).join(" "),
      trades: this.trades ? this.trades.summary(H, block) : emptySummary(),
      recentTrades: (this.trades?.recent(10) ?? []).map((t) => `${t.block} ${t.side} ${round(t.size, 1)} @ ${t.price.toFixed(6)}`),
      allowed: { buy: this.allowed("buy", book), sell: this.allowed("sell", book) },
    };
  }

  private applyFill(f: Fill) {
    if (f.size <= 0) return;
    this.totals.fills++;
    if (this.market.account) return;
    const signed = f.side === "buy" ? f.size : -f.size;
    const p = this.position;
    if (p.sz === 0 || Math.sign(p.sz) === Math.sign(signed)) {
      p.costUsd += signed * f.price;
    } else {
      const closing = Math.min(Math.abs(signed), Math.abs(p.sz)) * Math.sign(signed);
      const entry = p.costUsd / p.sz;
      this.totals.realizedUsd += -closing * (f.price - entry);
      p.costUsd += closing * entry;
      const remainder = signed - closing;
      p.costUsd += remainder * f.price;
    }
    p.sz += signed;
    if (Math.abs(p.sz) < 1e-9) { p.sz = 0; p.costUsd = 0; }
    if (f.feeUsd) this.totals.gasUsd += f.feeUsd;
  }

  private syncFromVenue() {
    const a = this.market.account;
    if (!a) return;
    this.position.sz = a.positionSz;
    this.position.costUsd = a.entryPrice != null && a.positionSz ? a.entryPrice * a.positionSz : 0;
    this.totals.realizedUsd = a.realizedUsd;
    this.totals.gasUsd = a.feesUsd;
  }

  private entryPrice() { return this.position.sz ? this.position.costUsd / this.position.sz : null; }
  private unrealizedUsd(mid: number) { return this.position.sz ? this.position.sz * (mid - this.entryPrice()!) : 0; }

  private emit(block: number, book: Book, decision: ModelDecision | null, quote: Quote | null, late: boolean, timing?: Timing) {
    this.syncFromVenue();
    const t = this.totals;
    t.gasSz = book.mid ? t.gasUsd / book.mid : 0;
    const a = this.market.account;
    const unrealized = a ? a.unrealizedUsd : this.unrealizedUsd(book.mid);
    t.pnlUsd = t.realizedUsd + unrealized - t.gasUsd;
    t.pnlSz = t.pnlUsd / book.mid;
    t.pnlPct = (t.pnlUsd / (a?.accountValue || config.bankrollUsd)) * 100;
    const size = Math.abs(this.position.sz);
    const event: BlockEvent = {
      coin: this.market.coin,
      block, ts: Date.now(), mid: book.mid, bestBid: book.bid, bestAsk: book.ask, spreadBps: round(book.spreadBps, 2),
      decision: late
        ? { action: "hold", probabilities: { buy: 0, sell: 0, hold: 1 }, upIn10: 0.5, latencyMs: 0, late: true }
        : decision && { action: decision.action, probabilities: decision.probabilities, upIn10: decision.upIn10, latencyMs: Math.round(decision.latencyMs), late: false },
      quote,
      fill: null,
      resting: { bidSz: round(this.restingSz("buy"), this.market.szDecimals), askSz: round(this.restingSz("sell"), this.market.szDecimals) },
      position: {
        side: this.position.sz > 0 ? "long" : this.position.sz < 0 ? "short" : "flat",
        size,
        entryPrice: this.entryPrice(),
        leverage: a?.leverage ?? config.hlLeverage,
        unrealizedUsd: round(unrealized, 6),
        unrealizedSz: round(unrealized / book.mid, 8),
      },
      totals: { ...t, jevUsd: round(t.jevUsd, 6), gasSz: round(t.gasSz, 8), gasUsd: round(t.gasUsd, 6), realizedUsd: round(t.realizedUsd, 6), pnlUsd: round(t.pnlUsd, 6), pnlSz: round(t.pnlSz, 8), pnlPct: round(t.pnlPct, 4) },
    };
    this.history.push(event);
    if (this.history.length > config.historySize) this.history.shift();
    appendEvent(this.tape, event, this.tapeFile);
    this.onEvent(event, timing);
  }
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
