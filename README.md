# Project GoodWillHunting

High-performance, multi-account, API-injection Sovereign Engine for ShopGoodwill.

## The Logos (Backend Engine)

- **Headless Node.js only** (no Puppeteer, Playwright, or Selenium).
- **Networking:** `undici` HTTP/1.1 for direct API traffic, including `/api/Auction/PlaceBid`.
- **Server-time sync:** startup offset computed from the ShopGoodwill `Date` header using a HEAD request.
- **Precision execution:** `process.hrtime()` nanosecond final-spin with worker-thread `Atomics.wait` support in final 5s.
- **Berkland window:** pre-warm at **T-10s**, fire proxy bid at **T-2.5s**.

## Multi-Account Sovereignty

- `accounts.json` stores account credentials.
- `sessions.json` stores JWT snapshots for all accounts.
- Token pool checks/refreshes every **15 minutes**, with JWT expiry-aware refresh logic.
- If outbid, alternate connected accounts in the token pool can counter-fire immediately.

## Note Syncing & Snipe Rules

- Favorites sync runs every **30 seconds**.
- Notes parser expects JSON like: `{"max": 150.00, "step": 1.00}`.
- `max` defines cap, `step` defines increment for retries/counter-bids.
- First fire randomizes cents (e.g., `$50.37`) to avoid round-number proxy walls.

## Maat Dashboard

- Dark-mode Tailwind single-page dashboard.
- Real-time Battle Map: Item ID, Account, assignment override, current price, countdown(ms), status.
- WebSocket Maa Kheru stream format:
  - `[ITEM ID] | [ACCOUNT] | [STATUS]`
