# Spec

A live dashboard of five Jev sleeves making buy/sell calls on Hyperliquid perps (BTC, ETH, SOL, DOGE, BNB) and posting real post-only quotes every tick.

Each sleeve has its own wallet, book, Jev evaluate, and $200 cap. Jev sees that sleeve's book and tape. The bot (Bun, port 3000) places one Alo limit inside the touch. Position, PnL, and fill history (open, close, buy, sell) are read from Hyperliquid. The page (Next in `web/`, port 3001) is the demo. Local `events-<label>.jsonl` is only that sleeve's mid series and Jev calls.
