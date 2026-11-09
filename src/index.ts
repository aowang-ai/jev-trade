import { config, assertRestorationSafety } from "./config";
import { Feed } from "./feed";
import { HistoryStore } from "./history-store";
import { LEGACY_UNSCOPED_COIN } from "./history-import";
import { loadHistoryBundle } from "./r2-history";
import { Market } from "./market";
import { createModel } from "./model";
import { liveAccountFromMarket, liveAccountsFromMarkets } from "./live-account";
import { loadSleeves } from "./sleeves";
import { startServer, type SleeveView } from "./server";
import { Trader } from "./trader";
import type { BlockEvent, Fill, Meta, Quote, Timing } from "./types";

assertRestorationSafety();

const historyStore = new HistoryStore();

async function bootstrapHistory() {
  await historyStore.loadFromDisk();
  if (config.historyAutoLoadR2Key) {
    const raw = await loadHistoryBundle(config.historyAutoLoadR2Key);
    if (raw) historyStore.importBundle(raw);
  }
}

await bootstrapHistory();

const specs = loadSleeves();
if (!specs.length) throw new Error("no sleeves");

const views: SleeveView[] = [];
const markets: Market[] = [];
const first = specs[0]!;
const meta: Meta = {
  model: config.model,
  wallet: null,
  dryRun: config.dryRun || specs.every((s) => !s.privateKey),
  market: first.pair,
  startedAt: Date.now(),
  venue: "hyperliquid",
  coin: first.coin,
  pair: first.pair,
  explorerTx: config.explorerTx,
  tickMs: config.tickMs,
  sleeves: [],
  restorationMode: config.restorationMode,
  executionEnabled: config.executionEnabled,
  networkLabel: config.networkLabel,
  historicalThroughTs: historyStore.historicalThrough(),
  legacyUnscopedCoin: LEGACY_UNSCOPED_COIN,
  legacyUnscopedCount: historyStore.stats().coins[LEGACY_UNSCOPED_COIN]?.events ?? 0,
  liveAccountsByCoin: {},
};

let server: ReturnType<typeof startServer> | undefined;
const starters: Array<() => void> = [];

for (const spec of specs) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const feed = new Feed(spec.coin);
      feed.onPrice = (book) => {
        server?.broadcastPrice(spec.coin, {
          ts: Date.now(),
          mid: book.mid,
          bestBid: book.bid,
          bestAsk: book.ask,
          spreadBps: book.spreadBps,
        });
      };
      await feed.connect();
      const market = new Market(feed, spec);
      markets.push(market);
      await market.init();
      market.onAccountRefresh = () => {
        if (!meta.liveAccountsByCoin) meta.liveAccountsByCoin = {};
        const row = liveAccountFromMarket(market);
        meta.liveAccountsByCoin[market.coin] = row;
        server?.broadcastAccount(market.coin, row);
        server?.invalidateSnapshot();
      };
      const trader = new Trader(
        market,
        createModel(),
        onEvent(spec.coin),
        onFill(spec.coin),
        onQuote(spec.coin),
      );
      trader.attachTradeFeed(feed.trades);
      market.onVenueFill = (p) => {
        server?.broadcastFill(spec.coin, 0, {
          side: p.side,
          size: p.size,
          price: p.price,
          txHash: p.hash ?? null,
          orderId: 0,
          simulated: false,
          dir: p.dir,
        }, p.ts);
      };
      views.push({
        coin: spec.coin,
        history: () => historyStore.eventsFor(spec.coin, trader.history),
        tape: () => historyStore.tapeFor(spec.coin, trader.tape),
      });
      meta.sleeves.push({ coin: spec.coin, pair: spec.pair, label: spec.label, wallet: market.address });
      if (spec === first) {
        meta.wallet = market.address;
        meta.coin = spec.coin;
        meta.pair = spec.pair;
        meta.market = spec.pair;
      }
      if (config.executionEnabled) {
        starters.push(() => feed.start((tick) => trader.onBlock(tick)));
      }
      const addr = market.address;
      const label = config.restorationMode
        ? `RESTORATION ${addr ?? "no watch address"}`
        : config.dryRun || !spec.privateKey
          ? "DRY RUN"
          : String(addr);
      console.log(`sleeve ${spec.label} ${spec.pair} ${label}`);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      await Bun.sleep(1000 * (attempt + 1));
    }
  }
  if (lastErr) console.error(`sleeve ${spec.label} failed: ${(lastErr as Error).message}`);
}

if (!views.length) throw new Error("no sleeves started");

meta.historicalThroughTs = historyStore.historicalThrough();

server = startServer(meta, views, {
  history: historyStore,
  onHistoryImported: async () => {
    meta.historicalThroughTs = historyStore.historicalThrough();
    meta.legacyUnscopedCount = historyStore.stats().coins[LEGACY_UNSCOPED_COIN]?.events ?? 0;
    server?.invalidateSnapshot();
  },
});

for (const start of starters) start();

async function refreshLiveAccounts() {
  await Promise.all(markets.map((m) => m.refresh().catch(() => {})));
  meta.liveAccountsByCoin = liveAccountsFromMarkets(markets);
  for (const m of markets) {
    const row = meta.liveAccountsByCoin[m.coin]!;
    server?.broadcastAccount(m.coin, row);
  }
  server?.invalidateSnapshot();
}

await refreshLiveAccounts();
if (config.restorationMode || !config.executionEnabled) {
  setInterval(() => {
    void refreshLiveAccounts();
  }, 30_000);
}

console.log(
  `jev-trade ${meta.sleeves.map((s) => s.label).join(" ")} model=${meta.model}${config.model === "jev" ? ` ${config.jevProvider}` : ""}` +
  `${config.restorationMode ? " RESTORATION" : ""} tick ${config.executionEnabled ? config.tickMs : 0}ms price ${config.priceMs}ms quote $${config.quoteUsd} :${config.port}` +
  `${historyStore.coinKeys().length ? ` history ${historyStore.coinKeys().join(" ")}` : ""}`,
);

function onEvent(coin: string) {
  return (e: BlockEvent, t?: Timing) => {
    server?.broadcast(e);
    if (e.decision && !e.decision.late) {
      const d = e.decision;
      const q = e.quote;
      const lev = d.intent === "open" && d.leverage != null ? ` ${d.leverage}x` : "";
      const call = d.intent === "hold" ? "hold" : d.intent && d.bias ? `${d.intent} ${d.bias}${lev}` : d.action;
      const order = q && ` ${q.side.toUpperCase()} ${q.size} @ ${q.price}${q.taker ? " cross" : ""}${q.reduceOnly ? " reduce" : ""}${q.unchanged ? " unchanged" : q.status === "sim" ? " (sim)" : ` ${q.status}`}`;
      const quote = order || (d.intent === "hold" ? " NO ORDER" : "");
      console.log(`${coin} #${e.block} ${e.mid} ${call} ${d.latencyMs}ms${quote} pnl $${e.totals.pnlUsd}${t ? ` loop ${t.loopMs}ms` : ""}`);
    }
  };
}

function onFill(coin: string) {
  return (block: number, fill: Fill) => {
    const kind = fill.dir === "open" ? "OPEN " : fill.dir === "close" ? "CLOSE " : fill.dir === "flip" ? "FLIP " : "";
    console.log(`${coin} #${block} ${kind}FILL ${fill.side} ${fill.size} @ ${fill.price}${fill.simulated ? " (sim)" : ""}`);
  };
}

function onQuote(coin: string) {
  return (block: number, quote: Quote) => {
    server?.broadcastQuote(coin, block, quote);
    if (quote.status !== "placed") console.log(`${coin} #${block} ${quote.status.toUpperCase()} ${quote.side} @ ${quote.price}`);
  };
}
