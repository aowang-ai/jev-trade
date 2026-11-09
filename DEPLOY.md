# Deploy Jev Trade on Cloudflare

Two Workers:

| Piece | Wrangler name | What runs |
| --- | --- | --- |
| Bot SSE API | `jev-trade-bot` | Bun bot in a **Container** (repo-root `Dockerfile`), proxied by a Durable Object |
| Dashboard | `jev-trade-web` | Next.js 16 via **@opennextjs/cloudflare** |

Account ID (already in each `wrangler.jsonc`): `a1d7542d06e5119c859e11e7755043c2`.

Use **workers.dev** first. Do not point `jev-trade.com` at Cloudflare until both URLs are healthy. DNS today is a Vercel CNAME; this repo does not change it.

## Prerequisites

- [Bun](https://bun.sh) 1.2+ (local dev and CI)
- Cloudflare **Workers Paid** (Containers require it)
- `CLOUDFLARE_API_TOKEN` or `wrangler login` with deploy permissions on the account
- **Docker** only when you deploy the bot **from your laptop**. Wrangler must build the Container image locally in that case. If you use GitHub Actions (below), the runner has Docker and your machine does not need it.

```sh
export CLOUDFLARE_API_TOKEN=...   # if not using wrangler login
```

## GitHub Actions (recommended without local Docker)

Workflow: [`.github/workflows/deploy-cloudflare.yml`](.github/workflows/deploy-cloudflare.yml).

### Repo secrets (Settings → Secrets and variables → Actions)

| Secret | Required | Value |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Yes | API token with Workers + Containers deploy on account `a1d7542d06e5119c859e11e7755043c2` |
| `CLOUDFLARE_ACCOUNT_ID` | Yes (for CI) | `a1d7542d06e5119c859e11e7755043c2` |

`wrangler.jsonc` files also set `account_id`; the secret keeps CI explicit and matches what Wrangler reads from `CLOUDFLARE_ACCOUNT_ID`.

### When it runs

- **Push to `main`** when `cloudflare/`, `web/`, `Dockerfile`, `src/`, or this workflow file changes
- **`workflow_dispatch`** on any branch (pick a branch in the Actions UI, including a PR branch, to deploy from that ref)

### Jobs

1. **`deploy-bot`**: `cd cloudflare/bot && bun install && bun run deploy` (builds the image on `ubuntu-latest` with Docker)
2. **`deploy-web`**: after the bot job, sets `NEXT_PUBLIC_API_URL=https://jev-trade-bot.wangaotongji.workers.dev` and runs `cd web && bun run cf:deploy`

Live workers.dev URLs for this account:

- Bot: `https://jev-trade-bot.wangaotongji.workers.dev`
- Dashboard: `https://jev-trade-web.wangaotongji.workers.dev`

## 1. Bot (Container + Worker)

Config lives in `cloudflare/bot/`.

### Dry run (default)

`wrangler.jsonc` sets `MODEL=mock` and no `PRIVATE_KEY`. Hyperliquid testnet book is live; fills are simulated without keys.

```sh
cd cloudflare/bot
bun install
bunx tsc --noEmit
bunx wrangler deploy --dry-run --containers-rollout=none   # Worker only; full deploy needs Docker
bun run deploy
```

After deploy, note the Worker URL:

`https://jev-trade-bot.<workers-subdomain>.workers.dev`

Smoke:

```sh
BOT=https://jev-trade-bot.<workers-subdomain>.workers.dev
curl -sS "$BOT/" | head -c 400
curl -sS -N --max-time 5 "$BOT/events?lite=1" | head -n 5
```

First deploy can take several minutes while the container image is built and provisioned. Expect 502s until the container is ready.

### Live trading / live Jev (secrets)

Set secrets on the **bot** Worker (never commit values):

```sh
cd cloudflare/bot

# Testnet order (optional)
wrangler secret put PRIVATE_KEY
# Or multi-sleeve keys:
wrangler secret put WALLETS_JSON

# Live Jev (optional; default deploy uses MODEL=mock)
wrangler vars set MODEL jev
wrangler secret put TYPESAFE_API_KEY
# or:
# wrangler vars set JEV_PROVIDER gateway
# wrangler secret put AI_GATEWAY_API_KEY

# Force simulated quotes even with keys:
wrangler secret put DRY_RUN
# pass value: true
```

Plain vars you can change with `wrangler vars set` (see `cloudflare/bot/wrangler.jsonc` and `.env.example` in the repo root).

Outbound internet is enabled on the container (`enableInternet: true`) so Hyperliquid websockets work.

## 2. Dashboard (OpenNext)

Config in `web/`. **`NEXT_PUBLIC_API_URL` must be set at build time** to the bot Worker URL (no trailing slash).

```sh
cd web
bun install
export NEXT_PUBLIC_API_URL=https://jev-trade-bot.<workers-subdomain>.workers.dev
bun run cf:deploy
```

Dashboard URL:

`https://jev-trade-web.<workers-subdomain>.workers.dev`

Open it in a browser and confirm the feed connects (browser devtools: EventSource to `$NEXT_PUBLIC_API_URL/events`).

Local preview on Workers runtime:

```sh
export NEXT_PUBLIC_API_URL=https://jev-trade-bot.<workers-subdomain>.workers.dev
bun run cf:preview
```

## 3. Custom domain (manual, after smoke tests)

Only after bot and web work on workers.dev:

1. Workers & Pages → `jev-trade-web` → Custom domains → add `www.jev-trade.com` (or apex via Cloudflare DNS).
2. Update `NEXT_PUBLIC_API_URL` to the **bot** URL (workers.dev or a custom host on the bot Worker if you add one), rebuild, and redeploy the web Worker.
3. Replace the Vercel CNAME in the `jev-trade.com` zone when you are ready to cut over.

The bot can stay on `*.workers.dev`; the dashboard only needs a stable `NEXT_PUBLIC_API_URL` at build time.

## Layout

```
Dockerfile                 # Bun bot image (linux/amd64)
cloudflare/bot/
  wrangler.jsonc             # Container + DO + vars
  src/index.ts               # Proxy to port 3000
web/
  wrangler.jsonc             # OpenNext worker + assets
  open-next.config.ts
```

## Troubleshooting

- **502 from bot Worker**: Container still starting, or Docker was not running during `wrangler deploy`. Check Workers → Containers logs.
- **Dashboard shows no feed**: Wrong `NEXT_PUBLIC_API_URL` at build time; rebuild web after fixing.
- **`wrangler deploy` fails on image build**: Start Docker locally, or use the **deploy-cloudflare** GitHub Action instead. Image must be `linux/amd64` (see repo `Dockerfile`).
