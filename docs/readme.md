# jev-trader

Jev watches five Hyperliquid books and picks long or short, open or close, and leverage every tick on each one. Each sleeve has its own wallet and Jev call. The bot posts a post-only Alo quote one tick inside the touch. Same side: modify in place. Side flip: cancel and replace. Fills happen when a taker hits it. Position and PnL come from Hyperliquid. Sleeves do not block each other: a late Jev call on BTC does not stall ETH.

Two runtimes on purpose: the bot is Bun on port 3000, the dashboard is Next in `web/` on port 3001.

## Run

    cp .env.example .env
    bun install
    bun run start

No `PRIVATE_KEY` is a dry run: real book, real decisions, simulated fills. `MODEL=jev` plus `AI_GATEWAY_API_KEY` uses Jev through Vercel AI Gateway. Default `mock` is a momentum stand-in.

    cd web
    bun install
    NEXT_PUBLIC_API_URL=http://localhost:3000 bun run dev

Hyperliquid defaults to testnet. Live testnet orders need a key plus mock USDC from https://app.hyperliquid-testnet.xyz/drip (the faucet only pays addresses that have deposited on mainnet). Set `HL_TESTNET=false` only for mainnet.

    bun test

## Endpoints

- `GET /` snapshot: model, sleeves, latestByCoin
- `GET /history` last 1000 ticks per coin
- `GET /tape` all-time mid series plus fill marks per coin
- `GET /events` SSE: `snapshot` on connect (`historyByCoin`, `tapeByCoin`), then `block`, `quote`, `fill` keyed by coin

## Layout

    src/types.ts     wire: Book, Quote, Fill, BlockEvent, Meta, PricePoint
    src/config.ts    env
    src/sleeves.ts   coin list, HIP-3 names, per-wallet keys
    src/feed.ts      Hyperliquid WS book, tape, account
    src/market.ts    Alo quotes, venue account
    src/account.ts   clearinghouse position and fill PnL
    src/book.ts      ticks, clamp, book from levels
    src/chart.ts     Hyperliquid candles and userFills
    src/trades.ts    print ring, live and sim fills
    src/model.ts     JevModel, MockModel
    src/trader.ts    tick loop and risk
    src/server.ts    snapshot, history, tape, SSE
    src/index.ts     assemble five isolated runners
    test/            bun tests, kept out of src/
    web/             Next dashboard on 3001
    docs/            human docs
