# Spec

A live dashboard of five Jev sleeves making buy/sell calls on Hyperliquid perps (BTC, ETH, SOL, DOGE, BNB) and posting real post-only quotes every tick.

Each sleeve has its own wallet, book, and Jev evaluate. Jev sees that sleeve's book, position, and indicators. The bot (Bun, port 3000) places one Alo limit inside the touch. Position, PnL, and fill history (open, close, buy, sell) are read from Hyperliquid. The page (Next in `web/`, port 3001) is the demo.
