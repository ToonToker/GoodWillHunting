# Project Horus-Dashboard

High-performance ShopGoodwill sniper with a Tailwind dark-mode dashboard + Node.js backend.

## Features

- **Account Console** for multi-account session status and manual token refresh.
- **Battle Map** live snipe table with real-time countdowns via WebSocket pushes.
- **Direct Input** accepts an item URL and adds that item to watch flow.
- **Favorites Sync** every 60s for all accounts; uses Notes JSON `{"max_bid":123.45}` as target max bid.
- **Snipe timings**:
  - prewarm bid connection at **T-10s**
  - place bid at **T-2.8s**
  - retry once at `+1` on `Bid too low` if still `<= max_bid`
- **Precision**: final 5-second countdown uses `process.hrtime.bigint()` loop.
- **API payload** includes `itemId`, `sellerId`, `bidAmount`, and `bidType`.
- **Token storage** writes JWT snapshots to local `sessions.json`.

## Setup

1. Copy `accounts.example.json` to `accounts.json` and add credentials.
2. Install dependencies.
3. Run server.

```bash
cp accounts.example.json accounts.json
npm install
npm run dev
```

Open: `http://localhost:3000`

## Environment Variables

- `PORT` (default `3000`)
- `SGW_BASE_URL` (default `https://buyerapi.shopgoodwill.com`)
- `SGW_UA` (custom browser user-agent)

## Note on workflow

The dashboard is designed so you can **heart** items on the official site, set your `max_bid` note there, and let Favorites sync automatically discover and arm targets.
