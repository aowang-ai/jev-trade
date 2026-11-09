import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { config } from "./config";
import {
  blockEventKey,
  dedupeSortEvents,
  dedupeSortTape,
  historicalThroughTs,
  parseJsonl,
  tapeFromEvents,
} from "./history-import";
import type { BlockEvent, PricePoint } from "./types";

type PersistedCoin = {
  events: BlockEvent[];
  tape: PricePoint[];
  updatedAt: number;
};

const dataDir = () => config.historyDataDir;

function coinPath(coin: string) {
  return `${dataDir()}/${coin}.json`;
}

export class HistoryStore {
  private byCoin = new Map<string, PersistedCoin>();

  coinKeys(): string[] {
    return [...this.byCoin.keys()].sort();
  }

  stats() {
    const coins: Record<string, { events: number; tape: number; throughTs: number | null }> = {};
    for (const [coin, row] of this.byCoin) {
      coins[coin] = {
        events: row.events.length,
        tape: row.tape.length,
        throughTs: historicalThroughTs(row.events),
      };
    }
    return { coins, dataDir: dataDir() };
  }

  async loadFromDisk() {
    if (!existsSync(dataDir())) return;
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dataDir());
    for (const name of files) {
      if (!name.endsWith(".json")) continue;
      const coin = name.slice(0, -".json".length);
      const file = Bun.file(coinPath(coin));
      if (!(await file.exists())) continue;
      try {
        const row = (await file.json()) as PersistedCoin;
        if (row?.events?.length) this.byCoin.set(coin, {
          events: dedupeSortEvents(row.events),
          tape: dedupeSortTape(row.tape ?? []),
          updatedAt: row.updatedAt ?? 0,
        });
      } catch {
        // leave coin empty
      }
    }
  }

  async saveCoin(coin: string) {
    const row = this.byCoin.get(coin);
    if (!row) return;
    await mkdir(dataDir(), { recursive: true });
    await Bun.write(coinPath(coin), JSON.stringify(row));
  }

  async saveAll() {
    await mkdir(dataDir(), { recursive: true });
    for (const coin of this.byCoin.keys()) await this.saveCoin(coin);
  }

  mergeJsonl(text: string, fileScope?: string): { imported: number; total: number; coins: string[] } {
    const { events, tape } = parseJsonl(text, { fileScope });
    const byCoinEvents = new Map<string, BlockEvent[]>();
    for (const e of events) {
      const list = byCoinEvents.get(e.coin) ?? [];
      list.push(e);
      byCoinEvents.set(e.coin, list);
    }
    let imported = 0;
    const coins: string[] = [];
    for (const [coin, incoming] of byCoinEvents) {
      imported += this.mergeCoin(coin, incoming, tape.length && fileScope === coin ? tape : []);
      coins.push(coin);
    }
    const total = [...this.byCoin.values()].reduce((n, r) => n + r.events.length, 0);
    return { imported, total, coins: [...new Set(coins)] };
  }

  mergeCoin(coin: string, incomingEvents: BlockEvent[], incomingTape: PricePoint[]): number {
    const prev = this.byCoin.get(coin);
    const prevKeys = new Set((prev?.events ?? []).map(blockEventKey));
    let imported = 0;
    for (const e of incomingEvents) {
      const k = blockEventKey(e);
      if (!prevKeys.has(k)) imported++;
      prevKeys.add(k);
    }
    const events = dedupeSortEvents([...(prev?.events ?? []), ...incomingEvents]);
    let tape = dedupeSortTape([...(prev?.tape ?? []), ...incomingTape]);
    if (!tape.length && events.length) tape = tapeFromEvents(events);
    this.byCoin.set(coin, { events, tape, updatedAt: Date.now() });
    return imported;
  }

  eventsFor(coin: string, live: BlockEvent[]): BlockEvent[] {
    const restored = this.byCoin.get(coin)?.events ?? [];
    if (!config.restorationMode && !restored.length) return live;
    if (!live.length) return restored;
    return dedupeSortEvents([...restored, ...live]);
  }

  tapeFor(coin: string, live: PricePoint[]): PricePoint[] {
    const restored = this.byCoin.get(coin)?.tape ?? [];
    if (!restored.length) return live;
    if (!live.length) return restored;
    return dedupeSortTape([...restored, ...live]);
  }

  exportBundle(): string {
    const payload: Record<string, PersistedCoin> = {};
    for (const [coin, row] of this.byCoin) payload[coin] = row;
    return JSON.stringify(payload);
  }

  importBundle(text: string) {
    try {
      const parsed = JSON.parse(text) as Record<string, PersistedCoin>;
      for (const [coin, row] of Object.entries(parsed)) {
        if (!row?.events?.length) continue;
        this.byCoin.set(coin, {
          events: dedupeSortEvents(row.events),
          tape: dedupeSortTape(row.tape ?? []),
          updatedAt: row.updatedAt ?? Date.now(),
        });
      }
    } catch {
      // ignore invalid bundle
    }
  }

  historicalThrough(): number | null {
    let max: number | null = null;
    for (const row of this.byCoin.values()) {
      const t = historicalThroughTs(row.events);
      if (t != null && (max == null || t > max)) max = t;
    }
    return max;
  }
}
