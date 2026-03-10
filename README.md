# Project GoodWillHunting

A high-performance, multi-account, API-ONLY Sovereign Sniper Engine for ShopGoodwill.

## SETUP

1. Install **Node.js 20+**.
2. Install dependencies (explicit command requested):

```bash
npm install undici express dotenv ws
```

3. Then install project dev/runtime lock set:

```bash
npm install
```

## ACCOUNTS

Create `accounts.json` in the project root:

```json
[
  {
    "id": "AccountA",
    "username": "your-username",
    "password": "your-password"
  },
  {
    "id": "AccountB",
    "username": "your-second-username",
    "password": "your-second-password"
  }
]
```

The engine stores active JWT snapshots in `sessions.json` and re-authenticates only when token expiry is detected.

## THE COMMAND

On the official ShopGoodwill site:

1. Heart/favorite the item.
2. Open the Favorite **Notes** field.
3. Enter JSON like:

```json
{"max": 100.00}
```

Optional stepped note format:

```json
{"max": 150.00, "step": 1.00}
```

Favorites are synced every 60 seconds. Any favorite with valid `max` note JSON becomes a LIVE target and is queued automatically.

## PRECISION ADVISORY

Operate the script with stable network and system load during the **Berkland Window** (final ~3 seconds):

- Startup clock offset is synced from ShopGoodwill API `Date` header.
- TLS/API pre-warm occurs at **T-10s**.
- Proxy bid is fired at **T-2.5s**.
- Final execution path uses `Atomics.wait` + `process.hrtime()` nanosecond spin to minimize drift.

## Quick Start

```bash
cp accounts.example.json accounts.json
npm run dev
```

Open `http://localhost:3000`.
