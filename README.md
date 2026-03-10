# Project GoodWillHunting

A high-performance, multi-account, API-only sniper dashboard for ShopGoodwill.

## Setup

1. Install **Node.js 20+**.
2. Install required packages:

```bash
npm install undici express dotenv ws
```

3. Install project dependencies/lockfile:

```bash
npm install
```

4. Create account file:

```bash
cp accounts.example.json accounts.json
```

5. Start the app:

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

## Staged Workflow (Query → Display → Confirm)

1. Enter an Item ID (or ShopGoodwill item URL) in the **Query** bar.
2. Review item details in the **UNCONFIRMED** list/table row (title, current price, end time).
3. Input your **Max Bid**.
4. Click **Lock Snipe** to authorize the automated strike.

### Status badges

- **UNCONFIRMED** (yellow): query successful, waiting for max-bid lock.
- **CONFIRMED** (green): locked in and ready for strike.
- **ENDED** (red): auction completed.

Only **CONFIRMED** items are eligible for background snipe execution.

## API mapping (2026)

- Base API URL: `https://buyerapi.shopgoodwill.com/api/`
- Login endpoint: `/SignIn/Login`
- Query endpoint used for item lookup: `/Auction/GetItemDetail?itemId=[ID]`
- Requests include required WAF headers:
  - `Authority: buyerapi.shopgoodwill.com`
  - `Origin: https://www.shopgoodwill.com`
  - `Referer: https://www.shopgoodwill.com/`
  - `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`

## Precision behavior

- Clock sync is performed from the ShopGoodwill API `Date` header.
- Bid fire target is **exactly 2.5 seconds** before auction end time.
