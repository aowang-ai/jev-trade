import { expect, test } from "bun:test";
import { aggregateFills, takeSimFills, type Resting } from "../src/trades";

test("takeSimFills hits a resting bid when a sell print crosses", () => {
  const orders = new Map<number, Resting>([[1, { side: "buy", price: 100, size: 0.002, block: 1 }]]);
  const fills = takeSimFills(orders, [{ block: 2, price: 99.9, size: 0.001, side: "sell" }]);
  expect(fills).toHaveLength(1);
  expect(fills[0]!.side).toBe("buy");
  expect(fills[0]!.size).toBeCloseTo(0.001, 8);
  expect(orders.get(1)!.size).toBeCloseTo(0.001, 8);
});

test("takeSimFills ignores prints before the quote tick", () => {
  const orders = new Map<number, Resting>([[1, { side: "sell", price: 100, size: 0.001, block: 5 }]]);
  expect(takeSimFills(orders, [{ block: 4, price: 101, size: 1, side: "buy" }])).toHaveLength(0);
});

test("aggregateFills keeps the heavier side", () => {
  const fill = aggregateFills([
    { side: "buy", size: 0.001, price: 10, txHash: "0x1", orderId: 1, simulated: true },
    { side: "sell", size: 0.003, price: 11, txHash: "0x2", orderId: 2, simulated: true },
  ]);
  expect(fill.side).toBe("sell");
  expect(fill.size).toBeCloseTo(0.003, 8);
  expect(fill.price).toBe(11);
});
