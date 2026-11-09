import { existsSync, readFileSync } from "node:fs";
import { hexAddress, hexKey } from "./config";

export function coinPair(coin: string): string {
  return `${coin}-USD`;
}

export function sameCoin(a: string | undefined, b: string): boolean {
  return !!a && a === b;
}

export interface SleeveConfig {
  coin: string;
  pair: string;
  label: string;
  privateKey?: string;
  /** Hyperliquid user address for read-only account state (no signing). */
  watchAddress?: `0x${string}`;
}

type WalletFile = { sleeves?: { coin?: string; privateKey?: string }[] };

/** Public testnet wallets from migration archive (no keys). */
export const DEFAULT_READ_ONLY_WALLETS: Record<string, string> = {
  BTC: "0x1dc5bDcFcd24B1b0Fbc7bEB2bb1585c1937Cc475",
  ETH: "0xCDf4f6929993769EB0B939901D7491c22a95b45C",
  SOL: "0xE7A47b6950E975d6ceB7520417ac77267c53DAb6",
  DOGE: "0x8A49DdE3FAeaD63E35c52448D9284b50f5CcC14B",
  BNB: "0x2F9AfA933242772661cC0B588d0F8Ad5f8c87D51",
};

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

/** Parse `READ_ONLY_WALLETS_JSON` `{ "BTC": "0x..." }` or `{ sleeves: [{coin, address}] }`. */
export function parseReadOnlyWalletsJson(raw: string): Map<string, `0x${string}`> {
  const out = new Map<string, `0x${string}`>();
  try {
    const parsed = JSON.parse(raw) as { sleeves?: { coin?: string; address?: string; wallet?: string }[] } | Record<string, string>;
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.sleeves)) {
      for (const s of parsed.sleeves ?? []) {
        const addr = s.address ?? s.wallet;
        if (s.coin && addr) out.set(s.coin, hexAddress(addr));
      }
      return out;
    }
    if (parsed && typeof parsed === "object") {
      for (const [coin, addr] of Object.entries(parsed as Record<string, string>)) {
        if (coin && addr) out.set(coin, hexAddress(addr));
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

function loadReadOnlyWallets(): Map<string, `0x${string}`> {
  const out = new Map<string, `0x${string}`>();
  const fromEnv = process.env.READ_ONLY_WALLETS_JSON?.trim();
  if (fromEnv) {
    for (const [coin, addr] of parseReadOnlyWalletsJson(fromEnv)) out.set(coin, addr);
    return out;
  }
  if (process.env.RESTORATION_MODE === "true") {
    for (const [coin, addr] of Object.entries(DEFAULT_READ_ONLY_WALLETS)) out.set(coin, hexAddress(addr));
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
  const readOnly = loadReadOnlyWallets();
  const source = process.env.RESTORATION_MODE === "true" ? undefined : process.env.PRIVATE_KEY;
  return listed.map((coin, i) => {
    const fromFile = file.get(coin);
    const privateKey = process.env.RESTORATION_MODE === "true" ? undefined : fromFile ?? (i === 0 ? source : undefined);
    return {
      coin,
      pair: coinPair(coin),
      label: coin,
      privateKey: privateKey ? hexKey(privateKey) : undefined,
      watchAddress: readOnly.get(coin),
    };
  });
}
