"use client";

import { useEffect, useMemo, useState } from "react";
import type { BlockEvent, Meta, PricePoint } from "@/lib/types";
import { fmtCall, fmtPrice } from "@/lib/format";
import { barsForView, fillMarks, type BarSize } from "@/lib/ohlc";
import CandlePane from "./CandlePane";
import styles from "./FlowChart.module.css";

const INTERVALS: { id: BarSize; label: string }[] = [
  { id: "1s", label: "1s" },
  { id: "1m", label: "1m" },
  { id: "5m", label: "5m" },
  { id: "15m", label: "15m" },
  { id: "1H", label: "1H" },
];

const DEFAULT_INTERVAL: BarSize = "1s";
const VISIBLE_BARS = 80;

export default function FlowChart({
  tape = [],
  events,
  latest,
  meta,
  onNeedMoreTape,
}: {
  tape?: PricePoint[];
  events: BlockEvent[];
  latest: BlockEvent | null;
  meta?: Meta | null;
  onNeedMoreTape?: () => void;
}) {
  const [interval, setIntervalId] = useState<BarSize>(DEFAULT_INTERVAL);

  useEffect(() => {
    setIntervalId(DEFAULT_INTERVAL);
  }, [meta?.coin]);

  useEffect(() => {
    if (interval !== "1s") onNeedMoreTape?.();
  }, [interval, onNeedMoreTape]);

  const model = useMemo(() => {
    const src = tape ?? [];
    const candles = barsForView(src, interval);
    if (!candles.length) return null;
    return {
      candles,
      marks: fillMarks(src, interval),
    };
  }, [tape, interval]);

  const shown = latest ?? events[events.length - 1] ?? null;
  const d = shown?.decision ?? null;
  const late = d?.late === true;
  const word = late ? "LATE" : fmtCall(d) || "HOLD";
  const wordColor = late
    ? "var(--late-ink)"
    : d?.intent === "hold" || d?.action === "hold"
      ? "var(--ink-2)"
      : (d?.bias ?? d?.action) === "short" || d?.action === "sell"
        ? "var(--sell-ink)"
        : d?.action === "buy" || d?.bias === "long"
          ? "var(--buy-ink)"
          : "var(--ink)";
  const lastPx = shown?.mid ?? model?.candles.at(-1)?.close;
  const coin = meta?.coin ?? "BTC";

  return (
    <div className={styles.wrap}>
      <div className={styles.panel} role="img" aria-label="Price candles. Use the interval buttons.">
        {!model ? (
          <div className={styles.empty}>waiting for prices</div>
        ) : (
          <>
            <CandlePane
              key={coin}
              candles={model.candles}
              marks={model.marks}
              rangeKey={`${coin}:${interval}`}
              visibleBars={VISIBLE_BARS}
              secondsVisible={interval === "1s"}
              formatPrice={fmtPrice}
            />
            <div className={styles.tl}>
              <div className={styles.price}>{fmtPrice(lastPx)}</div>
              <div className={styles.sub}>
                <span>{meta?.pair ?? "BTC-USD"}</span>
                <span>{interval}</span>
                <span className={styles.wordMobile} style={{ color: wordColor }}>
                  {word}
                </span>
              </div>
            </div>
            <div className={styles.tr}>
              <div className={styles.word} style={{ color: wordColor }}>
                {word}
              </div>
            </div>
            <div className={styles.legend} aria-hidden="true">
              <span className={styles.legUp}>up</span>
              <span className={styles.legDown}>down</span>
              <span className={styles.legBuy}>buy fill</span>
              <span className={styles.legSell}>sell fill</span>
            </div>
          </>
        )}
      </div>
      <div className={styles.tools}>
        {INTERVALS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`${styles.tool} ${interval === s.id ? styles.toolOn : ""}`}
            aria-pressed={interval === s.id}
            onClick={() => setIntervalId(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
