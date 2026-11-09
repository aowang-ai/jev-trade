import { existsSync } from "node:fs";

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

const restorationMode = env("RESTORATION_MODE") === "true";
const hlTestnet = env("HL_TESTNET", "true") !== "false";
const jevProvider = resolveJevProvider(process.env);
const jevModelId = resolveJevModelId(process.env, jevProvider);

/** Restoration forbids signing keys so the bot cannot trade. */
export function assertRestorationSafety() {
  if (process.env.RESTORATION_MODE !== "true") return;
  const deny = (label: string) => {
    throw new Error(`${label} is not allowed when RESTORATION_MODE=true`);
  };
  if (env("PRIVATE_KEY")?.trim()) deny("PRIVATE_KEY");
  const wallets = env("WALLETS_JSON")?.trim();
  if (wallets && /privateKey/i.test(wallets)) deny("WALLETS_JSON with privateKey");
  if (existsWalletFile()) deny(".wallets.json");
}

function existsWalletFile() {
  return existsSync(".wallets.json");
}

const dryRun = restorationMode || env("DRY_RUN") === "true";

export const config = {
  restorationMode,
  /** False in restoration: no mock ticks, sim fills, or ExchangeClient. */
  executionEnabled: !restorationMode && env("EXECUTION_ENABLED") !== "false",
  hlTestnet,
  networkLabel: hlTestnet ? "hyperliquid-testnet" : "hyperliquid-mainnet",
  tickMs: Number(env("TICK_MS", "2000")),
  /** Book/price prints for the chart. Independent of Jev ticks. */
  priceMs: Math.max(50, Number(env("PRICE_MS", "200"))),
  explorerTx: hlTestnet
    ? "https://app.hyperliquid-testnet.xyz/explorer/tx/"
    : "https://app.hyperliquid.xyz/explorer/tx/",
  privateKey: restorationMode ? undefined : env("PRIVATE_KEY"),
  dryRun,
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
  historySize: Number(env("HISTORY_CAP", restorationMode ? "50000" : "1000")),
  historyDataDir: env("HISTORY_DATA_DIR", "data/history"),
  historyImportSecret: env("HISTORY_IMPORT_SECRET"),
  historyR2Bucket: env("HISTORY_R2_BUCKET"),
  historyPersistR2Key: env("HISTORY_PERSIST_R2_KEY", "mig1/runtime-history-bundle.json"),
  historyAutoLoadR2Key: env("HISTORY_AUTO_LOAD_R2_KEY"),
  bankrollUsd: Number(env("BANKROLL_USD", "200")),
};

export function hexKey(key: string): `0x${string}` {
  return (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
}

export function hexAddress(key: string): `0x${string}` {
  const k = key.startsWith("0x") ? key : `0x${key}`;
  if (!/^0x[0-9a-fA-F]{40}$/.test(k)) throw new Error(`invalid watch address ${key}`);
  return k as `0x${string}`;
}
