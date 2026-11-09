# Historical data restoration (Cloudflare)

Safe replay of archived desk history plus **read-only** Hyperliquid testnet account state. No private keys, no `ExchangeClient`, no orders.

## Archive (do not delete)

R2 bucket `jev-trade-mig-archive` (source; importers read, never rewrite these keys):

| Key | Contents |
| --- | --- |
| `mig1/public-history.tgz` | Original export (9 JSONL + meta) |
| `mig1/restore-history-sanitized.tar.gz` | Optional security-reviewed copy for coordinators (~1MB, same layout) |
| `mig1/wallets-public.json` / `mig1/hl-account-states.json` | Sanitized meta snapshots |

Layout inside the tarball:

```
history/events.jsonl          # 25110 rows, **no** top-level `coin` → import scope `__legacy_unscoped__`
history/events-BTC.jsonl      # 3727
history/events-ETH.jsonl      # 3723
history/events-SOL.jsonl      # 3682
history/events-DOGE.jsonl     # 2408
history/events-BNB.jsonl      # 1589
history/events-AVAX.jsonl     # 817
history/events-GOLD.jsonl     # 1023
history/events-NVDA.jsonl     # 1023
meta/*.sanitized.*
```

**43 102** parseable `BlockEvent` lines total. Legacy `events.jsonl` must **not** be labeled BTC or any sleeve coin. Per-sleeve files may include `coin` on each row. `fill` is always `null` in this archive.

Runtime bundle (writable by the bot after import, separate from `mig1/public-history.tgz`):

| Key | Purpose |
| --- | --- |
| `mig1/runtime-history-bundle.json` | Optional auto-load on container start (`HISTORY_AUTO_LOAD_R2_KEY`) |

## Bot env (production restoration)

```env
RESTORATION_MODE=true
DRY_RUN=true
HL_TESTNET=true
MODEL=mock
EXECUTION_ENABLED=false   # implied when RESTORATION_MODE=true
READ_ONLY_WALLETS_JSON=     # optional; defaults to five public testnet addresses in code
HISTORY_IMPORT_SECRET=      # wrangler secret on jev-trade-bot
HISTORY_DATA_DIR=data/history
HISTORY_R2_BUCKET=jev-trade-mig-archive
HISTORY_PERSIST_R2_KEY=mig1/runtime-history-bundle.json
HISTORY_AUTO_LOAD_R2_KEY=mig1/runtime-history-bundle.json  # optional
R2_S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=           # secret
R2_SECRET_ACCESS_KEY=       # secret
```

Default read-only testnet addresses (BTC, ETH, SOL, DOGE, BNB) live in `src/sleeves.ts` as `DEFAULT_READ_ONLY_WALLETS`.

Set on the **container** via `cloudflare/bot/wrangler.jsonc` vars + secrets (see [DEPLOY.md](DEPLOY.md)).

## Import steps (coordinator)

1. Deploy bot with restoration vars and `HISTORY_IMPORT_SECRET`.
2. Upload sanitized bundle to R2 (optional; does not replace `mig1/public-history.tgz`):

```sh
wrangler r2 object put jev-trade-mig-archive/mig1/restore-history-sanitized.tar.gz \
  --file=./restore-history-sanitized.tar.gz \
  --content-type=application/gzip
```

3. Download and extract locally (private; bucket is not public):

```sh
wrangler r2 object get jev-trade-mig-archive/mig1/restore-history-sanitized.tar.gz --file=restore.tgz
# or: wrangler r2 object get jev-trade-mig-archive/mig1/public-history.tgz --file=public-history.tgz
tar -xzf restore.tgz
```

4. Import all JSONL with filename-derived scopes (idempotent; safe to re-run):

```sh
export HISTORY_IMPORT_SECRET=...
bun run scripts/import-migration-archive.ts \
  --api https://bot.jev-trade.com \
  --token "$HISTORY_IMPORT_SECRET" \
  --dir ./history
```

Or one tarball in one step:

```sh
bun run scripts/import-migration-archive.ts \
  --api https://bot.jev-trade.com \
  --token "$HISTORY_IMPORT_SECRET" \
  --tgz ./restore.tgz
```

Single file (scope from filename only):

```sh
bun run scripts/import-migration-archive.ts \
  --api https://bot.jev-trade.com \
  --token "$HISTORY_IMPORT_SECRET" \
  --jsonl ./history/events.jsonl
```

Legacy rows appear under `historyByCoin.__legacy_unscoped__` and in `meta.legacyUnscopedCount`, not under BTC.

4. Verify:

```sh
curl -sS -H "Authorization: Bearer $HISTORY_IMPORT_SECRET" https://bot.jev-trade.com/admin/import-status
curl -sS https://bot.jev-trade.com/ | jq '.sleeves,.restorationMode,.historicalThroughTs,.latestByCoin'
curl -sS https://bot.jev-trade.com/history | head -c 200
```

5. Redeploy or restart container so `HISTORY_AUTO_LOAD_R2_KEY` can reload merged state from R2 after `persistHistoryBundle` runs on import.

## API (authenticated)

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/admin/import-history` | Body: raw JSONL (`application/x-ndjson`). Optional header `X-File-Scope` (e.g. `__legacy_unscoped__`, `BTC`). Optional `Content-Encoding: gzip`. |
| `GET` | `/admin/import-status` | Import stats. |

No unauthenticated write routes. Archive keys under `mig1/public-history.tgz` are never modified by the bot.

## Dashboard

`NEXT_PUBLIC_API_URL=https://bot.jev-trade.com` (GitHub Action `deploy-web`).

When `meta.restorationMode` is true, the dashboard fetches full `/history` after the SSE snapshot so CALL rows are not capped at 12.

## Safety checks

- `assertRestorationSafety()` rejects `PRIVATE_KEY`, `.wallets.json`, and `WALLETS_JSON` with keys when `RESTORATION_MODE=true`.
- `Market` never constructs `ExchangeClient` without `EXECUTION_ENABLED` and a private key; read-only addresses use `InfoClient` + WS user channel only.
- Mock decision ticks are not started when `executionEnabled` is false.
