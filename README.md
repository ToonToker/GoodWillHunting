# Project Horus-Omega

High-performance, multi-account, headless API sniper for ShopGoodwill with a minimalist Tailwind dashboard.

## Logos-Engine Architecture

- **Runtime:** Node.js + `undici` + `ws`.
- **Direct API path:** hits `buyerapi.shopgoodwill.com` endpoints directly, including `/api/Auction/PlaceBid`.
- **Multi-account vault:** reads unlimited credentials from `accounts.json`.
- **Token Manager:** keeps JWTs in memory + `sessions.json` and auto-refreshes every **20 minutes**.
- **Favorite-sync:** every 60s scans Favorites for each account; Note JSON with `{"max": ...}` or `{"max_bid": ...}` arms live targets.
- **Berkland Window:** pre-warm at T-10s, fire at T-2.8s (plus latency adjustment).
- **Precision:** final 5-second countdown uses `process.hrtime()` loop.
- **Bid payload:** sends `itemId`, `sellerId`, `bidAmount`, `bidType`, and `isProxy: true`.

## Startup Timing Calibration

- **Server clock sync:** computes offset from ShopGoodwill API `Date` header.
- **Latency audit:** samples API RTT and applies bounded trigger shift (±100ms).

## Maat Dashboard

- Dark-mode, single-page Tailwind interface.
- **Live Heartbeats:** account connection cards (green/red online status).
- **Battle Map:** real-time table of favorites + live targets.
- **Quick-Snipe:** paste URL containing item/seller identifiers to instantly queue a direct target.
- **Maa Kheru Stream:** WebSocket event feed for sniper outcomes.

## Setup

```bash
cp accounts.example.json accounts.json
npm install
npm run dev
```

Open `http://localhost:3000`.
