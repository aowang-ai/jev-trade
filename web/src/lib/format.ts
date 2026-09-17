/** Formatting helpers. All are pure and SSR-safe. */

const INT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function safe(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** 105416201 -> "105,416,201" */
export function fmtInt(n: number | null | undefined): string {
  return INT.format(Math.round(safe(n)));
}

/** `xyz:NVDA` -> `NVDA`. */
export function displayCoin(coin: string | null | undefined): string {
  if (!coin) return "BTC";
  const i = coin.indexOf(":");
  return i >= 0 ? coin.slice(i + 1) : coin;
}

/** Price with decimals that fit BTC (~1) and ETH (~2). */
export function fmtPrice(n: number | null | undefined): string {
  const v = safe(n);
  if (v >= 10000) return v.toFixed(1);
  if (v >= 100) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4);
  return v.toFixed(6);
}

/** 0.0045 -> "$0.0045"; negatives -> "-$0.0045" */
export function fmtUsd(n: number | null | undefined, d = 4): string {
  const v = safe(n);
  return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(d)}`;
}

/** 0.0045 -> "+$0.0045"; negatives -> "-$0.0045" */
export function fmtSignedUsd(n: number | null | undefined, d = 4): string {
  const v = safe(n);
  return `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(d)}`;
}

export function fmtCoin(n: number | null | undefined, coin = "BTC", d = 3): string {
  return `${safe(n).toFixed(d)} ${displayCoin(coin)}`;
}

/** "short 0.0067 BTC 3x @ 76627.7" */
export function fmtPosition(
  pos: { side: string; size: number; entryPrice: number | null; leverage?: number | null } | null | undefined,
  coin = "BTC",
): string {
  const label = displayCoin(coin);
  if (!pos || pos.side === "flat") {
    return pos?.leverage != null ? `flat ${pos.leverage}x` : "flat";
  }
  const lev = pos.leverage != null ? ` ${pos.leverage}x` : "";
  const entry = pos.entryPrice != null ? ` @ ${fmtPrice(pos.entryPrice)}` : "";
  return `${pos.side} ${fmtCoin(pos.size, label, 4)}${lev}${entry}`;
}

/** "OPEN LONG" */
export function fmtCall(d: {
  action?: string;
  intent?: string;
  bias?: string;
  leverage?: number | null;
} | null | undefined): string {
  if (!d) return "";
  let word = "";
  if (d.intent && d.bias) word = `${d.intent} ${d.bias}`.toUpperCase();
  else if (d.action && d.action !== "hold") word = d.action.toUpperCase();
  if (!word) return "";
  return d.leverage != null ? `${word} ${d.leverage}x` : word;
}

/** Newest non-late call, so a LATE tick does not wipe the last real pick. */
export function lastMeaningfulCall(
  events: { decision: { late: boolean; action?: string; intent?: string; bias?: string; leverage?: number | null } | null }[],
  latest?: { decision: { late: boolean; action?: string; intent?: string; bias?: string; leverage?: number | null } | null } | null,
): string {
  const tail = latest ? [...events, latest] : events;
  for (let i = tail.length - 1; i >= 0; i--) {
    const d = tail[i]?.decision;
    if (!d || d.late) continue;
    const call = fmtCall(d);
    if (call) return call;
  }
  return "";
}

/** 0.62 -> "62%" */
export function fmtPct(p: number | null | undefined): string {
  return `${Math.round(safe(p) * 100)}%`;
}

/** 0.62 -> "0.62" (two-decimal confidence) */
export function fmtConf(p: number | null | undefined): string {
  return safe(p).toFixed(2);
}

/** Signed number with a forced +/- sign: (0.003, 3) -> "+0.003" */
export function fmtSigned(n: number | null | undefined, d = 3): string {
  const v = safe(n);
  return `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(d)}`;
}

/** Clock from ms epoch. `withSeconds` adds :ss. */
export function fmtClock(ts: number | null | undefined, withSeconds = false): string {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return withSeconds ? "--:--:--" : "--:--";
  const d = new Date(ts);
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return withSeconds ? `${hh}:${mm}:${pad(d.getSeconds())}` : `${hh}:${mm}`;
}

/** Axis label: clock, or date plus clock when the span is longer than a day. */
export function fmtAxisTime(ts: number | null | undefined, spanMs: number): string {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "--:--";
  const d = new Date(ts);
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (spanMs < 90_000) return `${clock}:${pad(d.getSeconds())}`;
  if (spanMs >= 36 * 3_600_000) return `${d.getMonth() + 1}/${d.getDate()} ${clock}`;
  return clock;
}

/** Accepts ms- or seconds-epoch. Elapsed since `startedAt` as "04:13:42". */
export function uptime(startedAt: number | null | undefined, now: number = Date.now()): string {
  if (!startedAt || !Number.isFinite(startedAt)) return "00:00:00";
  const startMs = startedAt < 1e12 ? startedAt * 1000 : startedAt;
  return hhmmss(Math.max(0, now - startMs));
}

function hhmmss(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "0x7F3a...9C4e" */
export function shortAddr(a: string | null | undefined): string {
  if (!a) return "";
  return a.length <= 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** "0x8f2c..." */
export function shortTx(h: string | null | undefined): string {
  if (!h) return "";
  return h.length <= 6 ? h : `${h.slice(0, 6)}…`;
}

export function txUrl(h: string, explorerTx?: string): string {
  if (explorerTx) return `${explorerTx}${h}`;
  return `https://app.hyperliquid.xyz/explorer/tx/${h}`;
}
