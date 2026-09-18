import type { PricePoint } from "./bot-types";

export type TapeFill = {
  key: string;
  ts: number;
  side: "buy" | "sell";
  price: number;
  size: number;
  dir?: "open" | "close" | "flip";
  hash?: string;
};

/** Venue fills already sitting on the mid tape. Newest last. */
export function tapeFills(tape: PricePoint[]): TapeFill[] {
  const out: TapeFill[] = [];
  for (const p of tape) {
    const f = p.fill;
    if (!f || !(f.size > 0) || !(p.ts > 0)) continue;
    out.push({
      key: `${p.ts}|${f.side}|${f.price}|${f.size}|${f.dir ?? ""}|${f.hash ?? ""}`,
      ts: p.ts,
      side: f.side,
      price: f.price,
      size: f.size,
      dir: f.dir,
      hash: f.hash,
    });
  }
  return out;
}
