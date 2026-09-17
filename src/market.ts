import { ApiRequestError, ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { formatPrice, formatSize, SymbolConverter } from "@nktkas/hyperliquid/utils";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { config } from "./config";
import { accountFromClearinghouse, fillDir, FillPnlBook, type ClearinghouseLike, type FillPnlLike, type VenueAccount } from "./account";
import { quotePrice } from "./book";
import type { Feed } from "./feed";
import { coinDex, sameCoin, type SleeveConfig } from "./sleeves";
import type { Book, Fill, Quote, Side } from "./types";

type Ex = ExchangeClient;

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
  readonly fillPrints: { ts: number; side: Side; price: number; size: number; dir?: Fill["dir"] }[] = [];
  onVenueFill: ((fill: { ts: number; side: Side; price: number; size: number; dir?: Fill["dir"] }) => void) | null = null;

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
    const dex = coinDex(this.coin);
    const converter = await SymbolConverter.create({ transport, dexs: dex ? [dex] : false });
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
        if (this.lastOid === oid) {
          this.lastOid = null;
          this.lastSide = null;
          this.lastSize = 0;
        }
      };
      if (dex) await this.fundHip3(dex);
      else await this.bringHome("xyz");
      if (!dex) await this.flattenForeign(converter);
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
    const dex = coinDex(this.coin);
    try {
      const opens = await this.info.openOrders({ user: this.wallet.address, ...(dex ? { dex } : {}) });
      const mine = opens.filter((o) => sameCoin(o.coin, this.coin));
      if (!mine.length) return;
      await this.ex.cancel({ cancels: mine.map((o) => ({ a: this.assetId, o: o.oid })) });
    } catch {
      // next quote will replace if we still see them
    }
  }

  /** This wallet only quotes `this.coin`. Close leftover perps from a previous sleeve. */
  private async flattenForeign(converter: Awaited<ReturnType<typeof SymbolConverter.create>>) {
    if (!this.wallet || !this.ex) return;
    const user = this.wallet.address;
    try {
      const opens = await this.info.openOrders({ user }).catch(() => []);
      const extra = opens.filter((o) => !sameCoin(o.coin, this.coin));
      if (extra.length) {
        await this.ex.cancel({
          cancels: extra.map((o) => ({ a: converter.getAssetId(o.coin) ?? 0, o: o.oid })).filter((c) => c.a > 0),
        }).catch(() => {});
      }
      const state = await this.info.clearinghouseState({ user }).catch(() => null);
      for (const row of state?.assetPositions ?? []) {
        const coin = row.position?.coin;
        const szi = Number(row.position?.szi ?? 0);
        if (!coin || !szi || sameCoin(coin, this.coin)) continue;
        const asset = converter.getAssetId(coin);
        const szDecimals = converter.getSzDecimals(coin) ?? 4;
        if (asset == null) continue;
        const res = await fetch(config.hlTestnet ? "https://api.hyperliquid-testnet.xyz/info" : "https://api.hyperliquid.xyz/info", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "l2Book", coin }),
        });
        const book = (await res.json()) as { levels?: [{ px: string }[], { px: string }[]] };
        const bid = Number(book.levels?.[0]?.[0]?.px ?? 0);
        const ask = Number(book.levels?.[1]?.[0]?.px ?? 0);
        const buy = szi < 0;
        const raw = buy ? (ask || bid) * 1.02 : (bid || ask) * 0.98;
        if (!(raw > 0)) continue;
        await this.ex.order({
          orders: [{
            a: asset,
            b: buy,
            p: formatPrice(raw, szDecimals),
            s: formatSize(Math.abs(szi), szDecimals),
            r: true,
            t: { limit: { tif: "Ioc" } },
          }],
          grouping: "na",
        }).catch((e) => {
          console.warn(`${this.label} close ${coin}: ${(e as Error).message.slice(0, 140)}`);
        });
      }
    } catch (e) {
      console.warn(`${this.label} flatten: ${(e as Error).message.slice(0, 160)}`);
    }
  }

  private async fundHip3(dex: string) {
    if (!this.wallet || !this.ex) return;
    const user = this.wallet.address;
    const xyz = await this.info.clearinghouseState({ user, dex }).catch(() => null);
    if (Number(xyz?.marginSummary?.accountValue ?? 0) >= 1) {
      if (xyz) this.applyClearinghouse(xyz);
      return;
    }
    const home = await this.info.clearinghouseState({ user }).catch(() => null);
    const wd = Number(home?.withdrawable ?? 0);
    if (!(wd > 1)) return;
    await this.sendUsdc("", dex, wd);
    const funded = await this.info.clearinghouseState({ user, dex }).catch(() => null);
    if (funded) this.applyClearinghouse(funded);
  }

  /** Pull leftover builder-DEX USDC back to the default perp account. */
  private async bringHome(dex: string) {
    if (!this.wallet || !this.ex) return;
    const user = this.wallet.address;
    const state = await this.info.clearinghouseState({ user, dex }).catch(() => null);
    if (!state || Number(state.marginSummary?.accountValue ?? 0) < 0.5) return;
    try {
      const transport = new HttpTransport({ isTestnet: config.hlTestnet });
      const converter = await SymbolConverter.create({ transport, dexs: [dex] });
      const opens = await this.info.openOrders({ user, dex }).catch(() => []);
      if (opens.length) {
        await this.ex.cancel({
          cancels: opens.map((o) => {
            const id = converter.getAssetId(o.coin) ?? converter.getAssetId(`${dex}:${o.coin}`);
            return { a: id ?? 0, o: o.oid };
          }).filter((c) => c.a > 0),
        }).catch(() => {});
      }
      for (const row of state.assetPositions ?? []) {
        const coin = row.position?.coin;
        const szi = Number(row.position?.szi ?? 0);
        if (!coin || !szi) continue;
        const asset = converter.getAssetId(coin) ?? converter.getAssetId(`${dex}:${coin}`);
        const szDecimals = converter.getSzDecimals(coin) ?? converter.getSzDecimals(`${dex}:${coin}`) ?? 4;
        if (asset == null) continue;
        const res = await fetch(config.hlTestnet ? "https://api.hyperliquid-testnet.xyz/info" : "https://api.hyperliquid.xyz/info", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "l2Book", coin }),
        });
        const book = (await res.json()) as { levels?: [{ px: string }[], { px: string }[]] };
        const bid = Number(book.levels?.[0]?.[0]?.px ?? 0);
        const ask = Number(book.levels?.[1]?.[0]?.px ?? 0);
        const buy = szi < 0;
        const raw = buy ? (ask || bid) * 1.02 : (bid || ask) * 0.98;
        if (!(raw > 0)) continue;
        await this.ex.order({
          orders: [{
            a: asset,
            b: buy,
            p: formatPrice(raw, szDecimals),
            s: formatSize(Math.abs(szi), szDecimals),
            r: true,
            t: { limit: { tif: "Ioc" } },
          }],
          grouping: "na",
        }).catch((e) => {
          console.warn(`${this.label} close ${coin}: ${(e as Error).message.slice(0, 140)}`);
        });
      }
    } catch (e) {
      console.warn(`${this.label} unwind ${dex}: ${(e as Error).message.slice(0, 160)}`);
    }
    const after = await this.info.clearinghouseState({ user, dex }).catch(() => null);
    const wd = Number(after?.withdrawable ?? 0);
    if (!(wd > 1)) return;
    await this.sendUsdc(dex, "", wd);
  }

  private async sendUsdc(sourceDex: string, destinationDex: string, withdrawable: number) {
    if (!this.wallet || !this.ex) return;
    const meta = await this.info.spotMeta();
    const usdc = meta.tokens.find((t) => t.name === "USDC");
    if (!usdc) {
      console.warn(`${this.label} no USDC token`);
      return;
    }
    const amount = (Math.floor((withdrawable - 0.01) * 100) / 100).toFixed(2);
    let lastErr: unknown;
    for (let i = 0; i < 4; i++) {
      try {
        await this.ex.sendAsset({
          destination: this.wallet.address,
          sourceDex,
          destinationDex,
          token: `USDC:${usdc.tokenId}`,
          amount,
        }, { timeout: 30_000 });
        console.log(`${this.label} moved $${amount} USDC ${sourceDex || "perp"} -> ${destinationDex || "perp"}`);
        return;
      } catch (e) {
        lastErr = e;
        await Bun.sleep(1500 * (i + 1));
      }
    }
    if (lastErr) console.warn(`${this.label} sendAsset: ${(lastErr as Error).message.slice(0, 180)}`);
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
      const print = { ts, side, price, size: Number.isFinite(size) ? size : 0, dir: fillDir(fill.dir) };
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
      const dex = coinDex(this.coin);
      this.applyClearinghouse(await this.info.clearinghouseState({ user: this.address, ...(dex ? { dex } : {}) }));
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

  async send(side: Side, sizeSz: number, book: Book, cancel: number[], reduceOnly = false): Promise<Quote> {
    const price = quotePrice(side, book, this.szDecimals);
    const size = lot(sizeSz, this.szDecimals);
    const base = { side, reduceOnly, capped: false as const };
    if (size <= 0) {
      return { ...base, price: 0, size: 0, txHash: null, cancel, status: "reverted", orderId: null };
    }
    let px = Number(formatPrice(price, this.szDecimals));
    if (side === "sell" && px <= book.bid) px = Number(formatPrice(book.ask, this.szDecimals));
    if (side === "buy" && px >= book.ask) px = Number(formatPrice(book.bid, this.szDecimals));
    if (!this.ex) {
      return { ...base, price: px, size, txHash: null, cancel, status: "sim", orderId: null };
    }
    if (
      this.lastOid != null &&
      this.lastSide === side &&
      this.lastPrice === px &&
      this.lastSize === size &&
      this.lastReduce === reduceOnly
    ) {
      return { ...base, price: px, size, txHash: null, cancel: [], status: "placed", orderId: this.lastOid, unchanged: true };
    }

    const order = {
      a: this.assetId,
      b: side === "buy",
      p: formatPrice(px, this.szDecimals),
      s: formatSize(size, this.szDecimals),
      r: reduceOnly,
      t: { limit: { tif: "Alo" as const } },
    };

    try {
      if (this.lastOid != null && this.lastSide === side && this.lastReduce === reduceOnly) {
        await this.ex.modify({ oid: this.lastOid, order });
        this.lastPrice = px;
        this.lastSize = size;
        return { ...base, price: px, size, txHash: null, cancel: [], status: "placed", orderId: this.lastOid };
      }

      const oids = this.lastOid != null ? [this.lastOid] : cancel.filter((id) => id > 0);
      if (oids.length) {
        await this.ex.cancel({ cancels: oids.map((o) => ({ a: this.assetId, o })) }).catch(() => {});
        this.lastOid = null;
      }

      const res = await this.ex.order({ orders: [order], grouping: "na" });
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
        this.lastOid = null;
        this.lastSide = null;
        return { ...base, price: px, size, txHash: null, cancel: oids, status: "placed", orderId: st.filled.oid };
      }
      this.lastOid = null;
      this.lastSide = null;
      return { ...base, price: px, size, txHash: null, cancel: oids, status: "reverted", orderId: null };
    } catch (e) {
      const msg = e instanceof ApiRequestError ? e.message : (e as Error).message;
      if (/rate.?limit/i.test(msg)) console.warn(`${this.label}: hyperliquid rate limited; standing quote kept`);
      else console.warn(`${this.label} quote: ${msg.slice(0, 180)}`);
      return { ...base, price: px, size, txHash: null, cancel, status: "reverted", orderId: this.lastOid };
    }
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
