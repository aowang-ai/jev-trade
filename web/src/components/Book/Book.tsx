"use client";

import { useMemo, useState } from "react";
import type { BlockEvent, Meta, PricePoint, SleeveMeta } from "@/lib/types";
import { tapeFills } from "@/lib/fills";
import { roePct } from "@/lib/pnl";
import { displayCoin, fmtClock, fmtCoin, fmtPct, fmtPrice, fmtSignedUsd, shortTx, txUrl } from "@/lib/format";
import styles from "./Book.module.css";

type Tab = "positions" | "trades";

const TRADE_CAP = 200;

function fmtSize(size: number): string {
  if (size > 0 && size < 0.01) {
    return size.toLocaleString("en-US", { maximumFractionDigits: 5, minimumFractionDigits: 3 });
  }
  return size.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export default function Book({
  sleeves,
  latestByCoin,
  tapeByCoin,
  selected,
  meta,
  onSelect,
  onNeedMoreTape,
}: {
  sleeves: SleeveMeta[];
  latestByCoin: Record<string, BlockEvent | null>;
  tapeByCoin: Record<string, PricePoint[]>;
  selected: string;
  meta?: Meta | null;
  onSelect: (coin: string) => void;
  onNeedMoreTape?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("positions");
  const [allMarkets, setAllMarkets] = useState(false);

  const trades = useMemo(() => {
    const rows = [];
    for (const sleeve of sleeves) {
      if (!allMarkets && sleeve.coin !== selected) continue;
      for (const fill of tapeFills(tapeByCoin[sleeve.coin] ?? [])) {
        rows.push({ ...fill, coin: sleeve.coin });
      }
    }
    rows.sort((a, b) => b.ts - a.ts);
    return rows.slice(0, TRADE_CAP);
  }, [allMarkets, selected, sleeves, tapeByCoin]);

  return (
    <section className={styles.wrap}>
      <div className={styles.tabs} role="tablist" aria-label="Account book">
        <button
          type="button"
          className={tab === "positions" ? styles.tabOn : styles.tab}
          role="tab"
          aria-selected={tab === "positions"}
          onClick={() => setTab("positions")}
        >
          Positions
        </button>
        <button
          type="button"
          className={tab === "trades" ? styles.tabOn : styles.tab}
          role="tab"
          aria-selected={tab === "trades"}
          onClick={() => {
            setTab("trades");
            onNeedMoreTape?.();
          }}
        >
          Trades
        </button>
        {tab === "trades" ? (
          <span className={styles.scope}>
            <button
              type="button"
              className={allMarkets ? styles.scopeBtn : styles.scopeOn}
              onClick={() => setAllMarkets(false)}
            >
              {displayCoin(selected)}
            </button>
            <button
              type="button"
              className={allMarkets ? styles.scopeOn : styles.scopeBtn}
              onClick={() => setAllMarkets(true)}
            >
              All
            </button>
          </span>
        ) : null}
      </div>
      {tab === "positions" ? (
        <div className={styles.scroller}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Market</th>
                <th>Side</th>
                <th>Size</th>
                <th>Entry</th>
                <th>Mark</th>
                <th>Value</th>
                <th>Unrealized</th>
                <th>ROE</th>
                <th>Lev</th>
              </tr>
            </thead>
            <tbody>
              {sleeves.map((sleeve) => {
                const latest = latestByCoin[sleeve.coin] ?? null;
                const pos = latest?.position;
                const open = Boolean(pos && pos.side !== "flat" && pos.size > 0);
                const mark = latest?.mid ?? null;
                const value = open && mark != null ? pos!.size * mark : null;
                const u = open ? pos!.unrealizedUsd : 0;
                const roe = roePct(pos);
                const side = (pos?.side ?? "flat").toUpperCase();
                const sideColor =
                  pos?.side === "long" ? "var(--buy-ink)" : pos?.side === "short" ? "var(--sell-ink)" : undefined;
                const pnlColor = open ? (u >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)") : undefined;
                const on = sleeve.coin === selected;
                return (
                  <tr
                    key={sleeve.coin}
                    className={on ? styles.rowOn : undefined}
                    onClick={() => onSelect(sleeve.coin)}
                  >
                    <td>{displayCoin(sleeve.coin)}</td>
                    <td style={sideColor ? { color: sideColor } : undefined}>{side}</td>
                    <td>{open ? fmtCoin(pos!.size, sleeve.coin, 4) : "-"}</td>
                    <td>{open && pos?.entryPrice != null ? fmtPrice(pos.entryPrice) : "-"}</td>
                    <td>{mark != null ? fmtPrice(mark) : "-"}</td>
                    <td>{value != null ? fmtPrice(value) : "-"}</td>
                    <td style={pnlColor ? { color: pnlColor } : undefined}>
                      {open ? fmtSignedUsd(u, 2) : "-"}
                    </td>
                    <td style={pnlColor ? { color: pnlColor } : undefined}>
                      {roe != null ? fmtPct(roe) : "-"}
                    </td>
                    <td>{pos?.leverage != null ? `${pos.leverage}x` : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : trades.length === 0 ? (
        <div className={styles.empty}>no trades yet</div>
      ) : (
        <div className={styles.scroller}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Market</th>
                <th>Side</th>
                <th>Action</th>
                <th>Price</th>
                <th>Size</th>
                <th>Tx</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((fill) => {
                const sideColor = fill.side === "buy" ? "var(--buy-ink)" : "var(--sell-ink)";
                const action = fill.dir === "open" ? "OPEN" : fill.dir === "close" ? "CLOSE" : fill.dir === "flip" ? "FLIP" : "FILL";
                return (
                  <tr key={`${fill.coin}|${fill.key}`} onClick={() => onSelect(fill.coin)}>
                    <td>{fmtClock(fill.ts, true)}</td>
                    <td>{displayCoin(fill.coin)}</td>
                    <td style={{ color: sideColor }}>{fill.side.toUpperCase()}</td>
                    <td style={{ color: sideColor }}>{action}</td>
                    <td>{fmtPrice(fill.price)}</td>
                    <td>{fmtSize(fill.size)}</td>
                    <td>
                      {fill.hash ? (
                        <a href={txUrl(fill.hash, meta?.explorerTx)} target="_blank" rel="noreferrer">
                          {shortTx(fill.hash)}
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
