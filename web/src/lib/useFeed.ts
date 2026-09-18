"use client";

import { useEffect, useReducer } from "react";
import type { BlockEvent, ConnectionState, FeedState, Fill, Meta, PricePoint, Quote, SleeveFeed } from "./types";

const CAP = 1000;
const TAPE_CAP = 200_000;
const BACKOFF_MIN = 1000;
const BACKOFF_MAX = 10_000;
const STALE_MS = 45_000;

interface SleeveMem extends SleeveFeed {
  latSum: number;
  latCount: number;
}

interface State {
  meta: Meta | null;
  connection: ConnectionState;
  sleeves: Record<string, SleeveMem>;
}

type Action =
  | { type: "snapshot"; meta: Meta | null; historyByCoin: Record<string, BlockEvent[]>; tapeByCoin: Record<string, PricePoint[]> }
  | { type: "block"; event: BlockEvent }
  | { type: "fill"; coin: string; block: number; fill: Fill; ts?: number }
  | { type: "quote"; coin: string; block: number; quote: Quote }
  | { type: "connection"; connection: ConnectionState };

const emptySleeve = (): SleeveMem => ({
  events: [],
  tape: [],
  latest: null,
  avgLatencyMs: 0,
  latSum: 0,
  latCount: 0,
});

function latencyOf(e: BlockEvent): number | null {
  const d = e?.decision;
  if (!d || d.late || typeof d.latencyMs !== "number" || !Number.isFinite(d.latencyMs)) return null;
  return d.latencyMs;
}

function indexOfBlock(events: BlockEvent[], block: number): number {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].block === block) return i;
  return -1;
}

function avg(latSum: number, latCount: number): number {
  return latCount > 0 ? Math.round(latSum / latCount) : 0;
}

function insertFillPoint(tape: PricePoint[] | undefined, fill: Fill, ts: number): PricePoint[] {
  const cur = tape ?? [];
  const mark = { side: fill.side, price: fill.price, size: fill.size, dir: fill.dir, hash: fill.txHash ?? undefined };
  for (let i = cur.length - 1; i >= 0; i--) {
    const p = cur[i]!;
    if (p.fill && p.ts === ts && p.fill.side === fill.side && p.fill.price === fill.price && p.fill.size === fill.size) {
      return cur;
    }
  }
  const point: PricePoint = { ts, mid: fill.price, fill: mark };
  const next = cur.slice();
  let idx = next.length;
  for (let i = 0; i < next.length; i++) {
    if (next[i]!.ts > ts) {
      idx = i;
      break;
    }
  }
  next.splice(idx, 0, point);
  return next.length > TAPE_CAP ? next.slice(next.length - TAPE_CAP) : next;
}

function viewOf(s: SleeveMem): SleeveMem {
  return { ...s, avgLatencyMs: avg(s.latSum, s.latCount) };
}

function replaceSleeve(state: State, coin: string, next: SleeveMem): State {
  return { ...state, sleeves: { ...state.sleeves, [coin]: viewOf(next) } };
}

function fromHistory(history: BlockEvent[], tape: PricePoint[]): SleeveMem {
  const events = history.length > CAP ? history.slice(history.length - CAP) : history;
  let latSum = 0;
  let latCount = 0;
  for (const e of events) {
    const l = latencyOf(e);
    if (l !== null) {
      latSum += l;
      latCount++;
    }
  }
  return viewOf({
    events,
    tape,
    latest: events.length ? events[events.length - 1]! : null,
    avgLatencyMs: 0,
    latSum,
    latCount,
  });
}

function applyBlock(s: SleeveMem, ev: BlockEvent): SleeveMem {
  const prev = s.events;
  const last = prev.length ? prev[prev.length - 1] : null;

  if (last && ev.block <= last.block) {
    const idx = indexOfBlock(prev, ev.block);
    if (idx < 0) return s;
    const events = prev.slice();
    const old = events[idx]!;
    events[idx] = ev;
    let latSum = s.latSum;
    let latCount = s.latCount;
    const o = latencyOf(old);
    if (o !== null) {
      latSum -= o;
      latCount--;
    }
    const n = latencyOf(ev);
    if (n !== null) {
      latSum += n;
      latCount++;
    }
    return {
      ...s,
      events,
      latest: events[events.length - 1]!,
      latSum,
      latCount,
    };
  }

  let latSum = s.latSum;
  let latCount = s.latCount;
  const n = latencyOf(ev);
  if (n !== null) {
    latSum += n;
    latCount++;
  }
  let events = prev.concat(ev);
  if (events.length > CAP) {
    const drop = events.length - CAP;
    for (let i = 0; i < drop; i++) {
      const l = latencyOf(events[i]!);
      if (l !== null) {
        latSum -= l;
        latCount--;
      }
    }
    events = events.slice(drop);
  }
  return {
    ...s,
    events,
    latest: ev,
    latSum,
    latCount,
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "connection":
      return state.connection === action.connection ? state : { ...state, connection: action.connection };

    case "snapshot": {
      const coins = new Set<string>([
        ...Object.keys(action.historyByCoin),
        ...Object.keys(action.tapeByCoin),
        ...(action.meta?.sleeves.map((s) => s.coin) ?? []),
      ]);
      const sleeves: Record<string, SleeveMem> = {};
      for (const coin of coins) {
        sleeves[coin] = fromHistory(action.historyByCoin[coin] ?? [], action.tapeByCoin[coin] ?? []);
      }
      return {
        meta: action.meta ?? state.meta,
        connection: "live",
        sleeves,
      };
    }

    case "block": {
      const ev = action.event;
      if (!ev || typeof ev.block !== "number") return state;
      const coin = ev.coin || state.meta?.coin;
      if (!coin) return state;
      return replaceSleeve(state, coin, applyBlock(state.sleeves[coin] ?? emptySleeve(), ev));
    }

    case "fill": {
      const s = state.sleeves[action.coin] ?? emptySleeve();
      const ts = action.ts ?? Date.now();
      const idx = indexOfBlock(s.events, action.block);
      if (idx < 0) {
        return replaceSleeve(state, action.coin, { ...s, tape: insertFillPoint(s.tape, action.fill, ts) });
      }
      const events = s.events.slice();
      const updated: BlockEvent = { ...events[idx]!, fill: action.fill };
      events[idx] = updated;
      return replaceSleeve(state, action.coin, {
        ...s,
        events,
        tape: insertFillPoint(s.tape, action.fill, ts),
        latest: idx === events.length - 1 ? updated : s.latest,
      });
    }

    case "quote": {
      const s = state.sleeves[action.coin] ?? emptySleeve();
      const idx = indexOfBlock(s.events, action.block);
      if (idx < 0) return state;
      const events = s.events.slice();
      const updated: BlockEvent = { ...events[idx]!, quote: action.quote };
      events[idx] = updated;
      return replaceSleeve(state, action.coin, {
        ...s,
        events,
        latest: idx === events.length - 1 ? updated : s.latest,
      });
    }

    default:
      return state;
  }
}

function parseSleeves(raw: unknown): Meta["sleeves"] {
  if (!Array.isArray(raw)) return [];
  const out: Meta["sleeves"] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    if (typeof s.coin !== "string" || typeof s.pair !== "string" || typeof s.label !== "string") continue;
    out.push({
      coin: s.coin,
      pair: s.pair,
      label: s.label,
      wallet: typeof s.wallet === "string" ? s.wallet : null,
    });
  }
  return out;
}

function parseMeta(raw: Record<string, unknown> | null): Meta | null {
  if (!raw) return null;
  return {
    model: typeof raw.model === "string" ? raw.model : "",
    wallet: typeof raw.wallet === "string" ? raw.wallet : null,
    dryRun: Boolean(raw.dryRun),
    market: typeof raw.market === "string" ? raw.market : "BTC-USD",
    startedAt: typeof raw.startedAt === "number" ? raw.startedAt : Date.now(),
    venue: typeof raw.venue === "string" ? raw.venue : "hyperliquid",
    coin: typeof raw.coin === "string" ? raw.coin : "BTC",
    pair: typeof raw.pair === "string" ? raw.pair : "BTC-USD",
    explorerTx: typeof raw.explorerTx === "string" ? raw.explorerTx : "",
    tickMs: typeof raw.tickMs === "number" ? raw.tickMs : 500,
    sleeves: parseSleeves(raw.sleeves),
  };
}

function asEvents(v: unknown): BlockEvent[] {
  return Array.isArray(v) ? (v as BlockEvent[]) : [];
}

function asTape(v: unknown): PricePoint[] {
  return Array.isArray(v) ? (v as PricePoint[]) : [];
}

function mapByCoin(raw: unknown): Record<string, unknown[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v;
  }
  return out;
}

/**
 * Live sleeve feed over SSE.
 *
 * Connects to `${apiUrl}/events` and handles: `snapshot` (meta + historyByCoin + tapeByCoin),
 * `block` (per coin, deduped by block number, capped at 1000), `quote` / `fill`
 * ({ coin, block, ... }) and `ping`. Reconnects with 1s -> 10s backoff.
 */
export function useFeed(apiUrl: string): FeedState {
  const [state, dispatch] = useReducer(reducer, {
    meta: null,
    connection: "connecting" as ConnectionState,
    sleeves: {},
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    const base = (apiUrl || "").replace(/\/+$/, "");

    let closed = false;
    let attempt = 0;
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let staleTimer: ReturnType<typeof setTimeout> | undefined;

    const armStaleTimer = () => {
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        if (!closed) scheduleReconnect();
      }, STALE_MS);
    };

    const teardown = () => {
      if (es) {
        es.onopen = null;
        es.onerror = null;
        es.close();
        es = null;
      }
      if (staleTimer) clearTimeout(staleTimer);
    };

    const scheduleReconnect = () => {
      if (closed) return;
      teardown();
      dispatch({ type: "connection", connection: "reconnecting" });
      const delay = Math.min(BACKOFF_MAX, BACKOFF_MIN * 2 ** attempt);
      attempt++;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, delay);
    };

    const handle = (type: string, fn: (data: unknown) => void) => {
      es?.addEventListener(type, (raw: Event) => {
        armStaleTimer();
        const payload = (raw as MessageEvent).data;
        if (typeof payload !== "string" || !payload) return;
        let data: unknown;
        try {
          data = JSON.parse(payload);
        } catch {
          return;
        }
        fn(data);
      });
    };

    function connect() {
      if (closed) return;
      dispatch({ type: "connection", connection: attempt === 0 ? "connecting" : "reconnecting" });
      es = new EventSource(`${base}/events`);

      es.onopen = () => {
        attempt = 0;
        dispatch({ type: "connection", connection: "live" });
        armStaleTimer();
      };
      es.onerror = () => {
        if (!closed) scheduleReconnect();
      };

      handle("snapshot", (data) => {
        const d = (data ?? {}) as Record<string, unknown>;
        const historyByCoin: Record<string, BlockEvent[]> = {};
        const tapeByCoin: Record<string, PricePoint[]> = {};
        const histMap = mapByCoin(d.historyByCoin);
        const tapeMap = mapByCoin(d.tapeByCoin);
        for (const [coin, rows] of Object.entries(histMap)) historyByCoin[coin] = asEvents(rows);
        for (const [coin, rows] of Object.entries(tapeMap)) tapeByCoin[coin] = asTape(rows);
        if (!Object.keys(historyByCoin).length && Array.isArray(d.history)) {
          const coin = typeof d.coin === "string" ? d.coin : "BTC";
          historyByCoin[coin] = asEvents(d.history);
          tapeByCoin[coin] = asTape(d.tape);
        }
        dispatch({ type: "snapshot", meta: parseMeta(d), historyByCoin, tapeByCoin });
      });
      handle("block", (data) => {
        dispatch({ type: "block", event: data as BlockEvent });
      });
      handle("fill", (data) => {
        const d = (data ?? {}) as { coin?: string; block?: number; fill?: Fill; ts?: number };
        if (typeof d.coin !== "string" || !d.fill) return;
        dispatch({
          type: "fill",
          coin: d.coin,
          block: typeof d.block === "number" ? d.block : 0,
          fill: d.fill,
          ts: typeof d.ts === "number" ? d.ts : undefined,
        });
      });
      handle("quote", (data) => {
        const d = (data ?? {}) as { coin?: string; block?: number; quote?: Quote };
        if (typeof d.coin !== "string" || typeof d.block !== "number" || !d.quote) return;
        dispatch({ type: "quote", coin: d.coin, block: d.block, quote: d.quote });
      });
      handle("ping", () => {
        dispatch({ type: "connection", connection: "live" });
      });
    }

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      teardown();
    };
  }, [apiUrl]);

  const byCoin: Record<string, SleeveFeed> = {};
  for (const [coin, s] of Object.entries(state.sleeves)) {
    byCoin[coin] = { events: s.events, tape: s.tape, latest: s.latest, avgLatencyMs: s.avgLatencyMs };
  }

  return { meta: state.meta, connection: state.connection, byCoin };
}
