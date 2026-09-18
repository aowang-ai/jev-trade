"use client";

import { fmtSignedUsd } from "@/lib/format";
import Logo from "@/components/Logo/Logo";
import styles from "./Header.module.css";

export interface HeaderProps {
  connection: "connecting" | "live" | "reconnecting";
  unrealized: number | null;
  realized: number | null;
}

function Score({ label, value }: { label: string; value: number | null }) {
  const color = value == null ? undefined : value >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)";
  return (
    <span className={styles.score}>
      <span className={styles.scoreKey}>{label}</span>
      <span className={styles.scoreVal} style={color ? { color } : undefined}>
        {value == null ? "-" : fmtSignedUsd(value, 2)}
      </span>
    </span>
  );
}

export default function Header({ connection, unrealized, realized }: HeaderProps) {
  const live = connection === "live";

  return (
    <div className={styles.header}>
      <span className={styles.brandLockup}>
        <Logo size={20} />
        <span className={styles.brand}>Jev Trade</span>
      </span>
      <span className={styles.status} data-live={live ? "true" : "false"}>
        <span className={styles.dot} aria-hidden="true" />
        <span>{live ? "Live" : "Offline"}</span>
      </span>
      <span className={styles.spacer} />
      <Score label="unrealized" value={unrealized} />
      <Score label="realized" value={realized} />
    </div>
  );
}
