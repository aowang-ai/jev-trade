"use client";

import type { BlockEvent, SleeveMeta } from "@/lib/types";
import { displayCoin, fmtCoin, fmtPrice, fmtSignedUsd } from "@/lib/format";
import TokenIcon from "@/components/TokenIcon/TokenIcon";
import { Bone } from "@/components/Skeleton/Skeleton";
import styles from "./SleeveStrip.module.css";

export default function SleeveStrip({
  sleeves,
  latestByCoin,
  lastCallByCoin,
  selected,
  onSelect,
  waiting = false,
}: {
  sleeves: SleeveMeta[];
  latestByCoin: Record<string, BlockEvent | null>;
  lastCallByCoin: Record<string, string>;
  selected: string;
  onSelect: (coin: string) => void;
  waiting?: boolean;
}) {
  if (!sleeves.length) {
    if (!waiting) return null;
    return (
      <div className={styles.strip} aria-busy="true" aria-label="Loading markets" style={{ pointerEvents: "none" }}>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={styles.card}>
            <span className={styles.top}>
              <Bone w={52} h={12} />
              <Bone w={44} h={10} />
            </span>
            <Bone w={72} h={18} />
            <Bone w={88} h={10} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.strip}>
      {sleeves.map((sleeve) => {
        const latest = latestByCoin[sleeve.coin] ?? null;
        const pos = latest?.position ?? null;
        const open = Boolean(pos && pos.side !== "flat");
        const pnl = openPnl(latest);
        const active = sleeve.coin === selected;
        const pnlColor = open ? (pnl >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)") : undefined;
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
            aria-label={`${displayCoin(sleeve.coin)} ${side}${open ? ` unrealized ${fmtSignedUsd(pnl, 2)}` : ""}`}
          >
            <span className={styles.top}>
              <span className={styles.name}>
                <TokenIcon coin={sleeve.coin} />
                <span className={styles.label}>{sleeve.label}</span>
              </span>
              <span className={styles.mid}>{latest ? fmtPrice(latest.mid) : "-"}</span>
            </span>
            <span className={styles.pnl} style={pnlColor ? { color: pnlColor } : undefined}>
              {open ? fmtSignedUsd(pnl, 2) : "-"}
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

function openPnl(latest: BlockEvent | null | undefined): number {
  const pos = latest?.position;
  if (!pos || pos.side === "flat") return 0;
  return pos.unrealizedUsd ?? 0;
}
