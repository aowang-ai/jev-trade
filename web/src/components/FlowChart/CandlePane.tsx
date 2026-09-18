"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, FillMark } from "@/lib/ohlc";

type Props = {
  candles: Candle[];
  marks: FillMark[];
  rangeKey: string;
  visibleBars: number;
  secondsVisible: boolean;
  formatPrice: (n: number) => string;
};

const UP = "#000000";
const DOWN = "#ffffff";
const BUY = "#00aa00";
const SELL = "#cc0000";

function asTime(sec: number): UTCTimestamp {
  return sec as UTCTimestamp;
}

function toBars(rows: Candle[]): CandlestickData<Time>[] {
  return rows.map((c) => ({
    time: asTime(c.time),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

function toMarkers(rows: FillMark[]): SeriesMarker<Time>[] {
  return rows.map((m) => ({
    time: asTime(m.time),
    position: m.side === "buy" ? "belowBar" : "aboveBar",
    shape: m.side === "buy" ? "arrowUp" : "arrowDown",
    color: m.side === "buy" ? BUY : SELL,
    size: 1.4,
  }));
}

function stemOf(rows: Candle[]): string {
  if (!rows.length) return "empty";
  return `${rows[0]!.time}`;
}

function showLatest(chart: IChartApi | null, count: number, visibleBars: number) {
  if (!chart || count <= 0) return;
  const to = count + 1;
  const from = Math.max(-1, to - visibleBars);
  chart.timeScale().setVisibleLogicalRange({ from, to });
}

export default function CandlePane({
  candles,
  marks,
  rangeKey,
  visibleBars,
  secondsVisible,
  formatPrice,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const stemRef = useRef("");
  const rangeRef = useRef("");
  const formatRef = useRef(formatPrice);
  formatRef.current = formatPrice;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const chart = createChart(el, {
      width: Math.max(1, el.clientWidth),
      height: Math.max(1, el.clientHeight),
      layout: {
        background: { type: ColorType.Solid, color: "#ffffff" },
        textColor: "#666666",
        fontFamily: "IBM Plex Mono, ui-monospace, monospace",
      },
      grid: {
        vertLines: { color: "#e5e5e5" },
        horzLines: { color: "#e5e5e5" },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#000000", scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: {
        borderColor: "#000000",
        timeVisible: true,
        secondsVisible,
        shiftVisibleRangeOnNewBar: true,
      },
      localization: { priceFormatter: (p: number) => formatRef.current(p) },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: UP,
      wickUpColor: UP,
      wickDownColor: UP,
    });
    const markers = createSeriesMarkers(series, []);
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      chart.resize(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
    });
    ro.observe(el);
    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = markers;
    return () => {
      ro.disconnect();
      markers.detach();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      stemRef.current = "";
      rangeRef.current = "";
    };
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions({ timeScale: { secondsVisible, timeVisible: true } });
  }, [secondsVisible]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const bars = toBars(candles);
    const stem = stemOf(candles);
    if (!bars.length) {
      series.setData([]);
      stemRef.current = stem;
      return;
    }
    const stemChanged = stemRef.current !== stem;
    if (!stemChanged && stem) {
      series.update(bars[bars.length - 1]!);
    } else {
      series.setData(bars);
      stemRef.current = stem;
    }
    if (rangeRef.current !== rangeKey || stemChanged) {
      rangeRef.current = rangeKey;
      showLatest(chartRef.current, bars.length, visibleBars);
    }
  }, [candles, rangeKey, visibleBars]);

  useEffect(() => {
    markersRef.current?.setMarkers(toMarkers(marks));
  }, [marks]);

  return <div ref={hostRef} className="lwc-host" style={{ position: "absolute", inset: 0 }} />;
}
