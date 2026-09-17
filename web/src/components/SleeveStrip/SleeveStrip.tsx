"use client";

import type { BlockEvent, SleeveMeta } from "@/lib/types";
import { displayCoin, fmtPosition, fmtSignedUsd } from "@/lib/format";
import styles from "./SleeveStrip.module.css";

export default function SleeveStrip({
  sleeves,
  latestByCoin,
  selected,
  onSelect,
}: {
  sleeves: SleeveMeta[];
  latestByCoin: Record<string, BlockEvent | null>;
  selected: string;
  onSelect: (coin: string) => void;
}) {
  if (!sleeves.length) return null;

  return (
    <div className={styles.strip}>
      {sleeves.map((sleeve) => {
        const latest = latestByCoin[sleeve.coin] ?? null;
        const pos = latest?.position ?? null;
        const pnl = pos?.unrealizedUsd ?? latest?.totals.pnlUsd ?? 0;
        const active = sleeve.coin === selected;
        const posColor =
          pos && pos.side !== "flat" ? (pnl >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)") : undefined;
        return (
          <button
            key={sleeve.coin}
            type="button"
            className={`${styles.card} ${active ? styles.active : ""}`}
            onClick={() => onSelect(sleeve.coin)}
            aria-pressed={active}
            aria-label={`${displayCoin(sleeve.coin)} ${sleeve.pair}`}
          >
            <span className={styles.label}>{sleeve.label}</span>
            <span className={styles.pos}>{fmtPosition(pos, sleeve.coin)}</span>
            <span className={styles.pnl} style={{ color: posColor }}>
              {latest ? fmtSignedUsd(pnl) : "-"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
