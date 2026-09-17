"use client";

import { fmtSignedUsd } from "@/lib/format";
import Logo from "@/components/Logo/Logo";
import styles from "./Header.module.css";

export interface HeaderProps {
  connection: "connecting" | "live" | "reconnecting";
  portfolioPnl: number | null;
}

export default function Header({ connection, portfolioPnl }: HeaderProps) {
  const live = connection === "live";
  const pnlColor =
    portfolioPnl == null ? undefined : portfolioPnl >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)";

  return (
    <div className={styles.header}>
      <span className={styles.brandLockup}>
        <Logo size={22} />
        <span className={styles.brand}>JEV TRADE</span>
      </span>
      <span className={styles.status} data-live={live ? "true" : "false"}>
        <span className={styles.dot} aria-hidden="true" />
        <span>{live ? "LIVE" : "OFFLINE"}</span>
      </span>
      <span className={styles.spacer} />
      <span className={styles.score}>
        <span className={styles.scoreKey}>PNL</span>
        <span className={styles.scoreVal} style={pnlColor ? { color: pnlColor } : undefined}>
          {portfolioPnl == null ? "-" : fmtSignedUsd(portfolioPnl, 2)}
        </span>
      </span>
    </div>
  );
}
