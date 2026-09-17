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

function keysFromWalletsFile(): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(".wallets.json")) return out;
  try {
    const raw = JSON.parse(readFileSync(".wallets.json", "utf8")) as {
      sleeves?: { coin?: string; privateKey?: string }[];
    };
    for (const s of raw.sleeves ?? []) {
      if (s.coin && s.privateKey) out.set(s.coin, s.privateKey);
    }
  } catch {
    // ignore junk
  }
  return out;
}

/** BTC uses PRIVATE_KEY. The rest read `.wallets.json` by coin. */
export function loadSleeves(): SleeveConfig[] {
  const listed = (process.env.HL_COINS ?? "BTC,ETH,SOL,DOGE,BNB")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const file = keysFromWalletsFile();
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
