"use client";

import type { BlockEvent, SleeveMeta } from "@/lib/types";
import { displayCoin, fmtCoin, fmtPrice, fmtSignedUsd } from "@/lib/format";
import TokenIcon from "@/components/TokenIcon/TokenIcon";
import styles from "./SleeveStrip.module.css";

export default function SleeveStrip({
  sleeves,
  latestByCoin,
  lastCallByCoin,
  selected,
  onSelect,
}: {
  sleeves: SleeveMeta[];
  latestByCoin: Record<string, BlockEvent | null>;
  lastCallByCoin: Record<string, string>;
  selected: string;
  onSelect: (coin: string) => void;
}) {
  if (!sleeves.length) return null;

  return (
    <div className={styles.strip}>
      {sleeves.map((sleeve) => {
        const latest = latestByCoin[sleeve.coin] ?? null;
        const pos = latest?.position ?? null;
        const pnl = pnlOf(latest);
        const active = sleeve.coin === selected;
        const pnlColor = latest ? (pnl >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)") : undefined;
        const side = (pos?.side ?? "flat").toUpperCase();
        const sideColor =
          pos?.side === "long" ? "var(--buy-ink)" : pos?.side === "short" ? "var(--sell-ink)" : undefined;
        const lev = pos?.leverage != null ? `${pos.leverage}x` : "";
        const size =
          pos && pos.side !== "flat" ? fmtCoin(pos.size, sleeve.coin, 4) : "";
        const call = lastCallByCoin[sleeve.coin] || (latest?.decision?.late ? "LATE" : "");
        return (
          <button
            key={sleeve.coin}
            type="button"
            className={`${styles.card} ${active ? styles.active : ""}`}
            onClick={() => onSelect(sleeve.coin)}
            aria-pressed={active}
            aria-label={`${displayCoin(sleeve.coin)} ${side} pnl ${latest ? fmtSignedUsd(pnl, 2) : "unknown"}`}
          >
            <span className={styles.top}>
              <span className={styles.name}>
                <TokenIcon coin={sleeve.coin} />
                <span className={styles.label}>{sleeve.label}</span>
              </span>
              <span className={styles.mid}>{latest ? fmtPrice(latest.mid) : "-"}</span>
            </span>
            <span className={styles.pnl} style={{ color: pnlColor }}>
              {latest ? fmtSignedUsd(pnl, 2) : "-"}
            </span>
            <span className={styles.book} style={sideColor ? { color: sideColor } : undefined}>
              {side}
              {lev ? ` ${lev}` : ""}
              {size ? ` ${size}` : ""}
            </span>
            <span className={styles.call}>{call || " "}</span>
          </button>
        );
      })}
    </div>
  );
}

function pnlOf(latest: BlockEvent | null | undefined): number {
  if (!latest) return 0;
  return latest.totals?.pnlUsd ?? latest.position?.unrealizedUsd ?? 0;
}
