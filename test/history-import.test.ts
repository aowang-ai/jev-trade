import { expect, test } from "bun:test";
import {
  blockEventKey,
  dedupeSortEvents,
  historicalThroughTs,
  parseJsonl,
  tapeFromEvents,
} from "../src/history-import";
import { HistoryStore } from "../src/history-store";

test("parseJsonl dedupes identical block events", async () => {
  const text = await Bun.file("test/fixtures/history-sample.jsonl").text();
  const { events } = parseJsonl(text);
  expect(events.length).toBe(2);
  expect(events.map((e) => e.coin).sort()).toEqual(["BTC", "ETH"]);
  expect(historicalThroughTs(events)).toBe(1726598405000);
});

test("dedupeSortEvents keeps latest row per key and sorts by time", () => {
  const a: import("../src/types").BlockEvent = {
    coin: "BTC",
    block: 2,
    ts: 100,
    mid: 1,
    bestBid: 1,
    bestAsk: 1,
    spreadBps: 0,
    decision: null,
    quote: null,
    fill: null,
    resting: { bidSz: 0, askSz: 0 },
    position: { side: "flat", size: 0, entryPrice: null, leverage: null, unrealizedUsd: 0, unrealizedSz: 0 },
    totals: {
      blocks: 1, decisions: 0, quotes: 0, fills: 0, reverted: 0, lateBlocks: 0,
      jevUsd: 0, gasSz: 0, gasUsd: 0, realizedUsd: 0, pnlUsd: 0, pnlSz: 0, pnlPct: 0,
    },
  };
  const b = { ...a, block: 1, ts: 50 };
  const merged = dedupeSortEvents([a, b, { ...a, mid: 2 }]);
  expect(merged.length).toBe(2);
  expect(merged[0]!.block).toBe(1);
  expect(merged[1]!.mid).toBe(2);
  expect(blockEventKey(merged[1]!)).toBe("BTC:2:100");
});

test("HistoryStore merge is idempotent", async () => {
  const text = await Bun.file("test/fixtures/history-sample.jsonl").text();
  const store = new HistoryStore();
  const first = store.mergeJsonl(text);
  const second = store.mergeJsonl(text);
  expect(first.imported).toBeGreaterThan(0);
  expect(second.imported).toBe(0);
  expect(store.eventsFor("BTC", []).length).toBe(1);
  expect(tapeFromEvents(store.eventsFor("ETH", [])).length).toBeGreaterThan(0);
});
