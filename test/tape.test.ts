import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendTape, loadTape, markTapeFill, stampFills, TAPE_MAX } from "../src/tape";

test("loadTape skips junk and non-positive mids", () => {
  const dir = mkdtempSync(join(tmpdir(), "tape-"));
  const path = join(dir, "events.jsonl");
  writeFileSync(
    path,
    [
      "{",
      JSON.stringify({ ts: 1, mid: 0, block: 1 }),
      JSON.stringify({ ts: 2, mid: 76100, block: 2, fill: { side: "buy", price: 76090, size: 0.001 } }),
      JSON.stringify({ ts: 3, mid: 76110, block: 3 }),
      "",
    ].join("\n"),
  );
  const tape = loadTape(path);
  expect(tape).toHaveLength(2);
  expect(tape[0]!.fill).toBeUndefined();
  expect(tape[0]!.mid).toBe(76100);
  expect(tape[1]!.mid).toBe(76110);
});

test("markTapeFill writes onto matching ts then block", () => {
  const tape = [
    { ts: 1, mid: 1000, block: 1 },
    { ts: 2, mid: 1001, block: 2 },
  ];
  expect(markTapeFill(tape, { side: "sell", price: 1002, size: 0.001 }, { ts: 2 })).toBe(true);
  expect(tape[1]!.fill?.side).toBe("sell");
  markTapeFill(tape, { side: "buy", price: 999, size: 0.002 }, { block: 1 });
  expect(tape[0]!.fill?.side).toBe("buy");
});

test("markTapeFill inserts when ts misses the tape", () => {
  const tape = [
    { ts: 1000, mid: 1000, block: 1 },
    { ts: 2000, mid: 1002, block: 2 },
  ];
  expect(markTapeFill(tape, { side: "buy", price: 1010, size: 0.01, dir: "open" }, { ts: 9000, block: 99 })).toBe(true);
  expect(tape).toHaveLength(3);
  expect(tape[2]!.fill?.side).toBe("buy");
  expect(tape[2]!.ts).toBe(9000);
});

test("stampFills attaches to the nearest mid or inserts", () => {
  const tape = [
    { ts: 1000, mid: 76100 },
    { ts: 4000, mid: 76200 },
  ];
  stampFills(tape, [
    { ts: 1100, side: "buy", price: 76090, size: 0.001, dir: "open" },
    { ts: 9000, side: "sell", price: 76300, size: 0.002, dir: "close" },
  ]);
  expect(tape[0]!.fill?.side).toBe("buy");
  expect(tape[0]!.fill?.dir).toBe("open");
  expect(tape).toHaveLength(3);
  expect(tape[2]!.fill?.side).toBe("sell");
  expect(tape[2]!.fill?.dir).toBe("close");
  expect(tape[2]!.ts).toBe(9000);
});

test("appendTape drops the oldest once over cap", () => {
  const tape = [{ ts: 1, mid: 100 }];
  for (let i = 0; i < TAPE_MAX; i++) appendTape(tape, { ts: i + 2, mid: 100 + i });
  expect(tape).toHaveLength(TAPE_MAX);
  expect(tape[0]!.ts).toBe(2);
});
