# jev-trade

Live demo: [jev-trade.com](https://www.jev-trade.com/)

Jev quotes Hyperliquid every tick. Five isolated sleeves (BTC, ETH, SOL, DOGE, BNB). Each sleeve has its own wallet and Jev call. The bot posts a post-only Alo quote one tick inside the touch. Fills happen when a taker hits it. Position and PnL come from Hyperliquid.

This is a real trading bot. A live key on mainnet or testnet will send real orders. Start with a dry run.

The bot is Bun on port 3000. The dashboard is Next in `web/` on port 3001. Keys, evaluate, and orders stay on the Bun process.

Based on [jev-trader](https://github.com/jarrodwatts/jev-trader) by Jarrod Watts (MIT). Venue and product are Hyperliquid, not Monad / Kuru.

## Requirements

[Bun](https://bun.sh) 1.2 or newer.

## Dry run

No `PRIVATE_KEY` means a dry run: real book, real decisions, simulated fills. Default `MODEL=mock` is a momentum stand-in and needs no API key.

```sh
cp .env.example .env
bun install
bun run start
```

Dashboard (second terminal):

```sh
cp web/.env.example web/.env.local
bun run dev:web
```

Open http://localhost:3001. The page reads `$NEXT_PUBLIC_API_URL/events` (default `http://localhost:3000`).

## Live Jev

Set `MODEL=jev` and `AI_GATEWAY_API_KEY` in `.env`. Restart the bot. Jev is called through Vercel AI Gateway (`JEV_MODEL_ID=typesafe-ai/jev`).

## Live testnet orders

1. Keep `HL_TESTNET=true`.
2. Set `PRIVATE_KEY` for the first coin (BTC).
3. Copy `.wallets.example.json` to `.wallets.json` and put a key on each other sleeve. Or set `WALLETS_JSON`.
4. Get mock USDC from https://app.hyperliquid-testnet.xyz/drip. The faucet only pays addresses that have deposited on mainnet.
5. Leave `DRY_RUN=false`. A missing key on a sleeve still dry-runs that sleeve.

`HL_TESTNET=false` is mainnet. Do not flip that until you mean it.

## Tests

```sh
bun test
```

CI runs the same command on push and pull request.

## Env

See [`.env.example`](.env.example). The ones that change behavior:

| Variable | Default | Meaning |
| --- | --- | --- |
| `HL_COINS` | `BTC,ETH,SOL,DOGE,BNB` | Sleeves to run |
| `HL_TESTNET` | `true` | `false` is mainnet |
| `MODEL` | `mock` | `jev` needs `AI_GATEWAY_API_KEY` |
| `PRIVATE_KEY` | empty | First coin. Empty is a dry run |
| `DRY_RUN` | `false` | `true` simulates every sleeve |
| `TICK_MS` | `500` | Decision + requote cadence |
| `QUOTE_USD` | `40` | Quote notional per tick |
| `PORT` | `3000` | Bot SSE |

## Endpoints

- `GET /` snapshot: model, sleeves, latestByCoin
- `GET /history` last 1000 ticks per coin
- `GET /tape` all-time mid series plus fill marks per coin
- `GET /events` SSE: `snapshot` on connect (`historyByCoin`, `tapeByCoin`), then `block`, `quote`, `fill` keyed by coin

## Layout

```
src/           Bun bot
test/          bun tests
web/           Next dashboard
```

## License

MIT. Copyright 2026 aowang. Includes MIT code originally published as jev-trader by Jarrod Watts.
