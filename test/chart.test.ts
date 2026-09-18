import { expect, test } from "bun:test";
import { CHART_LOOKBACK_MS, VenueChart, candleMid, fillKey } from "../src/chart";

test("chart lookback is a week", () => {
  expect(CHART_LOOKBACK_MS).toBe(7 * 24 * 60 * 60 * 1000);
});

test("candleMid rejects junk", () => {
  expect(candleMid({})).toBeNull();
  expect(candleMid({ t: 1, c: 0 })).toBeNull();
  expect(candleMid({ t: 1000, c: "77000" })).toEqual({ ts: 1000, mid: 77000 });
});

test("VenueChart line is candle closes and marks are venue fills", () => {
  const chart = new VenueChart();
  chart.upsertCandle({ t: 1000, c: "100" });
  chart.upsertCandle({ t: 2000, c: "102" });
  chart.upsertCandle({ t: 1000, c: "101" });
  expect(chart.addFill({ ts: 1500, side: "buy", price: 100.5, size: 0.01, dir: "open", hash: "0xabc" })).toBe(true);
  expect(chart.addFill({ ts: 1500, side: "buy", price: 100.5, size: 0.01, dir: "open" })).toBe(false);
  const pts = chart.points;
  expect(pts.map((p) => [p.ts, p.mid, p.fill?.side, p.fill?.hash])).toEqual([
    [1000, 101, undefined, undefined],
    [1500, 100.5, "buy", "0xabc"],
    [2000, 102, undefined, undefined],
  ]);
  expect(fillKey({ ts: 1, side: "sell", price: 2, size: 3 })).toBe("1|sell|2|3");
  expect(chart.closes(2)).toEqual([101, 102]);
});
