import { expect, test } from "bun:test";
import { tapeFills } from "../web/src/lib/fills";

test("tapeFills reads venue marks off the mid series and skips empty prints", () => {
  const rows = tapeFills([
    { ts: 1000, mid: 100 },
    { ts: 1500, mid: 100.5, fill: { side: "buy", price: 100.5, size: 0.01, dir: "open", hash: "0xabc" } },
    { ts: 2000, mid: 102, fill: { side: "sell", price: 102, size: 0 } },
    { ts: 2500, mid: 101, fill: { side: "sell", price: 101, size: 0.02, dir: "close" } },
  ]);
  expect(rows).toEqual([
    { key: "1500|buy|100.5|0.01|open|0xabc", ts: 1500, side: "buy", price: 100.5, size: 0.01, dir: "open", hash: "0xabc" },
    { key: "2500|sell|101|0.02|close|", ts: 2500, side: "sell", price: 101, size: 0.02, dir: "close", hash: undefined },
  ]);
});
