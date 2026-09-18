import { expect, test } from "bun:test";
import { CHART_LOOKBACK_MS, VenueChart, candleMid, candleOhlc, fillKey } from "../src/chart";

test("chart lookback is a week", () => {
  expect(CHART_LOOKBACK_MS).toBe(7 * 24 * 60 * 60 * 1000);
});

test("candleOhlc keeps the venue bar and fills missing sides from close", () => {
  expect(candleOhlc({})).toBeNull();
  expect(candleOhlc({ t: 1, c: 0 })).toBeNull();
  expect(candleOhlc({ t: 1000, c: "77000" })).toEqual({
    ts: 1000, open: 77000, high: 77000, low: 77000, close: 77000,
  });
  expect(candleOhlc({ t: 1000, o: "10", h: "12", l: "9", c: "11" })).toEqual({
    ts: 1000, open: 10, high: 12, low: 9, close: 11,
  });
  expect(candleMid({ t: 1000, c: "77000" })).toEqual({ ts: 1000, mid: 77000 });
});

test("VenueChart keeps 1m and 15m candles plus venue fills", () => {
  const chart = new VenueChart();
  chart.upsertCandle({ t: 1000, o: "100", h: "101", l: "99", c: "101", i: "1m" });
  chart.upsertCandle({ t: 2000, o: "101", h: "103", l: "100", c: "102", i: "1m" });
  chart.upsertCandle({ t: 1000, o: "100", h: "102", l: "99", c: "101", i: "1m" });
  chart.upsertCandle({ t: 15, o: "90", h: "110", l: "80", c: "100", i: "15m" });
  expect(chart.addFill({ ts: 1500, side: "buy", price: 100.5, size: 0.01, dir: "open", hash: "0xabc" })).toBe(true);
  expect(chart.addFill({ ts: 1500, side: "buy", price: 100.5, size: 0.01, dir: "open" })).toBe(false);
  const pts = chart.points;
  expect(pts.map((p) => [p.ts, p.bar, p.close ?? p.mid, p.fill?.side, p.fill?.hash])).toEqual([
    [15, "15m", 100, undefined, undefined],
    [1000, "1m", 101, undefined, undefined],
    [1500, undefined, 100.5, "buy", "0xabc"],
    [2000, "1m", 102, undefined, undefined],
  ]);
  expect(pts[1]).toMatchObject({ open: 100, high: 102, low: 99, close: 101 });
  expect(fillKey({ ts: 1, side: "sell", price: 2, size: 3 })).toBe("1|sell|2|3");
  expect(chart.closes(2)).toEqual([101, 102]);
});

test("VenueChart emits every 15m, 1m and 1s bar even when they overlap", () => {
  const chart = new VenueChart();
  chart.upsertCandle({ t: 60_000, o: "90", h: "110", l: "80", c: "100", i: "15m" });
  chart.upsertCandle({ t: 60_000, o: "100", h: "101", l: "99", c: "101", i: "1m" });
  chart.addMid(102, 61_000);
  const pts = chart.points;
  expect(pts.filter((p) => p.bar === "15m")).toHaveLength(1);
  expect(pts.filter((p) => p.bar === "1m")).toHaveLength(1);
  expect(pts.filter((p) => p.bar === "1s")).toHaveLength(1);
});

test("VenueChart addMid builds 1s candles from live mids", () => {
  const chart = new VenueChart();
  chart.addMid(100, 10_400);
  chart.addMid(102, 10_600);
  chart.addMid(99, 10_900);
  chart.addMid(101, 12_100);
  const sec = chart.points.filter((p) => p.bar === "1s");
  expect(sec).toHaveLength(2);
  expect(sec[0]).toMatchObject({ ts: 10_000, open: 100, high: 102, low: 99, close: 99, bar: "1s" });
  expect(sec[1]).toMatchObject({ ts: 12_000, open: 99, high: 101, low: 101, close: 101, bar: "1s" });
});
