import { expect, test } from "bun:test";

test("dashboard bot-types stays a copy of src/types.ts", async () => {
  const src = await Bun.file("src/types.ts").text();
  const copy = await Bun.file("web/src/lib/bot-types.ts").text();
  expect(copy).toBe(src);
});
