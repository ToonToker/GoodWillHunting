# Project Horus-Dashboard-Omega

High-performance, multi-account ShopGoodwill Sovereign Sniper with a dark-mode Mission Control GUI.

## Omega Architecture

- **Backend Core:** Node.js + Express + WebSocket, API-only execution.
- **Transport:** `undici` HTTP/1.1 Agent for low-latency buyer API calls.
- **Multi-Account Vault:** `sessions.json` stores and rotates JWT sessions for all accounts.
- **Favorite Sync:** every 60s, pulls Favorites per account and auto-queues targets when Notes contain JSON max bids:
  - `{"max": 75}`
  - `{"max_bid": 75}`
- **Berkland Trigger:**
  - Pre-warm at **T-10s**
  - Fire at **T-2.8s** adjusted by startup latency audit (+/-100ms)
  - Final 5-second precision loop uses `process.hrtime()`
- **Retry-on-low-bid:** if response indicates bid too low, retries once at `+1` while still `<= max`.

## Mission Control GUI (Tailwind)

- **Account Console (sidebar):** add/remove accounts + live green/red connection status.
- **Battle Map table:**
  - Item Photo
  - Item ID
  - Account Assigned
  - Current Price
  - Your Max
  - Countdown (ms precision)
- **Quick-Snipe:** paste URL to parse Item ID + Seller ID and instantly queue watch.
- **Maa Kheru Stream:** WebSocket event feed with success/failure updates.

## Setup

```bash
cp accounts.example.json accounts.json
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment

- `PORT` (default `3000`)
- `SGW_BASE_URL` (default `https://buyerapi.shopgoodwill.com`)
- `SGW_UA` (User-Agent override)
- `ACCOUNTS_PATH` (default `accounts.json`)

## Pro Tip

You can simply heart items on ShopGoodwill and write your max bid in Favorites Notes. Omega auto-detects those entries on sync and arms snipes automatically.
