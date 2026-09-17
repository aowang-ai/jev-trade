import { expect, test } from "bun:test";
import { parseAssetCtx, rsi, sma, snapshotIndicators, venueFeatures } from "../src/indicators";

test("sma and rsi on a rising series", () => {
  const xs = Array.from({ length: 20 }, (_, i) => 100 + i);
  expect(sma(xs, 5)).toBe(117);
  expect(rsi(xs, 14)).toBe(100);
});

test("snapshotIndicators sits mid-range on a flat tape", () => {
  const xs = Array.from({ length: 50 }, () => 100);
  const snap = snapshotIndicators(xs, 100);
  expect(snap.sma20).toBe(100);
  expect(snap.sma50).toBe(100);
  expect(snap.rsi14).toBe(50);
  expect(snap.rangePos20).toBe(0.5);
  expect(snap.midVsSma20Bps).toBe(0);
});

test("parseAssetCtx and venueFeatures read Hyperliquid ctx", () => {
  const ctx = parseAssetCtx({
    markPx: "77000",
    oraclePx: "76990",
    funding: "0.0001",
    premium: "0.0002",
    openInterest: "123.4",
    prevDayPx: "76000",
    dayNtlVlm: "1000000",
  });
  const v = venueFeatures(ctx, 77000);
  expect(v.markPx).toBe(77000);
  expect(v.fundingBps).toBeCloseTo(1, 8);
  expect(v.premiumBps).toBeCloseTo(2, 8);
  expect(v.dayChangeBps).toBeCloseTo(((77000 - 76000) / 76000) * 10_000, 6);
});
