import { ApiRequestError, ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { formatPrice, formatSize, SymbolConverter } from "@nktkas/hyperliquid/utils";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { config } from "./config";
import { accountFromClearinghouse, fillDir, FillPnlBook, type ClearinghouseLike, type FillPnlLike, type VenueAccount } from "./account";
import { quotePrice, takerPrice } from "./book";
import type { Feed } from "./feed";
import { sameCoin, type SleeveConfig } from "./sleeves";
import type { Book, Fill, Quote, Side } from "./types";

type Ex = ExchangeClient;

type QuoteBase = Required<Pick<Quote, "side" | "reduceOnly" | "capped" | "taker">>;

/** Hyperliquid perp: Alo post-only quotes, modify when the side stays put. */
export class Market {
  readonly wallet: PrivateKeyAccount | null;
  readonly coin: string;
  readonly pair: string;
  readonly label: string;
  margin = { usdc: 0 };
  account: VenueAccount | null = null;
  szDecimals = 5;
  maxLeverage = 50;
  private info: InfoClient;
  private ex: Ex | null = null;
  private assetId = 0;
  private lastOid: number | null = null;
  private lastSide: Side | null = null;
  private lastPrice = 0;
  private lastSize = 0;
  private lastReduce = false;
  private fills = new FillPnlBook();
  readonly fillPrints: { ts: number; side: Side; price: number; size: number; dir?: Fill["dir"]; hash?: string }[] = [];
  onVenueFill: ((fill: { ts: number; side: Side; price: number; size: number; dir?: Fill["dir"]; hash?: string }) => void) | null = null;

  get chartPoints() {
    return this.feed.chart.points;
  }

  get assetCtx() {
    return this.feed.assetCtx;
  }

  candleCloses(limit = 80) {
    return this.feed.chart.closes(limit);
  }

  constructor(private feed: Feed, sleeve: SleeveConfig) {
    this.coin = sleeve.coin;
    this.pair = sleeve.pair;
    this.label = sleeve.label;
    this.wallet = config.dryRun || !sleeve.privateKey ? null : privateKeyToAccount(sleeve.privateKey);
    const transport = new HttpTransport({ isTestnet: config.hlTestnet });
    this.info = new InfoClient({ transport });
    if (this.wallet) this.ex = new ExchangeClient({ transport, wallet: this.wallet });
  }

  get address() {
    return this.wallet?.address ?? null;
  }

  quoteSize(mid: number): number {
    return lot(config.quoteUsd / Math.max(mid, 1e-9), this.szDecimals);
  }

  async init() {
    const transport = new HttpTransport({ isTestnet: config.hlTestnet });
    const converter = await SymbolConverter.create({ transport });
    const assetId = converter.getAssetId(this.coin);
    const szDecimals = converter.getSzDecimals(this.coin);
    if (assetId == null || szDecimals == null) throw new Error(`unknown Hyperliquid coin ${this.coin}`);
    this.assetId = assetId;
    this.szDecimals = szDecimals;
    if (this.wallet && this.ex) {
      this.feed.onClearinghouse = (state) => this.applyClearinghouse(state);
      this.feed.onUserPnl = (fill) => this.noteFill(fill);
      this.feed.watchUser(this.wallet.address);
      this.feed.onGone = (oid) => {
        if (this.lastOid === oid) this.forgetResting();
      };
      await this.clearOpen();
    }
    await this.loadMaxLeverage();
    await this.refresh();
    if (this.address) await this.seedFills();
    const net = config.hlTestnet ? "testnet" : "mainnet";
    console.log(`hyperliquid · ${this.pair} ${net} · ${this.coin} asset ${this.assetId} · szDecimals ${this.szDecimals} · max ${this.maxLeverage}x · ${config.dryRun ? "DRY RUN" : `wallet ${this.address}`}`);
    if (this.wallet) {
      const a = this.account;
      const side = !a || !a.positionSz ? "flat" : a.positionSz > 0 ? "long" : "short";
      const size = a ? Math.abs(a.positionSz) : 0;
      const entry = a?.entryPrice != null ? ` @ ${a.entryPrice}` : "";
      console.log(`${this.label} · withdrawable $${this.margin.usdc.toFixed(2)} · account $${(a?.accountValue ?? 0).toFixed(2)} · ${side} ${size} ${this.coin}${entry}`);
    }
  }

  private async clearOpen() {
    if (!this.wallet || !this.ex) return;
    try {
      const opens = await this.info.openOrders({ user: this.wallet.address });
      const mine = opens.filter((o) => sameCoin(o.coin, this.coin));
      if (!mine.length) return;
      await this.ex.cancel({ cancels: mine.map((o) => ({ a: this.assetId, o: o.oid })) });
    } catch {
      // next quote will replace if we still see them
    }
  }

  applyClearinghouse(state: ClearinghouseLike) {
    this.account = this.fills.apply(accountFromClearinghouse(state, this.coin, this.account));
    this.margin.usdc = this.account.withdrawable;
  }

  noteFill(fill: FillPnlLike) {
    if (!this.fills.add(fill, this.coin)) return;
    if (this.account) this.account = this.fills.apply(this.account);
    const ts = Number(fill.time);
    const price = Number(fill.px);
    const size = Number(fill.sz);
    const side: Side | null =
      fill.side === "B" || fill.side === "buy" ? "buy" : fill.side === "A" || fill.side === "sell" ? "sell" : null;
    if (side && Number.isFinite(ts) && ts > 0 && Number.isFinite(price) && price > 0) {
      const hash = typeof fill.hash === "string" && fill.hash ? fill.hash : undefined;
      const print = { ts, side, price, size: Number.isFinite(size) ? size : 0, dir: fillDir(fill.dir), hash };
      this.fillPrints.push(print);
      if (this.feed.chart.addFill(print)) this.onVenueFill?.(print);
    }
  }

  private async seedFills() {
    if (!this.address) return;
    try {
      const fills = await this.info.userFills({ user: this.address });
      for (const f of fills) this.noteFill(f);
    } catch {
      // keep whatever WS has already delivered
    }
  }

  async refresh() {
    if (!this.address) return;
    try {
      this.applyClearinghouse(await this.info.clearinghouseState({ user: this.address }));
    } catch {
      // keep last balances
    }
  }

  readBook(): Book {
    if (!this.feed.book) throw new Error(`no Hyperliquid book yet for ${this.coin}`);
    return this.feed.book;
  }

  async setLeverage(raw: number): Promise<number> {
    const leverage = Math.max(1, Math.min(this.maxLeverage, Math.round(raw)));
    if (!this.ex) return leverage;
    if (this.account?.leverage === leverage) return leverage;
    try {
      await this.ex.updateLeverage({ asset: this.assetId, isCross: true, leverage });
      if (this.account) this.account.leverage = leverage;
      return leverage;
    } catch (e) {
      console.warn(`${this.label} leverage: ${(e as Error).message.slice(0, 160)}`);
      return this.account?.leverage ?? leverage;
    }
  }

  /** Entries rest post-only. Exits cross as Ioc so they do not wait on a taker. */
  async send(side: Side, sizeSz: number, book: Book, cancel: number[], reduceOnly = false, taker = false): Promise<Quote> {
    const size = lot(sizeSz, this.szDecimals);
    const base: QuoteBase = { side, reduceOnly, capped: false, taker };
    if (size <= 0) {
      return { ...base, price: 0, size: 0, txHash: null, cancel, status: "reverted", orderId: null };
    }
    const px = taker
      ? Number(formatPrice(takerPrice(side, book, this.szDecimals), this.szDecimals))
      : this.restingPx(side, book);
    if (!this.ex) {
      return { ...base, price: px, size, txHash: null, cancel, status: "sim", orderId: null };
    }
    return taker ? this.sendTaker(size, px, base) : this.sendMaker(size, px, cancel, base);
  }

  /** Post-only price, clamped so it can never cross and get rejected. */
  private restingPx(side: Side, book: Book): number {
    let px = Number(formatPrice(quotePrice(side, book, this.szDecimals), this.szDecimals));
    if (side === "sell" && px <= book.bid) px = Number(formatPrice(book.ask, this.szDecimals));
    if (side === "buy" && px >= book.ask) px = Number(formatPrice(book.bid, this.szDecimals));
    return px;
  }

  private limitOrder(side: Side, size: number, px: number, reduceOnly: boolean, tif: "Alo" | "Ioc") {
    return {
      a: this.assetId,
      b: side === "buy",
      p: formatPrice(px, this.szDecimals),
      s: formatSize(size, this.szDecimals),
      r: reduceOnly,
      t: { limit: { tif } },
    };
  }

  private async sendTaker(size: number, px: number, base: QuoteBase): Promise<Quote> {
    // The standing entry sits on the far side of an exit. Pull it before crossing.
    const open = this.lastOid;
    const cancel = open != null ? [open] : [];
    if (open != null) {
      await this.ex!.cancel({ cancels: [{ a: this.assetId, o: open }] }).catch(() => {});
      this.forgetResting();
    }
    try {
      const res = await this.ex!.order({
        orders: [this.limitOrder(base.side, size, px, base.reduceOnly, "Ioc")],
        grouping: "na",
      });
      const st = res.response.data.statuses[0];
      if (st && typeof st === "object" && "filled" in st) {
        return {
          ...base,
          price: Number(st.filled.avgPx) || px,
          size: Number(st.filled.totalSz) || size,
          txHash: null,
          cancel,
          status: "placed",
          orderId: st.filled.oid,
        };
      }
      // An unfilled Ioc leaves nothing behind. Next tick decides again.
      return { ...base, price: px, size, txHash: null, cancel, status: "reverted", orderId: null };
    } catch (e) {
      this.warn("exit", e);
      return { ...base, price: px, size, txHash: null, cancel, status: "reverted", orderId: null };
    }
  }

  private async sendMaker(size: number, px: number, cancel: number[], base: QuoteBase): Promise<Quote> {
    const { side, reduceOnly } = base;
    if (
      this.lastOid != null &&
      this.lastSide === side &&
      this.lastPrice === px &&
      this.lastSize === size &&
      this.lastReduce === reduceOnly
    ) {
      return { ...base, price: px, size, txHash: null, cancel: [], status: "placed", orderId: this.lastOid, unchanged: true };
    }

    const order = this.limitOrder(side, size, px, reduceOnly, "Alo");
    try {
      if (this.lastOid != null && this.lastSide === side && this.lastReduce === reduceOnly) {
        await this.ex!.modify({ oid: this.lastOid, order });
        this.lastPrice = px;
        this.lastSize = size;
        return { ...base, price: px, size, txHash: null, cancel: [], status: "placed", orderId: this.lastOid };
      }

      const oids = this.lastOid != null ? [this.lastOid] : cancel.filter((id) => id > 0);
      if (oids.length) {
        await this.ex!.cancel({ cancels: oids.map((o) => ({ a: this.assetId, o })) }).catch(() => {});
        this.lastOid = null;
      }

      const res = await this.ex!.order({ orders: [order], grouping: "na" });
      const st = res.response.data.statuses[0];
      if (st && typeof st === "object" && "resting" in st) {
        this.lastOid = st.resting.oid;
        this.lastSide = side;
        this.lastPrice = px;
        this.lastSize = size;
        this.lastReduce = reduceOnly;
        return { ...base, price: px, size, txHash: null, cancel: oids, status: "placed", orderId: this.lastOid };
      }
      if (st && typeof st === "object" && "filled" in st) {
        this.forgetResting();
        return { ...base, price: px, size, txHash: null, cancel: oids, status: "placed", orderId: st.filled.oid };
      }
      this.forgetResting();
      return { ...base, price: px, size, txHash: null, cancel: oids, status: "reverted", orderId: null };
    } catch (e) {
      this.warn("quote", e);
      return { ...base, price: px, size, txHash: null, cancel, status: "reverted", orderId: this.lastOid };
    }
  }

  /** Pull the standing quote. A resting order Jev no longer wants still gets hit. */
  async cancelResting(): Promise<number[]> {
    const oid = this.lastOid;
    if (!this.ex || oid == null) return [];
    await this.ex.cancel({ cancels: [{ a: this.assetId, o: oid }] }).catch(() => {});
    this.forgetResting();
    return [oid];
  }

  private forgetResting() {
    this.lastOid = null;
    this.lastSide = null;
    this.lastPrice = 0;
    this.lastSize = 0;
    this.lastReduce = false;
  }

  private warn(what: string, e: unknown) {
    const msg = e instanceof ApiRequestError ? e.message : (e as Error).message;
    if (/rate.?limit/i.test(msg)) console.warn(`${this.label}: hyperliquid rate limited; ${what} skipped`);
    else console.warn(`${this.label} ${what}: ${msg.slice(0, 180)}`);
  }

  private async loadMaxLeverage() {
    try {
      const res = await fetch(config.hlTestnet ? "https://api.hyperliquid-testnet.xyz/info" : "https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "meta" }),
      });
      const meta = (await res.json()) as { universe?: { name?: string; maxLeverage?: number }[] };
      const n = Number(meta.universe?.find((u) => u.name === this.coin)?.maxLeverage);
      if (Number.isFinite(n) && n >= 1) this.maxLeverage = Math.floor(n);
    } catch {
      // keep 50
    }
  }
}

function lot(raw: number, szDecimals: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  try {
    return Number(formatSize(raw, szDecimals));
  } catch {
    return 0;
  }
}
