# Project Horus-Multi-Snipe

Headless, API-first, multi-account ShopGoodwill sniper engine built in TypeScript.

## Mission Compliance

- **Engine:** Node.js headless runtime, no UI layers.
- **Network:** `undici` Agent-based HTTP/1.1 calls.
- **Concurrency:** `p-queue` for high-throughput snipe execution.
- **Multi-account:** Reads `accounts.json`, logs in all accounts at startup.
- **Token refresh:** Re-authenticates all sessions every 30 minutes.
- **Dynamic targeting:** Favorites note JSON `{"max":100}` marks a live target.
- **NTP sync:** Startup offset from `pool.ntp.org` for corrected timing.
- **Execution windows:**
  - pre-warm bid endpoint at **T-10s**,
  - fire bid at **T-2.8s**,
  - retry once (+$1) when bid is too low if still `<= max`.
- **Final 5s OPSEC:** No countdown logs during the critical final 5-second window.
- **High-load timing:** switches to worker-thread + `Atomics.wait` timing path when tracking >50 auctions.

## Accounts

Copy `accounts.example.json` to `accounts.json` and fill credentials:

```json
[
  {
    "id": "AccountA",
    "username": "email-or-username",
    "password": "password"
  }
]
```

## Run

```bash
npm install
npm run dev
```

Optional environment variables:

- `SGW_BASE_URL` (default `https://buyerapi.shopgoodwill.com`)
- `SGW_UA` (default Chrome/Windows User-Agent)
- `SGW_POLL_MS` (default `60000`)
- `SGW_MAX_SNIPES` (default `80`)
