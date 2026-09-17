"use client";

import type { BlockEvent, Meta } from "@/lib/types";
import { displayCoin, fmtCall, fmtInt, fmtPct, fmtPrice, fmtSignedUsd, fmtUsd } from "@/lib/format";
import styles from "./DecisionPanel.module.css";

export interface DecisionPanelProps {
  latest: BlockEvent | null;
  meta?: Meta | null;
}

interface BarRowProps {
  label: string;
  labelColor: string;
  active: boolean;
  value: number;
  fill: string;
  pct: string;
}

function BarRow({ label, labelColor, active, value, fill, pct }: BarRowProps) {
  return (
    <div className={styles.row}>
      <span className={styles.label} style={{ color: labelColor, opacity: active ? 1 : 0.38 }}>
        {label}
      </span>
      <div className={styles.track}>
        <div
          className={styles.fill}
          style={{
            width: `${Math.max(0, Math.min(1, value)) * 100}%`,
            background: fill,
          }}
        />
      </div>
      <span className={styles.pct}>{pct}</span>
    </div>
  );
}

export default function DecisionPanel({ latest, meta }: DecisionPanelProps) {
  const decision = latest?.decision ?? null;
  const late = decision ? decision.late : true;
  const chosen =
    decision && !decision.late && decision.action !== "hold"
      ? (decision.bias ?? decision.action)
      : null;

  const probs = decision?.probabilities ?? { buy: 0, sell: 0, hold: 0 };
  const decided = decision !== null && !late && chosen !== null;
  const pctOf = (p: number | undefined) => (decided ? fmtPct(p ?? 0) : "-");

  const headline = decided ? fmtCall(decision) || "LATE" : "LATE";
  const headlineColor = chosen
    ? (decision?.bias ?? decision?.action) === "short" || decision?.action === "sell"
      ? "var(--sell-ink)"
      : "var(--buy-ink)"
    : "var(--late-ink)";

  const pos = latest?.position;
  const coin = meta?.coin ?? "BTC";
  const posPnl = pos?.unrealizedUsd ?? 0;
  const posColor = pos && pos.side !== "flat" ? (posPnl >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)") : undefined;
  const totals = latest?.totals ?? null;

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <div className={styles.railHead}>CALL</div>
        <div className={styles.body}>
          <div className={styles.headline} style={{ color: headlineColor }}>
            <span className={styles.headlineWord}>{headline}</span>
          </div>
          {decided && decision ? (
            <div className={styles.metaLine}>{decision.latencyMs} ms</div>
          ) : null}

          <BarRow
            label="long"
            labelColor="var(--buy-ink)"
            active={decision?.bias === "long"}
            value={probs.long ?? probs.buy}
            fill={decision?.bias === "long" ? "var(--buy-bar)" : "var(--buy-bar-dim)"}
            pct={pctOf(probs.long ?? probs.buy)}
          />
          <BarRow
            label="short"
            labelColor="var(--sell-ink)"
            active={decision?.bias === "short"}
            value={probs.short ?? probs.sell}
            fill={decision?.bias === "short" ? "var(--sell-bar)" : "var(--sell-bar-dim)"}
            pct={pctOf(probs.short ?? probs.sell)}
          />
          <BarRow
            label="open"
            labelColor="var(--ink)"
            active={decision?.intent === "open"}
            value={probs.open ?? 0}
            fill={decision?.intent === "open" ? "var(--buy-bar)" : "var(--buy-bar-dim)"}
            pct={pctOf(probs.open)}
          />
          <BarRow
            label="close"
            labelColor="var(--ink)"
            active={decision?.intent === "close"}
            value={probs.close ?? 0}
            fill={decision?.intent === "close" ? "var(--sell-bar)" : "var(--sell-bar-dim)"}
            pct={pctOf(probs.close)}
          />
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.railHead}>BOOK</div>
        <div className={styles.body}>
          <div className={styles.bookLine}>
            {(pos?.side ?? "flat").toUpperCase()}
            {pos && pos.side !== "flat" ? ` ${pos.size.toFixed(4)} ${displayCoin(coin)}` : ""}
            {pos?.leverage != null ? ` ${pos.leverage}x` : ""}
          </div>
          {pos && pos.side !== "flat" && pos.entryPrice != null ? (
            <div className={styles.bookSub}>entry {fmtPrice(pos.entryPrice)}</div>
          ) : null}
          {pos && pos.side !== "flat" ? (
            <div className={styles.bookSub} style={{ color: posColor }}>
              open {fmtSignedUsd(posPnl, 2)}
            </div>
          ) : null}
          <div className={styles.stats}>
            <span>fills {totals ? fmtInt(totals.fills) : "-"}</span>
            <span>realized {totals ? fmtSignedUsd(totals.realizedUsd, 2) : "-"}</span>
            <span>fees {totals ? fmtUsd(totals.gasUsd, 2) : "-"}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
