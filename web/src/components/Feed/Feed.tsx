"use client";

import { useEffect, useRef, useState } from "react";
import type { BlockEvent, Meta } from "@/lib/types";
import { fmtClock, fmtPrice, shortTx, txUrl } from "@/lib/format";
import styles from "./Feed.module.css";

/** Must match `.row { height }` in Feed.module.css. */
const ROW_H = 26;
/** Hard ceiling, so a very tall viewport does not render an absurd list. */
const MAX_ROWS = 40;

type Kind = "buy" | "sell" | "late";

function kindOf(event: BlockEvent): Kind {
  const d = event.decision;
  if (!d || d.late) return "late";
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
  late: styles.kindLate,
};

function wordOf(event: BlockEvent, kind: Kind): string {
  const d = event.decision;
  if (kind === "late") return "LATE";
  if (d?.intent === "close") return "CLOSE";
  if (d?.intent === "open") return "OPEN";
  if (d?.action === "buy") return "BUY";
  if (d?.action === "sell") return "SELL";
  return "LATE";
}

/**
 * One row per tick, newest first. Clock is the tick time to the second. The word is the side
 * the model picked. Detail is the quote, or the fill when a taker hit us.
 */
export default function Feed({ events, meta }: { events: BlockEvent[]; meta?: Meta | null }) {
  const listRef = useRef<HTMLDivElement | null>(null);
  // How many whole 26px rows fit in the box the layout gives us. The list
  // itself clips, so a wrong guess is never a half-drawn row, only a hidden one.
  const [capacity, setCapacity] = useState(MAX_ROWS);

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

  const rows = events.slice(-capacity).reverse();

  return (
    <section className={styles.feed}>
      <div className={styles.label}>FEED</div>
      <div className={styles.list} ref={listRef}>
        {rows.length === 0 ? (
          <div className={styles.empty}>no ticks yet</div>
        ) : (
          rows.map((event, i) => {
            const kind = kindOf(event);
            const decision = event.decision;
            const quote = event.quote;
            const fill = event.fill;
            const decided = kind !== "late";
            const kindClass = KIND_CLASS[kind];

            const conf =
              !decided || !decision
                ? ""
                : "conf " +
                  Math.max(
                    decision.probabilities.long ?? 0,
                    decision.probabilities.short ?? 0,
                    decision.probabilities.open ?? 0,
                    decision.probabilities.close ?? 0,
                    decision.probabilities.buy,
                    decision.probabilities.sell,
                    decision.probabilities.hold,
                  ).toFixed(2);

            const lat = !decided || !decision ? "" : `${decision.latencyMs}ms`;

            let detail = "";
            let detailMuted = false;
            if (fill && fill.size > 0) {
              detail = `FILL ${fmtSize(fill.size)} @ ${fmtPrice(fill.price)}`;
            } else if (decided && quote) {
              const word = quote.side === "buy" ? "bid" : "ask";
              const lev = decision?.leverage != null ? ` ${decision.leverage}x` : "";
              const bias = decision?.bias ? ` ${decision.bias}` : "";
              detail = `${word} ${fmtSize(quote.size)} @ ${fmtPrice(quote.price)}${bias}${lev}${quote.reduceOnly ? " reduce" : ""}`;
              detailMuted = quote.status === "reverted";
            } else if (decided && decision?.intent === "close" && event.position.side === "flat") {
              detail = "already flat";
              detailMuted = true;
            } else if (decided) {
              detail = "";
            }

            const rowClass = [styles.row, kindClass, i === 0 ? styles.newest : "", fill ? styles.filled : ""]
              .filter(Boolean)
              .join(" ");

            return (
              <div key={event.block} className={rowClass}>
                <span className={`${styles.cell} ${styles.time}`}>{fmtClock(event.ts, true)}</span>
                <span className={`${styles.cell} ${styles.word}`}>{wordOf(event, kind)}</span>
                <span className={`${styles.cell} ${styles.conf}`}>{conf}</span>
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
