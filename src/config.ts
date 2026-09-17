const env = (key: string, fallback?: string) => process.env[key] ?? fallback;

const hlTestnet = env("HL_TESTNET", "true") !== "false";

export const config = {
  hlTestnet,
  hlLeverage: Number(env("HL_LEVERAGE", "3")),
  tickMs: Number(env("TICK_MS", "500")),
  explorerTx: hlTestnet
    ? "https://app.hyperliquid-testnet.xyz/explorer/tx/"
    : "https://app.hyperliquid.xyz/explorer/tx/",
  privateKey: env("PRIVATE_KEY"),
  dryRun: env("DRY_RUN") === "true",
  /** Target notional of one post-only quote. */
  quoteUsd: Number(env("QUOTE_USD", "40")),
  /** Margin sleeve cap in USDC. */
  sleeveUsd: Number(env("SLEEVE_USD", "200")),
  quoteInsideTicks: Number(env("QUOTE_INSIDE_TICKS", "1")),
  horizonBlocks: Number(env("HORIZON_BLOCKS", "100")),
  model: env("MODEL", "mock") as "mock" | "jev",
  jevModelId: env("JEV_MODEL_ID", "typesafe-ai/jev")!,
  jevUsdPerMTok: 0.042,
  port: Number(env("PORT", "3000")),
  historySize: 1000,
  bankrollUsd: Number(env("BANKROLL_USD", "200")),
};

export function hexKey(key: string): `0x${string}` {
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}
