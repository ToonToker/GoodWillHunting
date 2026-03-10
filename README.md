# Project Horus-Snipe

High-precision, API-first ShopGoodwill auction sniper in TypeScript.

## Features

- **Anchor (Auth):** Logs in via `POST /api/Login/ValidateUser`, stores JWT in `.secrets/sgw.jwt` with `0600` permissions.
- **Watcher (Polling):** Polls favorites every 60 seconds via `GET /api/Member/GetFavoriteItems`.
- **Veto (Audit):** Reads each favorite's notes field; a JSON payload like `{"max_bid":50}` marks a live target.
- **Execution (Snipe):**
  - warms bid connection at **T-10s**,
  - performs high-resolution wait,
  - fires `POST /api/Auction/PlaceBid` at **T-2.5s**,
  - retries once if rejected as "Bid too low" and still within `max_bid`.
- **Concurrency:** Tracks up to 20 active snipes.
- **Maa Kheru CLI:** `[Auction ID] | [Target Price] | [Time to Close] | [Status]`.

## Setup

```bash
npm install
```

### Required env vars

```bash
export SGW_USERNAME='your_username'
export SGW_PASSWORD='your_password'
```

### Optional env vars

- `SGW_MAX_SNIPES` (default: `20`, hard-capped to `20`)
- `SGW_POLL_MS` (default: `60000`; currently watcher runs at 60s cadence)
- `SGW_BASE_URL` (default: `https://buyerapi.shopgoodwill.com`)
- `SGW_UA` (custom User-Agent)

## Run

```bash
npm run dev
# or
npm run build && npm start
```
