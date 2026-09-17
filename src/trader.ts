import { config } from "./config";
import { bpsBetween, snapshotIndicators, venueFeatures } from "./indicators";
import type { Market } from "./market";
import type { Model, ModelDecision, TradeState } from "./model";
import { planQuote } from "./plan";
import { aggregateFills, emptySummary, takeLiveFills, takeSimFills, type Resting, type TradeFeed } from "./trades";
import type { BlockEvent, Book, Fill, PricePoint, Quote, Side, Timing, Totals } from "./types";

const emptyTotals = (): Totals => ({
  blocks: 0, decisions: 0, quotes: 0, fills: 0, reverted: 0, lateBlocks: 0,
  jevUsd: 0, gasSz: 0, gasUsd: 0, realizedUsd: 0, pnlUsd: 0, pnlSz: 0, pnlPct: 0,
});

/**
 * Every tick: read the book and ask the model. A tick is late only when Jev
 * is still answering. Hyperliquid leverage/order I/O runs in the background
 * so a fill or quote does not stall the next decision.
 */
export class Trader {
  readonly history: BlockEvent[] = [];
  private mids: number[] = [];
  private busy = false;
  private lastBook: Book | null = null;
  private trades: TradeFeed | null = null;
  private orders = new Map<number, Resting>();
  private simId = 0;
  private sendSeq = 0;
  private exchangeTail: Promise<void> = Promise.resolve();
  private position = { sz: 0, costUsd: 0 };
  private totals: Totals = emptyTotals();

  constructor(
    private market: Market,
    private model: Model,
    private onEvent: (e: BlockEvent, timing?: Timing) => void,
    private onFill: (block: number, fill: Fill) => void = () => {},
    private onQuote: (block: number, quote: Quote) => void = () => {},
  ) {}

  get tape(): PricePoint[] {
    return this.market.chartPoints;
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

      this.syncFromVenue();
      const decision = await this.model.decide(this.buildState(block, book));
      this.totals.decisions++;
      this.totals.jevUsd += (decision.inputTokens / 1e6) * config.jevUsdPerMTok;
      const plan = planQuote({
        intent: decision.intent,
        bias: decision.bias,
        positionSz: this.position.sz,
        quoteSz: this.market.quoteSize(book.mid),
      });
      this.emit(block, book, decision, null, false, { readMs: Math.round(readMs), loopMs: Math.round(performance.now() - t0) });
      if (plan) this.enqueueQuote(block, decision, plan, book);
    } catch (e) {
      console.error(`tick ${block}:`, (e as Error).message);
    } finally {
      this.busy = false;
    }
  }

  private enqueueQuote(
    block: number,
    decision: ModelDecision,
    plan: NonNullable<ReturnType<typeof planQuote>>,
    book: Book,
  ) {
    const seq = ++this.sendSeq;
    this.exchangeTail = this.exchangeTail.catch(() => {}).then(async () => {
      if (seq !== this.sendSeq) return;
      await this.market.setLeverage(decision.leverage);
      if (seq !== this.sendSeq) return;
      const cancel = [...this.orders.keys()].filter((id) => id > 0);
      const quote = await this.market.send(plan.side, plan.size, book, cancel, plan.reduceOnly);
      if (seq !== this.sendSeq) return;
      this.applyPosted(block, quote);
    });
  }

  private applyPosted(block: number, quote: Quote) {
    const e = this.history.find((h) => h.block === block);
    if (e) e.quote = quote;
    if (!quote.unchanged) this.totals.quotes++;
    if (quote.status === "reverted") this.totals.reverted++;
    if (quote.status === "sim") {
      this.orders.clear();
      this.orders.set(--this.simId, { side: quote.side, price: quote.price, size: quote.size, block });
    } else if (quote.status === "placed" && quote.orderId != null) {
      this.orders.clear();
      this.orders.set(quote.orderId, { side: quote.side, price: quote.price, size: quote.size, block });
    }
    this.onQuote(block, quote);
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
      this.onFill(block, fill);
    }
    this.market.refresh().catch(() => {});
  }

  private restingSz(side: Side) {
    let sz = 0;
    for (const o of this.orders.values()) if (o.side === side) sz += o.size;
    return sz;
  }

  private buildState(block: number, book: Book): TradeState {
    this.syncFromVenue();
    const m = this.mids, n = m.length, H = config.horizonBlocks;
    const ret = (k: number) => (n > k ? ((m[n - 1]! - m[n - 1 - k]!) / m[n - 1 - k]!) * 10_000 : 0);
    const sampled = m.slice(-H).filter((_, i, a) => (a.length - 1 - i) % 5 === 0);
    const lvl = (l: [number, number]) => `${l[0].toFixed(6)} x ${round(l[1], 1)}`;
    const depth: TradeState["depth"] = {};
    for (const [k, v] of Object.entries(book.depthBps)) depth[k + "bps"] = { bid: round(v.bid, 1), ask: round(v.ask, 1) };
    const posSz = this.position.sz;
    const a = this.market.account;
    const entry = this.entryPrice();
    const unrealized = a ? a.unrealizedUsd : this.unrealizedUsd(book.mid);
    const realized = a ? a.realizedUsd : this.totals.realizedUsd;
    const fees = a ? a.feesUsd : this.totals.gasUsd;
    const equity = a?.accountValue ?? 0;
    const pnlUsd = realized + unrealized - fees;
    const indicators = snapNums(snapshotIndicators(this.market.candleCloses(80), book.mid));
    const asset = snapNums(venueFeatures(this.market.assetCtx, book.mid));
    return {
      coin: this.market.coin,
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
      recentFills: this.market.fillPrints.slice(-8).map((f) => `${f.side} ${round(f.size, 6)} @ ${f.price}${f.dir ? ` ${f.dir}` : ""}`),
      position: {
        coin: this.market.coin,
        side: posSz > 0 ? "long" : posSz < 0 ? "short" : "flat",
        size: round(Math.abs(posSz), 8),
        notionalUsd: round(Math.abs(posSz) * book.mid, 4),
        entry,
        leverage: a?.leverage ?? null,
        liquidationPx: a?.liquidationPx ?? null,
        distanceBps: rnull(bpsBetween(entry, book.mid), 2),
        unrealizedUsd: round(unrealized, 4),
        realizedUsd: round(realized, 4),
        feesUsd: round(fees, 4),
        pnlUsd: round(pnlUsd, 4),
        pnlPct: round(equity ? (pnlUsd / equity) * 100 : 0, 4),
        equity: round(equity, 4),
        withdrawable: round(this.market.margin.usdc, 4),
      },
      indicators,
      asset: { ...asset, maxLeverage: this.market.maxLeverage },
      maxLeverage: this.market.maxLeverage,
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
        : decision && {
          action: decision.action,
          intent: decision.intent,
          bias: decision.bias,
          leverage: decision.leverage,
          probabilities: decision.probabilities,
          upIn10: decision.upIn10,
          latencyMs: Math.round(decision.latencyMs),
          late: false,
        },
      quote,
      fill: null,
      resting: { bidSz: round(this.restingSz("buy"), this.market.szDecimals), askSz: round(this.restingSz("sell"), this.market.szDecimals) },
      position: {
        side: this.position.sz > 0 ? "long" : this.position.sz < 0 ? "short" : "flat",
        size,
        entryPrice: this.entryPrice(),
        leverage: a?.leverage ?? decision?.leverage ?? null,
        unrealizedUsd: round(unrealized, 6),
        unrealizedSz: round(unrealized / book.mid, 8),
      },
      totals: { ...t, jevUsd: round(t.jevUsd, 6), gasSz: round(t.gasSz, 8), gasUsd: round(t.gasUsd, 6), realizedUsd: round(t.realizedUsd, 6), pnlUsd: round(t.pnlUsd, 6), pnlSz: round(t.pnlSz, 8), pnlPct: round(t.pnlPct, 4) },
    };
    this.history.push(event);
    if (this.history.length > config.historySize) this.history.shift();
    this.onEvent(event, timing);
  }
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
const rnull = (x: number | null, d: number) => (x == null || !Number.isFinite(x) ? null : round(x, d));

function snapNums<T extends Record<string, number | null>>(obj: T): T {
  const out = { ...obj };
  for (const [k, v] of Object.entries(out)) {
    (out as Record<string, number | null>)[k] = typeof v === "number" ? round(v, 6) : v;
  }
  return out;
}
