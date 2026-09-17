"use client";

import type { BlockEvent, Meta } from "@/lib/types";
import { fmtCall, fmtPct, fmtPosition, fmtSignedUsd } from "@/lib/format";
import styles from "./DecisionPanel.module.css";

export interface DecisionPanelProps {
  latest: BlockEvent | null;
  meta?: Meta | null;
}

type Chosen = "buy" | "sell" | "long" | "short" | "open" | "close" | null;

interface BarRowProps {
  label: string;
  /** css color for the label text */
  labelColor: string;
  /** dims the label to .38 when false */
  active: boolean;
  /** 0..1, fill width as a fraction of the track */
  value: number;
  /** css background for the fill */
  fill: string;
  /** right-hand percentage text ("62%" or "-") */
  pct: string;
}

function BarRow({ label, labelColor, active, value, fill, pct }: BarRowProps) {
  return (
    <div className={styles.row}>
      <span
        className={styles.label}
        style={{ color: labelColor, opacity: active ? 1 : 0.38 }}
      >
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
  // "hold" is treated as a non-decision, exactly as the feed does.
  const chosen: Chosen =
    decision && !decision.late && decision.action !== "hold"
      ? (decision.bias ?? decision.action)
      : null;

  const probs = decision?.probabilities ?? { buy: 0, sell: 0, hold: 0 };
  const decided = decision !== null && !late && chosen !== null;
  const pctOf = (p: number | undefined) => (decided ? fmtPct(p ?? 0) : "-");

  const headline = decided ? (fmtCall(decision) || "LATE") : "LATE";
  const headlineColor = chosen
    ? (decision?.bias ?? decision?.action) === "short" || decision?.action === "sell"
      ? "var(--sell-ink)"
      : "var(--buy-ink)"
    : "var(--late-ink)";
  const headlinePct = decided && decision?.leverage != null ? `${decision.leverage}x` : "";

  const pos = latest?.position;
  const coin = meta?.coin ?? "BTC";
  const posPnl = pos?.unrealizedUsd ?? 0;
  const posColor = pos && pos.side !== "flat" ? (posPnl >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)") : undefined;

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <div className={styles.sectionLabel}>POSITION</div>
        <div className={styles.order}>
          <div>{fmtPosition(pos, coin)}</div>
          {pos && pos.side !== "flat" ? (
            <div style={{ color: posColor }}>pos {fmtSignedUsd(posPnl)}</div>
          ) : null}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>STANDING ORDER</div>
        <div className={styles.order}>
          {standingCopy(meta)}
        </div>
      </section>

      <section className={styles.section}>
        <div className={`${styles.sectionLabel} ${styles.sectionLabelGap}`}>
          WHAT JEV PICKED
        </div>

        <div className={styles.headline} style={{ color: headlineColor }}>
          <span className={styles.headlineWord}>{headline}</span>
          {headlinePct ? (
            <span className={styles.headlinePct}>{headlinePct}</span>
          ) : null}
        </div>

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
      </section>
    </div>
  );
}

function standingCopy(meta?: Meta | null): string {
  const pair = meta?.pair ?? meta?.market ?? "BTC-USD";
  return `> Jev picks long or short, open or close, and leverage. we post that quote on Hyperliquid ${pair} every tick.`;
}
