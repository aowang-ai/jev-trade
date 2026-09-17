import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import type { BlockEvent, PricePoint } from "./types";

export type { PricePoint };

export const TAPE_MAX = 200_000;

export function loadTape(path = "data/events.jsonl"): PricePoint[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const out: PricePoint[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    let e: { ts?: unknown; mid?: unknown; block?: unknown };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof e.ts !== "number" || typeof e.mid !== "number") continue;
    if (!Number.isFinite(e.ts) || !Number.isFinite(e.mid) || e.mid <= 0) continue;
    out.push({
      ts: e.ts,
      mid: e.mid,
      block: typeof e.block === "number" ? e.block : undefined,
    });
  }
  return out.length > TAPE_MAX ? out.slice(out.length - TAPE_MAX) : out;
}

function persistEvent(event: BlockEvent, path = "data/events.jsonl") {
  mkdirSync("data", { recursive: true });
  appendFileSync(path, JSON.stringify(event) + "\n");
}

export function appendEvent(tape: PricePoint[], event: BlockEvent, path = "data/events.jsonl") {
  appendTape(tape, { ts: event.ts, mid: event.mid, block: event.block });
  persistEvent(event, path);
}

/** Place venue fills on the nearest mid print, or insert a point at the fill time. */
export function stampFills(tape: PricePoint[], fills: Array<NonNullable<PricePoint["fill"]> & { ts: number }>) {
  for (const f of fills) {
    if (!Number.isFinite(f.ts) || !Number.isFinite(f.price)) continue;
    const mark = { side: f.side, price: f.price, size: f.size, dir: f.dir };
    let best = -1;
    let bestDt = Infinity;
    for (let i = 0; i < tape.length; i++) {
      const dt = Math.abs(tape[i]!.ts - f.ts);
      if (dt < bestDt) {
        bestDt = dt;
        best = i;
      }
    }
    if (best >= 0 && bestDt <= 2_000) {
      tape[best] = { ...tape[best]!, fill: mark };
      continue;
    }
    const point: PricePoint = { ts: f.ts, mid: f.price, fill: mark };
    let idx = tape.length;
    for (let i = 0; i < tape.length; i++) {
      if (tape[i]!.ts > f.ts) {
        idx = i;
        break;
      }
    }
    tape.splice(idx, 0, point);
  }
}

export function appendTape(tape: PricePoint[], point: PricePoint) {
  tape.push(point);
  if (tape.length > TAPE_MAX) tape.splice(0, tape.length - TAPE_MAX);
}

export function markTapeFill(
  tape: PricePoint[],
  fill: NonNullable<PricePoint["fill"]>,
  match: { ts?: number; block?: number },
): boolean {
  if (match.ts != null) {
    for (let i = tape.length - 1; i >= 0; i--) {
      if (tape[i]!.ts === match.ts) {
        tape[i] = { ...tape[i]!, fill };
        return true;
      }
    }
  }
  if (match.block != null) {
    for (let i = tape.length - 1; i >= 0; i--) {
      if (tape[i]!.block === match.block) {
        tape[i] = { ...tape[i]!, fill };
        return true;
      }
    }
  }
  const ts = match.ts;
  if (ts == null || !Number.isFinite(ts)) return false;
  stampFills(tape, [{ ts, ...fill }]);
  return true;
}
