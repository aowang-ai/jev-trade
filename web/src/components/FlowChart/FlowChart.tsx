"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { BlockEvent, Meta, PricePoint } from "@/lib/types";
import { fmtAxisTime, fmtClock, fmtCoin, fmtConf, fmtPosition, fmtPrice, fmtSigned, fmtSignedUsd } from "@/lib/format";
import { smoothPath } from "./smooth";
import styles from "./FlowChart.module.css";

const PAD_TOP = 84;
const PAD_BOTTOM = 36;
const PAD_LEFT = 16;
const PAD_RIGHT = 78;
const MIN_RANGE_PCT = 0.002;
const TAG_W = 58;
const LINE_POINTS = 720;
const MIN_SPAN_MS = 8_000;

type View = { start: number; end: number; follow: boolean };

function lttb(pts: PricePoint[], n: number): PricePoint[] {
  const len = pts.length;
  if (len <= n) return pts;
  const sampled: PricePoint[] = [pts[0]!];
  const bucketSize = (len - 2) / (n - 2);
  let a = 0;
  for (let i = 0; i < n - 2; i++) {
    const start = Math.floor((i + 1) * bucketSize) + 1;
    const end = Math.min(Math.floor((i + 2) * bucketSize) + 1, len - 1);
    let avgX = 0;
    let avgY = 0;
    let count = 0;
    const nextStart = Math.floor((i + 2) * bucketSize) + 1;
    const nextEnd = Math.min(Math.floor((i + 3) * bucketSize) + 1, len);
    for (let j = nextStart; j < nextEnd; j++) {
      avgX += pts[j]!.ts;
      avgY += pts[j]!.mid;
      count++;
    }
    avgX /= count || 1;
    avgY /= count || 1;
    const pointA = pts[a]!;
    let maxArea = -1;
    let nextA = start;
    for (let j = start; j < end; j++) {
      const area = Math.abs(
        (pointA.ts - avgX) * (pts[j]!.mid - pointA.mid) - (pointA.ts - pts[j]!.ts) * (avgY - pointA.mid),
      );
      if (area > maxArea) {
        maxArea = area;
        nextA = j;
      }
    }
    sampled.push(pts[nextA]!);
    a = nextA;
  }
  sampled.push(pts[len - 1]!);
  return sampled;
}

function nearest(pts: PricePoint[], ts: number): PricePoint | null {
  if (!pts.length) return null;
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.ts < ts) lo = mid + 1;
    else hi = mid;
  }
  const a = pts[lo]!;
  const b = pts[lo - 1];
  if (!b) return a;
  return Math.abs(a.ts - ts) <= Math.abs(b.ts - ts) ? a : b;
}

function lowerBound(pts: PricePoint[], ts: number): number {
  let lo = 0;
  let hi = pts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.ts < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function windowSlice(pts: PricePoint[], start: number, end: number): PricePoint[] {
  if (!pts.length) return pts;
  const i0 = Math.max(0, lowerBound(pts, start) - 1);
  let i1 = lowerBound(pts, end);
  if (i1 < pts.length && pts[i1]!.ts <= end) i1 += 1;
  return pts.slice(i0, Math.min(pts.length, i1 + 1));
}

function clampWindow(start: number, end: number, first: number, last: number): { start: number; end: number; follow: boolean } {
  const full = Math.max(1, last - first);
  const minSpan = Math.min(full, MIN_SPAN_MS);
  let span = Math.min(full, Math.max(minSpan, end - start));
  let s = start;
  let e = s + span;
  if (e > last) {
    e = last;
    s = Math.max(first, e - span);
  }
  if (s < first) {
    s = first;
    e = Math.min(last, s + span);
  }
  return { start: s, end: e, follow: e >= last - 1 };
}

function markPath(x: number, y: number, side: "buy" | "sell"): string {
  const s = 5.5;
  return side === "buy"
    ? `M${x} ${y - s} L${x - s} ${y + s * 0.7} L${x + s} ${y + s * 0.7} Z`
    : `M${x} ${y + s} L${x - s} ${y - s * 0.7} L${x + s} ${y - s * 0.7} Z`;
}

function xFromEvent(ev: { clientX: number }, el: HTMLElement, plotW: number): number {
  const r = el.getBoundingClientRect();
  return Math.min(Math.max(ev.clientX - r.left - PAD_LEFT, 0), plotW);
}

export default function FlowChart({
  tape = [],
  events,
  latest,
  meta,
}: {
  tape?: PricePoint[];
  events: BlockEvent[];
  latest: BlockEvent | null;
  meta?: Meta | null;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<number | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [dragging, setDragging] = useState(false);
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const dragRef = useRef<{ x: number; start: number; end: number } | null>(null);
  const pinchRef = useRef<{ dist: number; start: number; end: number; anchor: number } | null>(null);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize((s) =>
        Math.abs(s.w - r.width) < 0.5 && Math.abs(s.h - r.height) < 0.5
          ? s
          : { w: Math.round(r.width), h: Math.round(r.height) },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;

  const series = useMemo(() => {
    const src = (tape ?? []).length
      ? tape
      : (events ?? []).map((e) => ({
          ts: e.ts,
          mid: e.mid,
          block: e.block,
          fill: e.fill ? { side: e.fill.side, price: e.fill.price, size: e.fill.size } : undefined,
        }));
    if (!src.length) return src;
    const last = src[src.length - 1]!;
    if (latest && latest.ts > last.ts) {
      return [...src, { ts: latest.ts, mid: latest.mid, block: latest.block }];
    }
    if (latest && last.ts === latest.ts && last.mid !== latest.mid) {
      const next = src.slice();
      next[next.length - 1] = { ...last, mid: latest.mid };
      return next;
    }
    return src;
  }, [tape, events, latest]);

  const bounds = useMemo(() => {
    if (!series.length) return null;
    const first = series[0]!.ts;
    const last = series[series.length - 1]!.ts;
    return { first, last: Math.max(first + 1, last) };
  }, [series]);

  const resolved = useMemo(() => {
    if (!bounds) return null;
    if (!view) return { start: bounds.first, end: bounds.last, follow: true };
    if (view.follow) {
      const span = Math.max(MIN_SPAN_MS, view.end - view.start);
      const end = bounds.last;
      const start = Math.max(bounds.first, end - span);
      return { start, end, follow: true };
    }
    return clampWindow(view.start, view.end, bounds.first, bounds.last);
  }, [view, bounds]);

  const seriesRef = useRef(series);
  const resolvedRef = useRef(resolved);
  const boundsRef = useRef(bounds);
  seriesRef.current = series;
  resolvedRef.current = resolved;
  boundsRef.current = bounds;

  const applyWindow = (start: number, end: number) => {
    const b = boundsRef.current;
    if (!b) return;
    const next = clampWindow(start, end, b.first, b.last);
    if (next.end - next.start >= (b.last - b.first) * 0.995) {
      setView(null);
      return;
    }
    setView(next);
  };
  const applyRef = useRef(applyWindow);
  applyRef.current = applyWindow;

  const zoomAt = (clientX: number, factor: number) => {
    const el = panelRef.current;
    const v = resolvedRef.current;
    if (!el || !v) return;
    const plotW = Math.max(1, el.clientWidth - PAD_LEFT - PAD_RIGHT);
    const x = xFromEvent({ clientX }, el, plotW);
    const span = Math.max(1, v.end - v.start);
    const anchor = v.start + (x / plotW) * span;
    const nextSpan = span * factor;
    const left = (anchor - v.start) / span;
    applyRef.current(anchor - left * nextSpan, anchor - left * nextSpan + nextSpan);
  };

  const panBy = (frac: number) => {
    const v = resolvedRef.current;
    if (!v) return;
    const span = Math.max(1, v.end - v.start);
    applyRef.current(v.start + span * frac, v.end + span * frac);
  };

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const dy = ev.deltaY;
      if (!dy) return;
      zoomAt(ev.clientX, Math.exp(dy * 0.0018));
    };

    const onTouchMove = (ev: TouchEvent) => {
      if (ev.touches.length !== 2) return;
      ev.preventDefault();
      const v = resolvedRef.current;
      const pinch = pinchRef.current;
      if (!v || !pinch) return;
      const dist = Math.hypot(
        ev.touches[0]!.clientX - ev.touches[1]!.clientX,
        ev.touches[0]!.clientY - ev.touches[1]!.clientY,
      );
      if (dist < 8 || pinch.dist < 8) return;
      const span = Math.max(1, pinch.end - pinch.start);
      const nextSpan = span * (pinch.dist / dist);
      const left = (pinch.anchor - pinch.start) / span;
      applyRef.current(pinch.anchor - left * nextSpan, pinch.anchor - left * nextSpan + nextSpan);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  const model = useMemo(() => {
    const plotW = w - PAD_LEFT - PAD_RIGHT;
    const plotH = h - PAD_TOP - PAD_BOTTOM;
    if (w < 160 || plotH < 60 || plotW < 80) return null;
    if (!series.length || !resolved) return null;

    const t0 = resolved.start;
    const t1 = resolved.end;
    const flat = t1 <= t0;
    const span = Math.max(1, t1 - t0);
    const vis = windowSlice(series, t0, t1);
    if (!vis.length) return null;

    let lo = Infinity;
    let hi = -Infinity;
    let sum = 0;
    for (const p of vis) {
      if (p.ts < t0 - span * 0.02 || p.ts > t1 + span * 0.02) continue;
      if (p.mid < lo) lo = p.mid;
      if (p.mid > hi) hi = p.mid;
      if (p.fill) {
        if (p.fill.price < lo) lo = p.fill.price;
        if (p.fill.price > hi) hi = p.fill.price;
      }
      sum += p.mid;
    }
    if (!Number.isFinite(lo)) {
      lo = vis[0]!.mid;
      hi = vis[0]!.mid;
    }
    const mean = sum / vis.length || lo;
    const floor = Math.max(mean * MIN_RANGE_PCT, 1e-9);
    if (hi - lo < floor) {
      lo = mean - floor / 2;
      hi = mean + floor / 2;
    }
    const pad = (hi - lo) * 0.04;
    lo -= pad;
    hi += pad;
    const range = hi - lo || 1;
    const fx = (ts: number) => (flat ? PAD_LEFT + plotW : PAD_LEFT + ((ts - t0) / span) * plotW);
    const fy = (p: number) => PAD_TOP + (1 - (p - lo) / range) * plotH;

    const drawn = lttb(vis, LINE_POINTS);
    const pts = drawn.map((p) => [fx(p.ts), fy(p.mid)] as const);
    const line = smoothPath(pts);
    const base = h - PAD_BOTTOM;
    const area = pts.length
      ? `${line} L${pts[pts.length - 1]![0].toFixed(1)} ${base} L${pts[0]![0].toFixed(1)} ${base} Z`
      : "";

    const marks = vis
      .filter((p) => p.fill && p.ts >= t0 && p.ts <= t1)
      .map((p) => ({
        key: `${p.ts}-${p.fill!.side}-${p.fill!.price}`,
        x: fx(p.ts),
        y: fy(p.fill!.price),
        side: p.fill!.side,
        d: markPath(fx(p.ts), fy(p.fill!.price), p.fill!.side),
        fill: p.fill!.side === "buy" ? "var(--buy)" : "var(--sell)",
      }));

    const ticks = [0.25, 0.5, 0.75].map((f) => ({
      y: PAD_TOP + plotH * f,
      label: fmtPrice(lo + (1 - f) * range),
    }));

    const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const ts = t0 + f * span;
      return { x: fx(ts), label: fmtAxisTime(ts, span) };
    });

    const last = series[series.length - 1]!;
    const endX = fx(last.ts);
    const lastVisible = last.ts >= t0 && last.ts <= t1;

    return {
      line,
      area,
      marks,
      ticks,
      xTicks,
      fx,
      fy,
      last,
      base,
      t0,
      span,
      plotW,
      plotH,
      endY: fy(last.mid),
      endX,
      lastVisible,
    };
  }, [series, resolved, w, h]);

  const hv = useMemo(() => {
    if (!model || hover === null || dragging) return null;
    const p = nearest(series, hover);
    if (!p) return null;
    const x = model.fx(p.ts);
    if (x < PAD_LEFT - 8 || x > PAD_LEFT + model.plotW + 8) return null;
    const y = model.fy(p.mid);
    const flip = x > w - 180;
    const ty = Math.min(Math.max(y - 88, PAD_TOP - 40), model.base - 78);
    const coin = meta?.coin ?? "BTC";
      const kind =
        p.fill?.dir === "open" ? "OPEN" : p.fill?.dir === "close" ? "CLOSE" : p.fill?.dir === "flip" ? "FLIP" : "FILL";
      const trade = p.fill
      ? `${kind} ${p.fill.side === "buy" ? "BUY" : "SELL"} ${fmtCoin(p.fill.size, coin, 4)} @ ${fmtPrice(p.fill.price)}`
      : "mid";
    return {
      x,
      y,
      tx: flip ? x - 168 : x + 12,
      ty,
      time: fmtClock(p.ts, true),
      price: fmtPrice(p.mid),
      trade,
      tint: p.fill ? (p.fill.side === "buy" ? "var(--buy-ink)" : "var(--sell-ink)") : "var(--muted)",
    };
  }, [model, hover, series, w, meta?.coin, dragging]);

  const shown = latest ?? events[events.length - 1] ?? null;
  const d = shown?.decision ?? null;
  const late = d?.late === true;
  const act = late ? "late" : (d?.action ?? "hold");
  const word =
    act === "buy" ? "Buying" : act === "sell" ? "Selling" : act === "late" ? "Missed the tick" : "Holding";
  const wordColor =
    act === "buy"
      ? "var(--buy-ink)"
      : act === "sell"
        ? "var(--sell-ink)"
        : act === "late"
          ? "var(--late-ink)"
          : "var(--ink)";
  const conf = d ? Math.max(d.probabilities.buy, d.probabilities.sell, d.probabilities.hold) : 0;
  const pos = shown?.position;
  const stance = fmtPosition(pos, meta?.coin ?? "BTC");
  const posPnl = pos?.unrealizedUsd ?? 0;
  const pnlUsd = shown?.totals?.pnlUsd ?? 0;
  const pnlPct = shown?.totals?.pnlPct ?? 0;
  const spanLabel = resolved
    ? `${fmtAxisTime(resolved.start, resolved.end - resolved.start)} to ${fmtAxisTime(resolved.end, resolved.end - resolved.start)}`
    : "all time";
  const allTime = view === null;

  return (
    <div className={styles.wrap}>
      <div
        ref={panelRef}
        className={`${styles.panel} ${dragging ? styles.dragging : ""}`}
        role="application"
        tabIndex={0}
        aria-label="Price chart. Scroll to zoom. Drag to move. Double click for all time."
        title="Scroll to zoom. Drag to move. Double click for all time."
        data-range={resolved ? `${Math.round(resolved.start)}:${Math.round(resolved.end)}` : ""}
        onWheel={(ev) => {
          zoomAt(ev.clientX, Math.exp(ev.deltaY * 0.0018));
        }}
        onKeyDown={(ev) => {
          if (ev.key === "+" || ev.key === "=") {
            ev.preventDefault();
            const r = ev.currentTarget.getBoundingClientRect();
            zoomAt(r.left + r.width * 0.7, 0.82);
          } else if (ev.key === "-" || ev.key === "_") {
            ev.preventDefault();
            const r = ev.currentTarget.getBoundingClientRect();
            zoomAt(r.left + r.width * 0.7, 1.22);
          } else if (ev.key === "ArrowLeft") {
            ev.preventDefault();
            panBy(-0.2);
          } else if (ev.key === "ArrowRight") {
            ev.preventDefault();
            panBy(0.2);
          } else if (ev.key === "0" || ev.key === "Escape") {
            ev.preventDefault();
            setView(null);
          }
        }}
        onPointerDown={(ev) => {
          if (ev.button !== 0 || !resolved) return;
          if ((ev.target as HTMLElement).closest("button")) return;
          ev.currentTarget.setPointerCapture(ev.pointerId);
          dragRef.current = { x: ev.clientX, start: resolved.start, end: resolved.end };
          setDragging(true);
          setHover(null);
        }}
        onPointerMove={(ev) => {
          if (dragRef.current) {
            const plotW = Math.max(1, w - PAD_LEFT - PAD_RIGHT);
            const span = Math.max(1, dragRef.current.end - dragRef.current.start);
            const dt = -((ev.clientX - dragRef.current.x) / plotW) * span;
            applyWindow(dragRef.current.start + dt, dragRef.current.end + dt);
            return;
          }
          if (ev.pointerType !== "mouse" || !model) return;
          const r = ev.currentTarget.getBoundingClientRect();
          const x = ev.clientX - r.left;
          setHover(model.t0 + ((x - PAD_LEFT) / Math.max(1, model.plotW)) * model.span);
        }}
        onPointerUp={(ev) => {
          if (dragRef.current) {
            dragRef.current = null;
            setDragging(false);
            try {
              ev.currentTarget.releasePointerCapture(ev.pointerId);
            } catch {
              /* already released */
            }
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
        onDoubleClick={(ev) => {
          if ((ev.target as HTMLElement).closest("button")) return;
          setView(null);
        }}
        onTouchStart={(ev) => {
          if (ev.touches.length !== 2 || !resolved || !panelRef.current) return;
          const plotW = Math.max(1, w - PAD_LEFT - PAD_RIGHT);
          const midX =
            (ev.touches[0]!.clientX + ev.touches[1]!.clientX) / 2;
          const x = xFromEvent({ clientX: midX }, panelRef.current, plotW);
          pinchRef.current = {
            dist: Math.hypot(
              ev.touches[0]!.clientX - ev.touches[1]!.clientX,
              ev.touches[0]!.clientY - ev.touches[1]!.clientY,
            ),
            start: resolved.start,
            end: resolved.end,
            anchor: resolved.start + (x / plotW) * Math.max(1, resolved.end - resolved.start),
          };
          setHover(null);
        }}
        onTouchEnd={() => {
          pinchRef.current = null;
        }}
      >
        {!model ? (
          <div className={styles.empty}>waiting for prices</div>
        ) : (
          <>
            <svg className={styles.svg} viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="Chart surface">
              <defs>
                <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(10,10,10,0.07)" />
                  <stop offset="100%" stopColor="rgba(10,10,10,0)" />
                </linearGradient>
                <clipPath id={`c${gid}`}>
                  <rect x={PAD_LEFT} y={PAD_TOP - 4} width={model.plotW} height={model.plotH + 8} />
                </clipPath>
              </defs>

              {model.ticks.map((t) => (
                <line key={t.y} className={styles.grid} x1="0" x2={w} y1={t.y} y2={t.y} />
              ))}

              <g clipPath={`url(#c${gid})`}>
                <path d={model.area} fill={`url(#g${gid})`} />
                <path className={styles.line} d={model.line} />
                {model.marks.map((m) => (
                  <path key={m.key} className={styles.mark} d={m.d} fill={m.fill} />
                ))}
              </g>

              {hv ? (
                <g>
                  <line className={styles.cross} x1={hv.x} x2={hv.x} y1={PAD_TOP - 12} y2={model.base + 10} />
                  <circle className={styles.crossDot} cx={hv.x} cy={hv.y} r="4.5" />
                  <g transform={`translate(${hv.tx.toFixed(1)},${hv.ty.toFixed(1)})`}>
                    <rect className={styles.tip} width="156" height="72" rx="10" />
                    <text className={styles.tipBlock} x="12" y="20">{hv.time}</text>
                    <text className={styles.tipPrice} x="12" y="40">{hv.price}</text>
                    <text className={styles.tipSide} x="12" y="58" fill={hv.tint}>{hv.trade}</text>
                  </g>
                </g>
              ) : null}

              {model.ticks.map((t) => (
                <text key={`l${t.y}`} className={styles.tick} x={w - 8} y={t.y - 5} textAnchor="end">
                  {t.label}
                </text>
              ))}

              {model.xTicks.map((t) => (
                <text
                  key={`x${t.x}`}
                  className={styles.tick}
                  x={t.x}
                  y={h - 10}
                  textAnchor={t.x < PAD_LEFT + 20 ? "start" : t.x > w - PAD_RIGHT - 10 ? "end" : "middle"}
                >
                  {t.label}
                </text>
              ))}

              {model.lastVisible ? (
                <g className={styles.tag} style={{ transform: `translate(${model.endX.toFixed(1)}px, ${model.endY.toFixed(1)}px)` }}>
                  <circle cx="0" cy="0" r="4" fill="var(--ink)" />
                  <rect x="10" y="-10" width={TAG_W} height="20" rx="999" fill="var(--ink)" />
                  <text className={styles.tagText} x={10 + TAG_W / 2} y="4" textAnchor="middle">
                    {fmtPrice(model.last.mid)}
                  </text>
                </g>
              ) : null}
            </svg>

            <div className={styles.tl}>
              <div className={styles.price}>{fmtPrice(shown?.mid ?? model.last.mid)}</div>
              <div className={styles.sub}>
                <span>{meta?.pair ?? "BTC-USD"}</span>
                <span>Hyperliquid</span>
                <span>{spanLabel}</span>
                <span>{stance}</span>
                {pos && pos.side !== "flat" ? (
                  <span style={{ color: posPnl >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)" }}>
                    pos {fmtSignedUsd(posPnl)}
                  </span>
                ) : null}
                <span style={{ color: pnlUsd >= 0 ? "var(--pnl-pos)" : "var(--pnl-neg)" }}>
                  p&amp;l {fmtSignedUsd(pnlUsd)} ({fmtSigned(pnlPct, 2)}%)
                </span>
              </div>
            </div>

            <div className={styles.tr}>
              <div className={styles.word} style={{ color: wordColor }}>
                {word}
              </div>
              <div className={styles.sub}>
                <span>{!d || late ? "late" : `${Math.round(d.latencyMs)} ms`}</span>
                <span>conf {fmtConf(conf)}</span>
              </div>
            </div>

            <div className={styles.tools}>
              <button
                type="button"
                className={styles.tool}
                aria-label="Zoom in"
                onClick={() => {
                  const el = panelRef.current;
                  if (!el) return;
                  const r = el.getBoundingClientRect();
                  zoomAt(r.left + r.width * 0.72, 0.72);
                }}
              >
                +
              </button>
              <button
                type="button"
                className={styles.tool}
                aria-label="Zoom out"
                onClick={() => {
                  const el = panelRef.current;
                  if (!el) return;
                  const r = el.getBoundingClientRect();
                  zoomAt(r.left + r.width * 0.72, 1.38);
                }}
              >
                -
              </button>
              {!allTime ? (
                <button type="button" className={styles.tool} onClick={() => setView(null)}>
                  all time
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
