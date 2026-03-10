# Project GoodWillHunting

A high-performance, multi-account, API-only ShopGoodwill Sovereign Sniper Engine.

## THE DJED PILLAR (Setup)

1. Install **Node.js 20+**.
2. Install project dependencies:

```bash
npm install
```

## THE RITUAL (Running)

1. Create an `accounts.json` file in the project root (or copy from `accounts.example.json`) with your ShopGoodwill accounts:

```json
[
  {
    "id": "AccountA",
    "username": "your-username",
    "password": "your-password"
  }
]
```

2. Start the server:

```bash
npm run dev
```

3. Open the dashboard at:

```text
http://localhost:3000
```

## THE COMMAND (Usage)

Use the official ShopGoodwill website to heart/favorite items. Then, in the favorite item's **Notes** field, place JSON like:

```json
{"max": 100.00}
```

The engine syncs Favorites every 60 seconds. Any favorite with a valid `{"max": ...}` note becomes a LIVE target automatically and is queued for snipe timing.

## Engine Behavior (Logos)

- Headless Node.js runtime (API-only, no browser automation libs).
- `undici` HTTP/1.1 client for direct buyer API communication.
- `sessions.json` stores multi-account JWT snapshots.
- Token auto-refresh checks run every 20 minutes.
- Startup server-time offset sync via ShopGoodwill API `Date` header.
- Snipe flow:
  - Pre-warm at **T-10s**
  - Fire proxy bid at **T-2.8s**
