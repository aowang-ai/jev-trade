import { existsSync, readFileSync } from "node:fs";
import { hexKey } from "./config";

export function coinLabel(coin: string): string {
  const i = coin.indexOf(":");
  return i >= 0 ? coin.slice(i + 1) : coin;
}

export function coinDex(coin: string): string | undefined {
  const i = coin.indexOf(":");
  return i > 0 ? coin.slice(0, i) : undefined;
}

export function coinPair(coin: string): string {
  return `${coinLabel(coin)}-USD`;
}

export function tapePath(label: string): string {
  return `data/events-${label}.jsonl`;
}

export function sameCoin(a: string | undefined, b: string): boolean {
  if (!a) return false;
  return a === b || coinLabel(a) === coinLabel(b);
}

export interface SleeveConfig {
  coin: string;
  pair: string;
  label: string;
  privateKey?: string;
}

type WalletFile = { sleeves?: { coin?: string; privateKey?: string }[] };

/** Parse `.wallets.json` or `WALLETS_JSON`. Env overlays the file. */
export function parseWalletsJson(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const parsed = JSON.parse(raw) as WalletFile | Record<string, string>;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as WalletFile).sleeves)) {
      for (const s of (parsed as WalletFile).sleeves ?? []) {
        if (s.coin && s.privateKey) out.set(s.coin, s.privateKey);
      }
      return out;
    }
    if (parsed && typeof parsed === "object") {
      for (const [coin, key] of Object.entries(parsed as Record<string, string>)) {
        if (coin && typeof key === "string" && key) out.set(coin, key);
      }
    }
  } catch {
    // ignore junk
  }
  return out;
}

function loadWalletKeys(): Map<string, string> {
  const out = new Map<string, string>();
  if (existsSync(".wallets.json")) {
    try {
      for (const [coin, key] of parseWalletsJson(readFileSync(".wallets.json", "utf8"))) {
        out.set(coin, key);
      }
    } catch {
      // ignore junk
    }
  }
  const fromEnv = process.env.WALLETS_JSON;
  if (fromEnv) {
    for (const [coin, key] of parseWalletsJson(fromEnv)) out.set(coin, key);
  }
  return out;
}

/** First coin can use PRIVATE_KEY. Others use WALLETS_JSON or `.wallets.json`. */
export function loadSleeves(): SleeveConfig[] {
  const listed = (process.env.HL_COINS ?? "BTC,ETH,SOL,DOGE,BNB")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const file = loadWalletKeys();
  const source = process.env.PRIVATE_KEY;
  return listed.map((coin, i) => {
    const fromFile = file.get(coin);
    const privateKey = fromFile ?? (i === 0 ? source : undefined);
    return {
      coin,
      pair: coinPair(coin),
      label: coinLabel(coin),
      privateKey: privateKey ? hexKey(privateKey) : undefined,
    };
  });
}
