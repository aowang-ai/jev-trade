"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BlockEvent, Meta, PricePoint } from "@/lib/types";
import { tapeFills } from "@/lib/fills";
import { fmtClock, fmtPrice, shortTx, txUrl } from "@/lib/format";
import styles from "./Feed.module.css";

const ROW_H = 26;
const MAX_ROWS = 40;

type Kind = "buy" | "sell" | "hold" | "late";
type Filter = "live" | "fills";

function kindOf(event: BlockEvent): Kind {
  const d = event.decision;
  if (!d || d.late) return "late";
  if (d.intent === "hold" || d.action === "hold") return "hold";
  if (d.bias === "short" || d.action === "sell") return "sell";
  if (d.bias === "long" || d.action === "buy") return "buy";
  return "late";
}

function fmtSize(size: number): string {
  if (size > 0 && size < 0.01) {
    return size.toLocaleString("en-US", { maximumFractionDigits: 5, minimumFractionDigits: 3 });
  }
  return size.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const KIND_CLASS: Record<Kind, string> = {
  buy: styles.kindBuy,
  sell: styles.kindSell,
  hold: styles.kindHold,
  late: styles.kindLate,
};

function wordOf(event: BlockEvent, kind: Kind): string {
  const d = event.decision;
  if (event.fill && event.fill.size > 0) return "FILL";
  if (kind === "late") return "LATE";
  if (kind === "hold") return "HOLD";
  if (d?.intent === "close") return "CLOSE";
  if (d?.intent === "open") return "OPEN";
  if (d?.action === "buy") return "BUY";
  if (d?.action === "sell") return "SELL";
  return "LATE";
}

function isLiveRow(event: BlockEvent): boolean {
  return Boolean(event.fill && event.fill.size > 0) || Boolean(event.decision && !event.decision.late);
}

export default function Feed({ events, tape = [], meta }: { events: BlockEvent[]; tape?: PricePoint[]; meta?: Meta | null }) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [capacity, setCapacity] = useState(MAX_ROWS);
  const [filter, setFilter] = useState<Filter>("live");

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const measure = () => {
      const fits = Math.max(1, Math.min(MAX_ROWS, Math.floor(el.clientHeight / ROW_H)));
      setCapacity((prev) => (prev === fits ? prev : fits));
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const callRows = useMemo(() => events.filter(isLiveRow), [events]);
  const fillRows = useMemo(() => tapeFills(tape), [tape]);
  const rows = filter === "fills" ? fillRows : callRows;

  return (
    <section className={styles.feed}>
      <div className={styles.railHead}>
        <span>TAPE</span>
        <span className={styles.tabs}>
          <button
            type="button"
            className={filter === "live" ? styles.tabOn : styles.tab}
            onClick={() => setFilter("live")}
            aria-pressed={filter === "live"}
          >
            CALLS
          </button>
          <span aria-hidden="true">|</span>
          <button
            type="button"
            className={filter === "fills" ? styles.tabOn : styles.tab}
            onClick={() => setFilter("fills")}
            aria-pressed={filter === "fills"}
          >
            FILLS
          </button>
        </span>
      </div>
      <div className={`${styles.list}${filter === "fills" ? ` ${styles.listScroll}` : ""}`} ref={listRef}>
        {rows.length === 0 ? (
          <div className={styles.empty}>{filter === "fills" ? "no fills yet" : "no calls yet"}</div>
        ) : filter === "fills" ? (
          [...fillRows].reverse().map((fill, i) => {
            const kind = fill.side === "sell" ? "sell" : "buy";
            const word = fill.dir === "open" ? "OPEN" : fill.dir === "close" ? "CLOSE" : fill.dir === "flip" ? "FLIP" : "FILL";
            const detail = `${fill.dir ? `${fill.dir} ` : ""}${fmtSize(fill.size)} @ ${fmtPrice(fill.price)}`;
            const rowClass = [styles.row, KIND_CLASS[kind], i === 0 ? styles.newest : "", styles.filled]
              .filter(Boolean)
              .join(" ");
            return (
              <div key={fill.key} className={rowClass}>
                <span className={`${styles.cell} ${styles.time}`}>{fmtClock(fill.ts, true)}</span>
                <span className={`${styles.cell} ${styles.word}`}>{word}</span>
                <span className={`${styles.cell} ${styles.lat}`} />
                <span className={`${styles.cell} ${styles.detail}`}>{detail}</span>
                <span className={`${styles.cell} ${styles.tx}`}>
                  {fill.hash ? (
                    <a href={txUrl(fill.hash, meta?.explorerTx)} target="_blank" rel="noreferrer" title="Hyperliquid fill">
                      {shortTx(fill.hash)}
                    </a>
                  ) : null}
                </span>
              </div>
            );
          })
        ) : (
          callRows.slice(-capacity).reverse().map((event, i) => {
            const kind = kindOf(event);
            const decision = event.decision;
            const quote = event.quote;
            const fill = event.fill;
            const decided = kind !== "late";
            const kindClass = KIND_CLASS[kind];

            const lat = !decided || !decision ? "" : `${decision.latencyMs}ms`;

            let detail = "";
            let detailMuted = false;
            if (fill && fill.size > 0) {
              detail = `${fmtSize(fill.size)} @ ${fmtPrice(fill.price)}`;
            } else if (decided && quote) {
              const word = quote.taker ? "cross" : quote.side === "buy" ? "bid" : "ask";
              const lev = quote.taker || decision?.leverage == null ? "" : ` ${decision.leverage}x`;
              const bias = quote.taker || !decision?.bias ? "" : ` ${decision.bias}`;
              detail = `${word} ${fmtSize(quote.size)} @ ${fmtPrice(quote.price)}${bias}${lev}${quote.reduceOnly ? " reduce" : ""}`;
              detailMuted = quote.status === "reverted";
            } else if (decided && kind === "hold") {
              detail = event.position.side === "flat" ? "flat, no order" : "position held";
              detailMuted = true;
            } else if (decided && decision?.intent === "close" && event.position.side === "flat") {
              detail = "already flat";
              detailMuted = true;
            }

            const rowClass = [styles.row, kindClass, i === 0 ? styles.newest : "", fill ? styles.filled : ""]
              .filter(Boolean)
              .join(" ");

            return (
              <div key={event.block} className={rowClass}>
                <span className={`${styles.cell} ${styles.time}`}>{fmtClock(event.ts, true)}</span>
                <span className={`${styles.cell} ${styles.word}`}>{wordOf(event, kind)}</span>
                <span className={`${styles.cell} ${styles.lat}`}>{lat}</span>
                <span
                  className={`${styles.cell} ${styles.detail}${detailMuted ? ` ${styles.muted}` : ""}`}
                >
                  {detail}
                </span>
                <span className={`${styles.cell} ${styles.tx}`}>
                  {fill && !fill.simulated && fill.txHash ? (
                    <a href={txUrl(fill.txHash, meta?.explorerTx)} target="_blank" rel="noreferrer" title="the taker's transaction">
                      {shortTx(fill.txHash)}
                    </a>
                  ) : quote && quote.status === "sim" ? (
                    <span className={styles.muted}>sim</span>
                  ) : quote && quote.txHash ? (
                    <a
                      className={quote.status === "placed" ? undefined : styles.muted}
                      title={quote.status}
                      href={txUrl(quote.txHash, meta?.explorerTx)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {quote.status === "reverted" ? "rev" : shortTx(quote.txHash)}
                    </a>
                  ) : null}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
