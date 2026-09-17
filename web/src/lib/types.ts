export type {
  BlockEvent,
  Fill,
  Meta,
  PricePoint,
  Quote,
  SleeveMeta,
} from "./bot-types";
import type { BlockEvent, Meta, PricePoint } from "./bot-types";

export type ConnectionState = "connecting" | "live" | "reconnecting";

export interface SleeveFeed {
  events: BlockEvent[];
  tape: PricePoint[];
  latest: BlockEvent | null;
  avgLatencyMs: number;
}

export interface FeedState {
  meta: Meta | null;
  connection: ConnectionState;
  byCoin: Record<string, SleeveFeed>;
}
