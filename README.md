# Project GoodWillHunting

High-performance, multi-account, API-only Sovereign Engine for ShopGoodwill.

## Core Engine (Logos)

- **Headless Node.js runtime** with no Puppeteer/Playwright/Selenium usage.
- **Networking:** `undici` HTTP/1.1 client for direct buyer API communication.
- **Clock sync on startup:** server-time offset derived from ShopGoodwill API response headers.
- **Snipe cadence:**
  - Pre-warm connection at **T-10s**.
  - Fire `/api/Auction/PlaceBid` at **T-2.5s** (with bounded latency adjustment).
- **Final window timing:** uses a worker-thread + `Atomics.wait` strategy in final 5 seconds.

## Multi-Account Sovereignty

- **accounts.json** supports multi-account credentials.
- **sessions.json** persists account JWT snapshots.
- **Token Manager:** checks validity and refreshes silently every **15 minutes**.
- **Auction pooling:** UI supports assigning specific item IDs to specific accounts.

## The Maat Dashboard

- Single-page Tailwind dashboard served by local Express server.
- Live account heartbeat cards (online/offline).
- Real-time Battle Map table:
  - Item ID
  - Account
  - Assigned Account override
  - Current Price
  - Countdown (ms)
- Note-sync every 60s from Favorites: if Notes contain `{"max": 100.00}`, item becomes a LIVE target.

## Performance Tuning

- Uses `isProxy: true` in bid payload.
- Randomizes bid cents for first fire (e.g. `$50.37`) while respecting max cap.
- On “Bid too low”, retries once at `+1.00` if still `<= max`.

## Run

```bash
cp accounts.example.json accounts.json
npm install
npm run dev
```
