# Expense Ingest Tracker (free local MVP)

This is a simple expense tracker where you can **send a WhatsApp/SMS-like message** (for now via a web form / API), and it will:
- parse the amount + optional category + note
- store it in a database (SQLite for local dev, Postgres/Supabase for hosting)
- show your expenses + totals in a small web UI

This version is **100% free** to run locally.

## What counts as a message?
Examples:
- `spent 250 chai`
- `food 499 swiggy`
- `uber 180`
- `+1200 rent`
- `250 groceries`

## Run locally

```zsh
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:3000

## Deploy (recommended): Vercel for frontend + separate API host

If you host the API, prefer Postgres (e.g., Supabase) by setting `DATABASE_URL`.
Then you can deploy the Vite frontend on Vercel and point it at your API.

> Note: SQLite (`better-sqlite3`) works great locally, but it’s not a good fit for serverless deployments where filesystem writes aren’t persistent.

### Frontend (Vercel)
This repo includes a Vite vanilla frontend under `client/`.

1) Build locally (optional):
- `npm run build:client`

2) On Vercel, set:
- Build command: `npm run build:client`
- Output directory: `dist-client`

3) Set environment variable on Vercel:
- `VITE_API_BASE_URL=https://YOUR_API_HOST`

## Protect your data (recommended before hosting)

This app has **no user accounts** yet. If you deploy it publicly, anyone who can reach the URL could hit your `/api/*` routes.

### Quick protection: single API key (good for single-user)

Set an environment variable on your API host:

- `APP_API_KEY=some-long-random-string`

When set, the server requires the key for all `/api/*` and `/webhook/*` routes.

Send it either as:

- `x-api-key: <key>`
- or `Authorization: Bearer <key>`

The web UI has a **Settings → Access key** field that stores the key locally in your browser and automatically sends it on requests.

### Later (multi-user)

When you want multiple users, the next step is adding real auth (Supabase Auth / Clerk / Auth.js) and storing `user_id` with each row.

### Backend API (Render/Railway/Fly/VPS)
Deploy the Node server and set `DB_PATH` to a persistent disk location.
The API must expose:
- `/api/*`
- `/webhook/whatsapp`

## API quick test

- `POST /api/ingest-message` with JSON: `{ "text": "food 250 chai" }`
- `GET /api/expenses`
- `GET /api/summary`

### Plain-text ack (useful for webhook providers)
If you want a simple text response instead of JSON, call ingest with:
- `POST /api/ingest-message?format=text`

or send `Accept: text/plain`.

## WhatsApp webhook adapter (best-effort, provider-agnostic)
`POST /webhook/whatsapp`

This endpoint accepts a few common WhatsApp/SMS provider payload shapes and maps them into our ingest logic.
It returns a **plain-text** acknowledgement by default.

It supports:
- `{ "text": "food 250 chai", "from": "+123" }`
- `{ "Body": "food 250 chai", "From": "+123" }` (Twilio-style fields)
- A minimal Meta-style nested payload (if present under `entry[0].changes[0].value.messages[0].text.body`).

### Meta Cloud API webhook verification (GET)
Meta verifies your callback URL via:

`GET /webhook/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`

Set this in your `.env`:
- `WHATSAPP_VERIFY_TOKEN=...` (must match what you configure in Meta)

If it matches, the server replies with the `hub.challenge` value (plain text).

### Optional signature check (POST)
If you set:
- `WHATSAPP_APP_SECRET=...`

Then `POST /webhook/whatsapp` will require `X-Hub-Signature-256: sha256=...`.

Note: for perfect signature verification you normally verify against the *raw* request body. This MVP verifies against JSON-stringified body, which is good enough for dev/testing but may need tightening when you go production.

## Later: connect real WhatsApp/SMS
When you’re ready to go beyond “free + local”, you can plug a provider webhook into the same endpoint:
- Twilio SMS webhooks can be configured to POST the incoming message body.
- WhatsApp providers can do the same.

The only thing you’ll change is the adapter that maps provider fields (like `Body`, `From`) into our `{ text, from }` format.
