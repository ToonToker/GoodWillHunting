# Project GoodWillHunting

A multi-account, API-only ShopGoodwill sniper with a staged **Query -> Display -> Lock** workflow.

## Setup

1. Install Node.js 20+.
2. Install required runtime packages:

```bash
npm install undici express dotenv ws
```

3. Install project dependencies:

```bash
npm install
```

4. Create credentials file:

```bash
cp accounts.example.json accounts.json
```

5. Start server:

```bash
npm run dev
```

Open: `http://localhost:3000`

## accounts.json

Put your credentials in `accounts.json`:

```json
[
  {
    "id": "AccountA",
    "username": "you@example.com",
    "password": "your-password"
  }
]
```

## Workflow (Query -> Display -> Lock)

1. Input credentials into `accounts.json`.
2. Start server.
3. Use the search bar to **Query** an item by **Item ID**.
4. Review details in the table (UNCONFIRMED).
5. Set **Max Bid** and click **LOCK** to authorize the snipe.

Only **CONFIRMED** rows are eligible for execution.

## API Mapping

- Base URL: `https://buyerapi.shopgoodwill.com/api/`
- Login: `POST /SignIn/Login`
  - Payload: `{ "userName": "...", "password": "...", "remember": false }`
- Query: `GET /Auction/GetItemDetail?itemId=[ID]`
- Bid: `POST /Auction/PlaceBid`

Required request headers on buyer API calls:
- Confirmation switch for token persistence: `SGW_LOGIN_PERSISTENCE_CONFIRMATION_SWITCH=true` (set to `false` to disable `sessions.json` token persistence).
- `Authority: buyerapi.shopgoodwill.com`
- `Content-Type: application/json`
- `Origin: https://www.shopgoodwill.com`
- `Referer: https://www.shopgoodwill.com/`
- `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`

## Precision

- Clock drift is synced from API `Date` header.
- Snipes are fired at **T-2.5 seconds** and only for **CONFIRMED** items.


## Verbose Diagnostic Layer

The server now emits high-visibility logs for auth/routing/api traces:

- `[AUTH-STATE]` current active session + token readiness on route changes.
- `[API-REQUEST]` full URL, method, and headers for login/API calls.
- `[API-RESPONSE]` status code and raw response body text.
- `[ROUTING]` from/to paths and final status code for API requests.
- `[WORKFLOW]` state-machine dispatch/block events (including no active session guards).

Snipe dispatch is blocked unless an active authenticated session exists.

- Client state refresh uses adaptive back-off when `activeSession` is false to reduce request spam and rate-limit pressure.
