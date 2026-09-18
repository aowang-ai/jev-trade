const env = (key: string, fallback?: string) => process.env[key] ?? fallback;

export type JevProvider = "typesafe" | "gateway";

export function resolveJevProvider(e: {
  JEV_PROVIDER?: string;
  TYPESAFE_API_KEY?: string;
  AI_GATEWAY_API_KEY?: string;
}): JevProvider {
  const explicit = e.JEV_PROVIDER?.trim().toLowerCase();
  if (explicit === "typesafe" || explicit === "gateway") return explicit;
  if (explicit) throw new Error("JEV_PROVIDER must be typesafe or gateway");
  if (e.TYPESAFE_API_KEY?.trim()) return "typesafe";
  if (e.AI_GATEWAY_API_KEY?.trim()) return "gateway";
  return "typesafe";
}

export function resolveJevModelId(e: { JEV_MODEL_ID?: string }, provider: JevProvider): string {
  const set = e.JEV_MODEL_ID?.trim();
  if (set) return set;
  return provider === "gateway" ? "typesafe-ai/jev" : "jev-latest";
}

export function assertJevCredentials(
  model: string,
  provider: JevProvider,
  e: { TYPESAFE_API_KEY?: string; AI_GATEWAY_API_KEY?: string },
): void {
  if (model !== "jev") return;
  if (provider === "typesafe" && !e.TYPESAFE_API_KEY?.trim()) {
    throw new Error("MODEL=jev with JEV_PROVIDER=typesafe needs TYPESAFE_API_KEY. Get a key at https://docs.typesafe.ai/ or set JEV_PROVIDER=gateway with AI_GATEWAY_API_KEY.");
  }
  if (provider === "gateway" && !e.AI_GATEWAY_API_KEY?.trim()) {
    throw new Error("MODEL=jev with JEV_PROVIDER=gateway needs AI_GATEWAY_API_KEY. Or set JEV_PROVIDER=typesafe with TYPESAFE_API_KEY.");
  }
}

const hlTestnet = env("HL_TESTNET", "true") !== "false";
const jevProvider = resolveJevProvider(process.env);
const jevModelId = resolveJevModelId(process.env, jevProvider);

export const config = {
  hlTestnet,
  tickMs: Number(env("TICK_MS", "2000")),
  /** Book/price prints for the chart. Independent of Jev ticks. */
  priceMs: Math.max(50, Number(env("PRICE_MS", "200"))),
  explorerTx: hlTestnet
    ? "https://app.hyperliquid-testnet.xyz/explorer/tx/"
    : "https://app.hyperliquid.xyz/explorer/tx/",
  privateKey: env("PRIVATE_KEY"),
  dryRun: env("DRY_RUN") === "true",
  /** Target notional of one post-only quote. */
  quoteUsd: Number(env("QUOTE_USD", "40")),
  quoteInsideTicks: Number(env("QUOTE_INSIDE_TICKS", "1")),
  /** How far an Ioc exit crosses the touch so it fills on the spot. */
  closeSlippageBps: Number(env("CLOSE_SLIPPAGE_BPS", "5")),
  horizonBlocks: Number(env("HORIZON_BLOCKS", "100")),
  model: env("MODEL", "mock") as "mock" | "jev",
  /** typesafe = official TypeSafe API. gateway = Vercel AI Gateway. */
  jevProvider,
  jevModelId,
  jevUsdPerMTok: 0.042,
  port: Number(env("PORT", "3000")),
  historySize: 1000,
  bankrollUsd: Number(env("BANKROLL_USD", "200")),
};

export function hexKey(key: string): `0x${string}` {
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}
