import { expect, test } from "bun:test";
import { mergeLiveTape, pushLive } from "../web/src/lib/live";

test("mergeLiveTape appends mids newer than the candle tape", () => {
  const tape = [{ ts: 1000, mid: 10 }, { ts: 2000, mid: 11 }];
  const live = [{ ts: 1500, mid: 10.5 }, { ts: 2500, mid: 12 }];
  expect(mergeLiveTape(tape, live)).toEqual([
    { ts: 1000, mid: 10 },
    { ts: 2000, mid: 11 },
    { ts: 2500, mid: 12 },
  ]);
});

test("pushLive caps and skips a duplicate last print", () => {
  const a = pushLive([], { ts: 1, mid: 10 });
  const b = pushLive(a, { ts: 1, mid: 10 });
  expect(b).toBe(a);
  const c = pushLive([{ ts: 1, mid: 10 }, { ts: 2, mid: 11 }], { ts: 3, mid: 12 }, 2);
  expect(c).toEqual([{ ts: 2, mid: 11 }, { ts: 3, mid: 12 }]);
});
