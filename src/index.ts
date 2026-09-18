import { config } from "./config";
import { Feed } from "./feed";
import { Market } from "./market";
import { createModel } from "./model";
import { loadSleeves } from "./sleeves";
import { startServer, type SleeveView } from "./server";
import { Trader } from "./trader";
import type { BlockEvent, Fill, Meta, Quote, Timing } from "./types";

const specs = loadSleeves();
if (!specs.length) throw new Error("no sleeves");

const views: SleeveView[] = [];
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
};

let server: ReturnType<typeof startServer> | undefined;
const starters: Array<() => void> = [];

for (const spec of specs) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const feed = new Feed(spec.coin);
      await feed.connect();
      const market = new Market(feed, spec);
      await market.init();
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
          txHash: null,
          orderId: 0,
          simulated: false,
          dir: p.dir,
        }, p.ts);
      };
      views.push({ coin: spec.coin, history: () => trader.history, tape: () => trader.tape });
      meta.sleeves.push({ coin: spec.coin, pair: spec.pair, label: spec.label, wallet: market.address });
      if (spec === first) {
        meta.wallet = market.address;
        meta.coin = spec.coin;
        meta.pair = spec.pair;
        meta.market = spec.pair;
      }
      starters.push(() => feed.start((tick) => trader.onBlock(tick)));
      console.log(`sleeve ${spec.label} ${spec.pair} ${config.dryRun || !spec.privateKey ? "DRY RUN" : market.address}`);
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

server = startServer(meta, views);
for (const start of starters) start();

console.log(`jev-trade ${meta.sleeves.map((s) => s.label).join(" ")} model=${meta.model} tick ${config.tickMs}ms quote $${config.quoteUsd} :${config.port}`);

function onEvent(coin: string) {
  return (e: BlockEvent, t?: Timing) => {
    server?.broadcast(e);
    if (e.decision && !e.decision.late) {
      const d = e.decision;
      const q = e.quote;
      const call = d.intent && d.bias ? `${d.intent} ${d.bias}${d.leverage != null ? ` ${d.leverage}x` : ""}` : d.action;
      const quote = !q ? " NO QUOTE" : ` ${q.side.toUpperCase()} ${q.size} @ ${q.price}${q.reduceOnly ? " reduce" : ""}${q.unchanged ? " hold" : q.status === "sim" ? " (sim)" : ` ${q.status}`}`;
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
