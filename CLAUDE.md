---
description: Bun bot plus Next dashboard. Do not flatten the two runtimes.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

The bot is Bun. The dashboard is Next in `web/`. That split is intentional: keys, evaluate, and orders stay on the Bun process; the page is a live Next app. Do not fold the dashboard into Bun HTML imports unless you are merging deploys. Do not use Node, npm, pnpm, vite, or express for new work.

## Bot (repo root)

- `bun <file>` instead of `node` or `ts-node`
- `bun test` instead of jest or vitest
- `bun install` / `bun run <script>`
- `Bun.serve()` for the SSE API. WebSocket is built-in.
- Prefer `Bun.file` over `node:fs` read/write when touching new I/O
- Bun loads `.env`. Do not add dotenv.

Bot listens on `PORT` (default 3000). Dashboard `web/` is Next on 3001.

```sh
bun run start
bun run dev:web
```

## Dashboard (`web/`)

Next.js App Router. SSE client in `web/src/lib/useFeed.ts`. Wire types are `src/types.ts`. The dashboard keeps a copy in `web/src/lib/bot-types.ts` so the Vercel build does not need the repo root. Keep those two files identical. `bun test` diffs them.

## Testing

Tests live in `test/`, not next to `src/`.

```sh
bun test
```

## The core message (do not break this)

The demo is a live Jev trading bot on Hyperliquid. Every design or strategy change must keep these claims true:

> I built a trading bot with Jev!
>
> Jev decides if it should "buy" or "sell", given the price feed of an asset pair, and executes real trades.
>
> Jev decides on every Hyperliquid tick.
>
> Demo link: https://www.jev-trade.com/

Non-negotiables: Jev makes the buy/sell call (not code), from the price feed; real trades from a real wallet; a Jev decision every tick, not every N ticks. The demo is the live dashboard. No middle dots, em dashes or en dashes in any rendered text. No blinking or pulsing indicators.

Hold is one of Jev's answers, so a tick can end with no order. That is Jev's call, not the code skipping a tick, and the decision still happens every tick. Do not reintroduce a forced buy or sell just to keep an order on the book.
