import { expect, test } from "bun:test";
import {
  LEGACY_UNSCOPED_COIN,
  blockEventKey,
  countEventsByCoin,
  dedupeSortEvents,
  historicalThroughTs,
  inferJsonlFileScope,
  normalizeArchiveEvent,
  parseJsonl,
  tapeFromEvents,
} from "../src/history-import";
import { HistoryStore } from "../src/history-store";
import type { BlockEvent } from "../src/types";

type FixtureFile = {
  events: unknown[];
  eventCountInFixture: number;
};

test("inferJsonlFileScope maps filenames without inventing BTC on legacy", () => {
  expect(inferJsonlFileScope("history/events.jsonl")).toBe(LEGACY_UNSCOPED_COIN);
  expect(inferJsonlFileScope("events-BTC.jsonl")).toBe("BTC");
  expect(inferJsonlFileScope("events-avax.jsonl")).toBe("AVAX");
  expect(inferJsonlFileScope("other.jsonl")).toBeUndefined();
});

test("sanitized fixture parses 16 events with Mon and Sz field eras", async () => {
  const fixture = (await Bun.file("test/fixtures/restore-fixture-sanitized.json").json()) as FixtureFile;
  expect(fixture.events.length).toBe(fixture.eventCountInFixture);
  const scopes = [
    LEGACY_UNSCOPED_COIN,
    LEGACY_UNSCOPED_COIN,
    LEGACY_UNSCOPED_COIN,
    "BTC",
    "BTC",
    "ETH",
    "ETH",
    "SOL",
    "SOL",
    "DOGE",
    "DOGE",
    "BNB",
    "BNB",
    "AVAX",
    "GOLD",
    "NVDA",
  ];
  const normalized: BlockEvent[] = [];
  for (let i = 0; i < fixture.events.length; i++) {
    const ev = normalizeArchiveEvent(fixture.events[i], scopes[i]);
    expect(ev).not.toBeNull();
    normalized.push(ev!);
  }
  expect(normalized[0]!.resting.bidSz).toBe(0);
  expect(normalized[0]!.totals.gasSz).toBe(0);
  expect(normalized[3]!.resting.askSz).toBe(0);
  expect(normalized[0]!.coin).toBe(LEGACY_UNSCOPED_COIN);
  expect(normalized[3]!.coin).toBe("BTC");
  expect(normalized.every((e) => e.fill === null)).toBe(true);
  const withQuote = normalized.find((e) => e.quote?.side === "sell");
  expect(withQuote?.quote?.status).toBe("sim");
});

test("parseJsonl keeps legacy rows separate from scoped files", () => {
  const legacyLine = JSON.stringify({
    block: 20,
    ts: 1789652815168,
    mid: 1,
    bestBid: 1,
    bestAsk: 1,
    spreadBps: 0,
    decision: { action: "hold", probabilities: { buy: 0, sell: 0, hold: 1 }, upIn10: 0.5, latencyMs: 0, late: true },
    quote: null,
    fill: null,
    resting: { bidMon: 0, askMon: 0 },
    position: { side: "flat", size: 0, entryPrice: null, unrealizedUsd: 0, unrealizedMon: 0 },
    totals: { blocks: 1, decisions: 1, quotes: 0, fills: 0, reverted: 0, lateBlocks: 0, jevUsd: 0, gasMon: 0, gasUsd: 0, realizedUsd: 0, pnlUsd: 0, pnlMon: 0, pnlPct: 0 },
  });
  const btcLine = JSON.stringify({ ...JSON.parse(legacyLine), coin: "BTC", resting: { bidSz: 0, askSz: 0 }, totals: { ...JSON.parse(legacyLine).totals, gasSz: 0, pnlSz: 0 } });
  const legacy = parseJsonl(legacyLine, { fileScope: LEGACY_UNSCOPED_COIN });
  const btc = parseJsonl(btcLine, { fileScope: "BTC" });
  expect(legacy.events[0]!.coin).toBe(LEGACY_UNSCOPED_COIN);
  expect(btc.events[0]!.coin).toBe("BTC");
  expect(blockEventKey(legacy.events[0]!)).not.toBe(blockEventKey(btc.events[0]!));
});

test("HistoryStore merge is idempotent per scope", async () => {
  const fixture = (await Bun.file("test/fixtures/restore-fixture-sanitized.json").json()) as FixtureFile;
  const scopes = [
    LEGACY_UNSCOPED_COIN,
    LEGACY_UNSCOPED_COIN,
    LEGACY_UNSCOPED_COIN,
    "BTC",
    "BTC",
    "ETH",
    "ETH",
    "SOL",
    "SOL",
    "DOGE",
    "DOGE",
    "BNB",
    "BNB",
    "AVAX",
    "GOLD",
    "NVDA",
  ];
  const store = new HistoryStore();
  let imported = 0;
  for (let i = 0; i < fixture.events.length; i++) {
    const line = JSON.stringify(fixture.events[i]);
    const r = store.mergeJsonl(`${line}\n`, scopes[i]);
    imported += r.imported;
  }
  const legLine = JSON.stringify(fixture.events[0]);
  const again = store.mergeJsonl(`${legLine}\n`, LEGACY_UNSCOPED_COIN);
  expect(imported).toBeGreaterThan(0);
  expect(again.imported).toBe(0);
  expect(store.eventsFor("BTC", []).every((e) => e.coin === "BTC")).toBe(true);
  const counts = countEventsByCoin(store.eventsFor(LEGACY_UNSCOPED_COIN, []));
  expect(counts[LEGACY_UNSCOPED_COIN]).toBe(3);
  expect(tapeFromEvents(store.eventsFor("ETH", [])).length).toBeGreaterThan(0);
  expect(historicalThroughTs(dedupeSortEvents(store.eventsFor("BTC", [])))).not.toBeNull();
});
