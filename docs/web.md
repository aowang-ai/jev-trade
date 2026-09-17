# Dashboard

Next.js App Router dashboard for the Bun bot. This is the live demo page. It is not a Bun HTML import on purpose.

## Run

```bash
export BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache" BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
bun install
NEXT_PUBLIC_API_URL=http://localhost:3000 bun run dev
```

Dev server is port 3001 so it does not collide with the bot on 3000.

## Config

Copy `.env.example` to `.env.local`. `NEXT_PUBLIC_API_URL` points at the bot
(default `http://localhost:3000`). The app opens an EventSource on
`$NEXT_PUBLIC_API_URL/events`. On Vercel, set it to your Railway URL.

Wire types live in `src/types.ts` on the bot. The dashboard keeps a copy in
`web/src/lib/bot-types.ts` so the Vercel build does not need the repo root.

## Layout

- `src/lib/types.ts` FeedState plus wire types from the bot
- `src/lib/useFeed.ts` SSE: snapshot / block / quote / fill per coin, reconnect
- `src/components/SleeveStrip` five live positions; click to switch the chart and feed
- `src/lib/format.ts` number, address, tx
- `src/components/<Name>/<Name>.tsx` UI (one folder each)
