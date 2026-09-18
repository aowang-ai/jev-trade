import { config } from "./config";
import type { Book } from "./types";
import { fillDir, type ClearinghouseLike, type FillPnlLike } from "./account";
import { bookFromLevels } from "./book";
import { CHART_INTERVAL, VenueChart } from "./chart";
import { parseAssetCtx, type AssetCtx } from "./indicators";
import { sameCoin } from "./sleeves";
import { TradeFeed } from "./trades";

const INFO_URL = (testnet: boolean) =>
  testnet ? "https://api.hyperliquid-testnet.xyz/info" : "https://api.hyperliquid.xyz/info";
const WS_URL = (testnet: boolean) =>
  testnet ? "wss://api.hyperliquid-testnet.xyz/ws" : "wss://api.hyperliquid.xyz/ws";

/**
 * Local Hyperliquid book + tape over the official WS, with an HTTP snapshot so startup
 * does not wait on the socket. Ticks fire at `tickMs` once a book exists.
 */
export class Feed {
  readonly trades = new TradeFeed();
  readonly chart = new VenueChart();
  assetCtx: AssetCtx | null = null;
  book: Book | null = null;
  tick = 0;
  onGone: ((oid: number) => void) | null = null;
  onClearinghouse: ((state: ClearinghouseLike) => void) | null = null;
  onUserPnl: ((fill: FillPnlLike) => void) | null = null;
  private lastTickAt = 0;
  private onTick: ((tick: number) => void) | null = null;
  private user: `0x${string}` | null = null;
  private ws: WebSocket | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private seenTids = new Set<number>();

  constructor(readonly coin: string) {}

  async connect(): Promise<void> {
    await this.snapshot();
    await this.chart.loadCandles(this.coin).catch((e) => {
      console.warn(`${this.coin} candles: ${(e as Error).message.slice(0, 160)}`);
    });
    this.pollAssetCtx().catch(() => {});
    this.openSocket();
    setInterval(() => this.maybeTick(), config.tickMs);
    setInterval(() => { if (!this.ws || this.ws.readyState !== WebSocket.OPEN) this.snapshot().catch(() => {}); }, 2_000);
    setInterval(() => this.pollTrades().catch(() => {}), 2_000);
    setInterval(() => this.pollAssetCtx().catch(() => {}), 15_000);
    this.pollTrades().catch(() => {});
  }

  watchUser(user: `0x${string}`) {
    this.user = user;
    this.subscribeUser();
  }

  start(onTick: (tick: number) => void) {
    this.onTick = onTick;
    this.maybeTick();
  }

  private async snapshot() {
    const res = await fetch(INFO_URL(config.hlTestnet), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "l2Book", coin: this.coin }),
    });
    if (!res.ok) throw new Error(`hl l2Book HTTP ${res.status}`);
    const data = (await res.json()) as { levels?: [{ px: string; sz: string }[], { px: string; sz: string }[]] };
    if (!data.levels) return;
    const next = bookFromLevels(this.tick, data.levels[0] ?? [], data.levels[1] ?? []);
    if (next) this.book = next;
  }

  private openSocket(delay = 0) {
    setTimeout(() => {
      const ws = new WebSocket(WS_URL(config.hlTestnet));
      this.ws = ws;
      ws.onopen = () => {
        this.send({ method: "subscribe", subscription: { type: "l2Book", coin: this.coin, fast: true } });
        this.send({ method: "subscribe", subscription: { type: "trades", coin: this.coin } });
        this.send({ method: "subscribe", subscription: { type: "candle", coin: this.coin, interval: CHART_INTERVAL } });
        this.send({ method: "subscribe", subscription: { type: "activeAssetCtx", coin: this.coin } });
        this.subscribeUser();
        if (this.ping) clearInterval(this.ping);
        this.ping = setInterval(() => this.send({ method: "ping" }), 20_000);
      };
      ws.onmessage = (e) => this.onMessage(String(e.data));
      ws.onclose = () => {
        if (this.ping) clearInterval(this.ping);
        this.ping = null;
        this.openSocket(Math.min(delay + 500, 8_000));
      };
      ws.onerror = () => ws.close();
    }, delay);
  }

  private subscribeUser() {
    if (!this.user || this.ws?.readyState !== WebSocket.OPEN) return;
    this.send({ method: "subscribe", subscription: { type: "userFills", user: this.user } });
    this.send({ method: "subscribe", subscription: { type: "orderUpdates", user: this.user } });
    this.send({ method: "subscribe", subscription: { type: "clearinghouseState", user: this.user } });
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private onMessage(raw: string) {
    let m: { channel?: string; data?: any };
    try { m = JSON.parse(raw); } catch { return; }
    if (m.channel === "l2Book" && m.data?.levels) {
      const next = bookFromLevels(this.tick, m.data.levels[0] ?? [], m.data.levels[1] ?? []);
      if (next) {
        this.book = next;
        this.maybeTick();
      }
      return;
    }
    if (m.channel === "trades") {
      const prints = Array.isArray(m.data) ? m.data : m.data ? [m.data] : [];
      for (const t of prints) this.ingestPrint(t);
      return;
    }
    if (m.channel === "candle") {
      const rows = Array.isArray(m.data) ? m.data : m.data ? [m.data] : [];
      for (const c of rows) this.chart.upsertCandle(c);
      return;
    }
    if (m.channel === "activeAssetCtx" && m.data) {
      const coin = m.data.coin ?? m.data.ctx?.coin;
      if (coin && !sameCoin(coin, this.coin)) return;
      this.assetCtx = parseAssetCtx(m.data.ctx ?? m.data);
      return;
    }
    if (m.channel === "userFills" && m.data) {
      for (const f of m.data.fills ?? []) {
        if (!sameCoin(f.coin, this.coin)) continue;
        this.onUserPnl?.(f);
        if (m.data.isSnapshot) continue;
        this.trades.pushFill({
          block: this.tick,
          txHash: f.hash,
          orderId: f.oid,
          price: Number(f.px),
          size: Number(f.sz),
          updatedSize: -1,
          side: f.side === "B" ? "buy" : "sell",
          feeUsd: Number(f.fee) || 0,
          dir: fillDir(f.dir),
        });
      }
      return;
    }
    if (m.channel === "clearinghouseState" && m.data) {
      const state = m.data.clearinghouseState ?? m.data;
      if (state?.assetPositions || state?.marginSummary) this.onClearinghouse?.(state);
      return;
    }
    if (m.channel === "orderUpdates" && Array.isArray(m.data)) {
      for (const u of m.data) {
        if (!sameCoin(u.order?.coin, this.coin)) continue;
        if (u.status === "filled" || u.status === "canceled" || u.status === "rejected") this.onGone?.(u.order.oid);
      }
    }
  }

  private async pollAssetCtx() {
    const res = await fetch(INFO_URL(config.hlTestnet), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    });
    if (!res.ok) return;
    const pair = (await res.json()) as [{ universe?: { name?: string }[] }, unknown[]];
    if (!Array.isArray(pair) || pair.length < 2) return;
    const uni = pair[0]?.universe;
    const ctxs = pair[1];
    if (!Array.isArray(uni) || !Array.isArray(ctxs)) return;
    const i = uni.findIndex((u) => u.name === this.coin);
    if (i >= 0) this.assetCtx = parseAssetCtx(ctxs[i]);
  }

  private async pollTrades() {
    const res = await fetch(INFO_URL(config.hlTestnet), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "recentTrades", coin: this.coin }),
    });
    if (!res.ok) return;
    const prints = (await res.json()) as { px: string; sz: string; side: string; tid?: number }[];
    if (!Array.isArray(prints)) return;
    for (const t of prints) this.ingestPrint(t);
  }

  private ingestPrint(t: { px?: string; sz?: string; side?: string; tid?: number }) {
    const tid = t.tid;
    if (tid != null) {
      if (this.seenTids.has(tid)) return;
      this.seenTids.add(tid);
      if (this.seenTids.size > 4000) {
        const first = this.seenTids.values().next().value;
        if (first != null) this.seenTids.delete(first);
      }
    }
    this.trades.pushPrint({
      price: Number(t.px),
      size: Number(t.sz),
      side: t.side === "B" ? "buy" : "sell",
    });
  }

  private maybeTick() {
    if (!this.book || !this.onTick) return;
    const now = Date.now();
    if (now - this.lastTickAt < config.tickMs) return;
    this.lastTickAt = now;
    this.tick++;
    this.trades.setTick(this.tick);
    this.book = { ...this.book, block: this.tick };
    this.onTick(this.tick);
  }
}
