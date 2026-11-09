import { Container } from "@cloudflare/containers";
import { Hono } from "hono";

const PASSTHROUGH_KEYS = [
  "MODEL",
  "HL_TESTNET",
  "HL_COINS",
  "TICK_MS",
  "PRICE_MS",
  "QUOTE_USD",
  "QUOTE_INSIDE_TICKS",
  "CLOSE_SLIPPAGE_BPS",
  "BANKROLL_USD",
  "HORIZON_BLOCKS",
  "PORT",
  "DRY_RUN",
  "JEV_PROVIDER",
  "JEV_MODEL_ID",
  "PRIVATE_KEY",
  "TYPESAFE_API_KEY",
  "AI_GATEWAY_API_KEY",
  "WALLETS_JSON",
  "RESTORATION_MODE",
  "EXECUTION_ENABLED",
  "READ_ONLY_WALLETS_JSON",
  "HISTORY_DATA_DIR",
  "HISTORY_R2_BUCKET",
  "HISTORY_AUTO_LOAD_R2_KEY",
  "HISTORY_PERSIST_R2_KEY",
  "HISTORY_IMPORT_SECRET",
  "R2_S3_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
] as const;

function containerEnv(env: Env): Record<string, string> {
  const out: Record<string, string> = { PORT: "3000", NODE_ENV: "production" };
  for (const key of PASSTHROUGH_KEYS) {
    const v = env[key];
    if (v != null && v !== "") out[key] = v;
  }
  return out;
}

export class JevBotContainer extends Container<Env> {
  defaultPort = 3000;
  sleepAfter = "24h";
  enableInternet = true;

  override async fetch(request: Request): Promise<Response> {
    await this.startAndWaitForPorts({
      startOptions: {
        envVars: containerEnv(this.env),
        enableInternet: true,
      },
    });
    return super.fetch(request);
  }
}

const app = new Hono<{ Bindings: Env }>();

app.all("/*", (c) => c.env.JEV_BOT.getByName("singleton").fetch(c.req.raw));

app.onError((error, c) => {
  console.error("jev-trade bot proxy error:", error);
  return c.text("Bot container is starting or unavailable. Retry in a minute.", 502);
});

export default app;
