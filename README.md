# Project GoodWillHunting

A high-performance, multi-account, API-only sniper dashboard for ShopGoodwill.

## Setup

1. Install **Node.js 20+**.
2. Install dependencies:

```bash
npm install
```

3. Create account file:

```bash
cp accounts.example.json accounts.json
```

4. Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Accounts

Create `accounts.json` in the project root:

```json
[
  {
    "id": "AccountA",
    "username": "your-username",
    "password": "your-password"
  }
]
```

## New Staged Workflow (Query → Set Max → Confirm)

1. Enter **Item ID or URL** in the **Query Item** input.
2. Review the item details once it appears in the Battle Map.
3. Enter your **Max Bid** for that row.
4. Click **Lock & Confirm** to authorize the automated 2.8s strike window.

### Status badges

- **UNCONFIRMED** (yellow): item queried, waiting for bid lock.
- **CONFIRMED** (green): lock complete, item is queued for execution.
- **ENDED** (red): auction has closed.

Only **CONFIRMED** items are eligible for background snipe execution.

## API notes

- Base API URL: `https://buyerapi.shopgoodwill.com/api/`
- Query endpoint used for item lookup: `/Auction/GetItemDetail`
- Requests include mandatory headers for buyerapi requests:
  - `Origin: https://www.shopgoodwill.com`
  - `Referer: https://www.shopgoodwill.com/`
  - `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36`
