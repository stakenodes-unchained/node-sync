# Node Sync Checker

Multi-tenant blockchain node monitoring platform with account onboarding, package/billing flows, independent worker-based monitoring, and rich historical diagnostics.

## What It Does

- Monitors local vs remote RPC nodes and computes sync **Delta** (`remote_height - local_height`)
- Classifies health into `Healthy`, `Degrading`, `Out of Sync`, `Offline`, `Unknown`
- Tracks per-node **consecutive error count** (resets to `0` after a successful check)
- Stores rich history for each check (status codes, response times, payloads, headers, errors)
- Provides monitoring details UI with:
  - response trend chart
  - uptime metrics
  - event history with pagination
  - range filters (`1h`, `6h`, `12h`, `1d`, `7d`, custom)
- Supports account/profile and package lifecycle with Stripe billing:
  - Subscription mode (card/bank)
  - Manual monthly checkout mode
- Enforces lifecycle controls (grace/block/retention) in API access

## Architecture

### API Server

- `server.js`
- Handles auth, tenant-scoped APIs, billing webhooks, package/profile endpoints
- `GET /status` is **read-only snapshot** from persisted data (no live probing)

### Monitor Worker

- `monitor-worker.js`
- Runs independent polling loop by node `check_interval`
- Executes RPC checks and writes full telemetry into `node_status_history`
- Controlled by env variables for tick/timeout/response limits/log verbosity

### Database

- `database.js` with SQLite (`better-sqlite3`)
- Core tables include:
  - `users`, `tenants`, `memberships`
  - `subscriptions`, `payments`
  - `supported_chains`, `nodes`, `node_status_history`

## Quick Start

### 1) Setup

```bash
cp .env.example .env
npm install
npm run init-chains
```

### 2) Run Locally (API + Worker)

Terminal 1:

```bash
npm start
```

Terminal 2:

```bash
npm run start:worker
```

Open: `http://localhost:3000`

### 3) Run with Docker Compose

```bash
docker-compose up --build -d
```

Services:
- `sync-checker` (API)
- `monitor-worker` (independent monitor loop)

## Environment Variables

### Core

- `PORT` (default `3000`)
- `APP_BASE_URL` (default `http://localhost:3000`)
- `JWT_SECRET`

### Stripe Billing

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRO_SUBSCRIPTION_PRICE_ID` (recurring price ID)
- `STRIPE_PRO_ONE_TIME_PRICE_ID` (one-time price ID)

### Monitor Worker

- `MONITOR_WORKER_LOG_LEVEL` (`error|warn|info|debug`, default `info`)
- `MONITOR_WORKER_HEARTBEAT_EVERY_TICKS` (default `12`)
- `MONITOR_WORKER_TICK_MS` (default `5000`)
- `MONITOR_REQUEST_TIMEOUT_MS` (default `10000`)
- `MONITOR_MAX_RESPONSE_BYTES` (default `50000`)

## Stripe Sandbox Notes

1. Create two Stripe prices:
   - recurring monthly price for subscriptions
   - one-time price for manual monthly payment
2. Put their IDs in `.env`.
3. Forward webhooks:

```bash
stripe login
stripe listen --forward-to localhost:3000/billing/webhook
```

4. Use profile/package UI to test:
   - subscribe (card/bank)
   - manual monthly payment
   - resume/blocked lifecycle behavior

## Key API Endpoints

### Auth/Profile

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`

### Monitoring

- `GET /status` — latest persisted status snapshot for tenant nodes
- `GET /nodes/:id`
- `GET /nodes/:id/history?range=1h|6h|12h|1d|7d&page=1&limit=50`
- `GET /nodes/:id/history?range=custom&from=<iso>&to=<iso>&page=1&limit=50`

History response shape:

```json
{
  "items": [],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 123,
    "totalPages": 3,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

### Node CRUD

- `POST /add`
- `PUT /edit/:id`
- `DELETE /delete/:id`

### Chains

- `GET /chains`
- `POST /chains`
- `PUT /chains/:id`
- `DELETE /chains/:id`
- `POST /chains/sync`

### Billing

- `GET /billing/subscription`
- `GET /billing/verify-access`
- `POST /billing/checkout-session`
- `POST /billing/confirm-session`
- `POST /billing/portal`
- `POST /billing/webhook`

## Monitoring Details UX

In Node Details modal:

- response chart with legend and min/avg/max markers
- current and average response metrics
- uptime 24h/30d/1y
- event history table
- range filters + pagination
- DateTime is rendered in local time

## Scripts

- `npm start` — API server
- `npm run start:worker` — monitoring worker
- `npm run init-chains` — seed chain list
- `npm run init-chains-force` — reseed chains
- `npm run list-chains` — print chains

## File Structure (Core)

```text
node-sync/
├── server.js
├── monitor-worker.js
├── database.js
├── init-chains.js
├── chainListFetcher.js
├── public/
│   ├── index.html
│   └── frontend.js
├── docker-compose.yml
├── Dockerfile
├── package.json
└── README.md
```