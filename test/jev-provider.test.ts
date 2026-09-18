import { expect, test } from "bun:test";
import { assertJevCredentials, resolveJevModelId, resolveJevProvider } from "../src/config";

test("explicit JEV_PROVIDER wins over whichever key is set", () => {
  expect(resolveJevProvider({ JEV_PROVIDER: "gateway", TYPESAFE_API_KEY: "x" })).toBe("gateway");
  expect(resolveJevProvider({ JEV_PROVIDER: "typesafe", AI_GATEWAY_API_KEY: "x" })).toBe("typesafe");
});

test("unset provider prefers TypeSafe then Gateway", () => {
  expect(resolveJevProvider({ TYPESAFE_API_KEY: "x", AI_GATEWAY_API_KEY: "y" })).toBe("typesafe");
  expect(resolveJevProvider({ AI_GATEWAY_API_KEY: "y" })).toBe("gateway");
  expect(resolveJevProvider({})).toBe("typesafe");
});

test("invalid JEV_PROVIDER throws", () => {
  expect(() => resolveJevProvider({ JEV_PROVIDER: "openai" })).toThrow("typesafe or gateway");
});

test("model id defaults follow the provider", () => {
  expect(resolveJevModelId({}, "typesafe")).toBe("jev-latest");
  expect(resolveJevModelId({}, "gateway")).toBe("typesafe-ai/jev");
  expect(resolveJevModelId({ JEV_MODEL_ID: "jev-1.13.0" }, "gateway")).toBe("jev-1.13.0");
  expect(resolveJevModelId({ JEV_MODEL_ID: "  " }, "typesafe")).toBe("jev-latest");
});

test("jev refuses to start without the key for the chosen provider", () => {
  expect(() => assertJevCredentials("jev", "typesafe", {})).toThrow("TYPESAFE_API_KEY");
  expect(() => assertJevCredentials("jev", "gateway", {})).toThrow("AI_GATEWAY_API_KEY");
  expect(() => assertJevCredentials("mock", "typesafe", {})).not.toThrow();
  expect(() => assertJevCredentials("jev", "typesafe", { TYPESAFE_API_KEY: "x" })).not.toThrow();
});
