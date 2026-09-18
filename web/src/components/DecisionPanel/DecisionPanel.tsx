"use client";

import type { BlockEvent, Meta } from "@/lib/types";
import { fmtCall, fmtPct } from "@/lib/format";
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

export default function DecisionPanel({ latest }: DecisionPanelProps) {
  const decision = latest?.decision ?? null;
  const late = decision ? decision.late : true;
  const held = decision?.intent === "hold";
  const chosen =
    decision && !decision.late && !held && decision.action !== "hold"
      ? (decision.bias ?? decision.action)
      : null;

  const probs = decision?.probabilities ?? { buy: 0, sell: 0, hold: 0 };
  // A hold is a real answer, so its bars stay readable instead of greying out.
  const decided = decision !== null && !late && (chosen !== null || held);
  const pctOf = (p: number | undefined) => (decided ? fmtPct(p ?? 0) : "-");

  const headline = decided ? fmtCall(decision) || "LATE" : "LATE";
  const headlineColor = held
    ? "var(--ink-2)"
    : chosen
      ? (decision?.bias ?? decision?.action) === "short" || decision?.action === "sell"
        ? "var(--sell-ink)"
        : "var(--buy-ink)"
      : "var(--late-ink)";

  return (
    <div className={styles.panel}>
      <section className={styles.section}>
        <div className={styles.railHead}>CALL</div>
        <div className={styles.body}>
          <div className={styles.headline}>
            <span className={styles.headlineWord} style={{ color: headlineColor }}>
              {headline}
            </span>
            {decided && decision ? (
              <span className={styles.metaLine}>{decision.latencyMs} ms</span>
            ) : null}
          </div>

          <div className={styles.bars}>
            <BarRow
              label="long"
              labelColor="var(--buy-ink)"
              active={!held && decision?.bias === "long"}
              value={probs.long ?? probs.buy}
              fill={!held && decision?.bias === "long" ? "var(--buy-bar)" : "var(--buy-bar-dim)"}
              pct={pctOf(probs.long ?? probs.buy)}
            />
            <BarRow
              label="short"
              labelColor="var(--sell-ink)"
              active={!held && decision?.bias === "short"}
              value={probs.short ?? probs.sell}
              fill={!held && decision?.bias === "short" ? "var(--sell-bar)" : "var(--sell-bar-dim)"}
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
            <BarRow
              label="hold"
              labelColor="var(--ink)"
              active={held}
              value={probs.hold ?? 0}
              fill={held ? "var(--ink-2)" : "var(--hold-cell)"}
              pct={pctOf(probs.hold)}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
