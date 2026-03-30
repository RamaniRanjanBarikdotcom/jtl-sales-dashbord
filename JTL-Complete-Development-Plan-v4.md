# JTL Analytics Platform — Complete Development Plan
**Version:** 4.0 — Final · Production-Ready · Docker + No-Docker
**Date:** 2025
**For:** Development team / Claude Code / Cursor / Windsurf

---

## HOW TO USE THIS DOCUMENT

This is the single source of truth. Give this entire file to your developer or AI code editor.
Do not reference any previous plan documents — this one supersedes all of them.

Build in order: **Sync Engine → Backend → Frontend wiring → Deployment**.
Every section depends on the one before it.

---

## TABLE OF CONTENTS

| # | Section |
|---|---|
| 1 | System Architecture |
| 2 | Technology Stack |
| 3 | Three Repositories |
| 4 | Sync Engine (JTL Server) |
| 5 | Backend API (NestJS) |
| 6 | PostgreSQL Schema |
| 7 | Redis Cache Strategy |
| 8 | Authentication & RBAC |
| 9 | All API Endpoints |
| 10 | Frontend Integration |
| 11 | Deployment — Option A (Docker) |
| 12 | Deployment — Option B (No Docker) |
| 13 | Nginx Configuration |
| 14 | Environment Variables |
| 15 | Database Backup & Maintenance |
| 16 | Build Order |
| 17 | Testing Checklist |
| 18 | Common Mistakes |

---

## SECTION 1 — SYSTEM ARCHITECTURE

### Overview

```
╔══════════════════════════════════════════════════════╗
║  JTL OFFICE SERVER  (your existing server)           ║
║                                                      ║
║  ┌────────────────────────────────────────────────┐  ║
║  │  jtl-sync-engine  (Node.js + PM2)              │  ║
║  │                                                │  ║
║  │  • Reads JTL MS SQL on local LAN               │  ║
║  │  • Incremental pull every 15–60 min            │  ║
║  │  • Idle auto-sync after 30 min no activity     │  ║
║  │  • Batches rows, POSTs to Backend API          │  ║
║  └───────────────────┬────────────────────────────┘  ║
║                      │                               ║
║  ┌───────────────┐   │ reads (SELECT only)           ║
║  │ JTL MS SQL    │◄──┘                               ║
║  │ (eazybusiness)│                                   ║
║  └───────────────┘                                   ║
╚══════════════════════════════════════════════════════╝
               │
               │  HTTPS  POST /api/sync/ingest
               │  (internet or VPN — any network)
               ▼
╔══════════════════════════════════════════════════════╗
║  BACKEND SERVER  (any server — VPS / cloud / own)    ║
║  Runs with Docker OR without Docker — code identical ║
║                                                      ║
║  ┌────────────────────────────────────────────────┐  ║
║  │  NestJS API  (port 3001, internal only)        │  ║
║  │                                                │  ║
║  │  POST /api/sync/ingest  ← sync engine          │  ║
║  │  GET  /api/sales/*      ← dashboard users      │  ║
║  │  GET  /api/products/*                          │  ║
║  │  GET  /api/inventory/*                         │  ║
║  │  GET  /api/marketing/*                         │  ║
║  │  POST /api/auth/*                              │  ║
║  │  *    /api/admin/*                             │  ║
║  └──────────────┬─────────────────────────────────┘  ║
║                 │                                    ║
║  ┌──────────────▼──────────┐  ┌──────────────────┐  ║
║  │  PostgreSQL 16           │  │  Redis 7          │  ║
║  │  partitioned tables      │  │  API cache        │  ║
║  │  materialized views      │  │  5–30 min TTL     │  ║
║  └─────────────────────────┘  └──────────────────┘  ║
║                                                      ║
║  ┌────────────────────────────────────────────────┐  ║
║  │  PgBouncer  (port 6432, internal only)         │  ║
║  │  connection pool — NestJS → PgBouncer → PG     │  ║
║  └────────────────────────────────────────────────┘  ║
║                                                      ║
║  ┌────────────────────────────────────────────────┐  ║
║  │  Next.js Frontend  (port 3000, internal only)  │  ║
║  │  Sales · Products · Inventory · Marketing      │  ║
║  └────────────────────────────────────────────────┘  ║
║                                                      ║
║  ┌────────────────────────────────────────────────┐  ║
║  │  Nginx  (ports 80 + 443 — only public ports)   │  ║
║  │  /api/* → NestJS:3001                          │  ║
║  │  /*     → Next.js:3000                         │  ║
║  └────────────────────────────────────────────────┘  ║
╚══════════════════════════════════════════════════════╝
               │
               │  HTTPS port 443
               ▼
        20+ dashboard users
```

### Core Rules
1. The sync engine NEVER connects to PostgreSQL or Redis directly. It only POSTs to the backend API.
2. PostgreSQL, Redis, PgBouncer are NEVER exposed to the internet. Internal only.
3. Only Nginx faces the internet on ports 80 and 443.
4. Every database row has a `tenant_id`. Tenants never see each other's data.
5. The backend code is identical whether Docker is used or not — only `.env` values differ.

---

## SECTION 2 — TECHNOLOGY STACK

| Layer | Technology | Version |
|---|---|---|
| Sync Engine | Node.js + TypeScript | Node 20 LTS |
| Backend Framework | NestJS | 10.x |
| Frontend Framework | Next.js App Router | 14.x |
| Language | TypeScript | 5.x strict |
| Primary Database | PostgreSQL | 16.x |
| Connection Pool | PgBouncer | latest |
| Cache | Redis | 7.x |
| ORM | TypeORM | 0.3.x |
| Auth | JWT RS256 + bcrypt | passport-jwt |
| HTTP Client (sync) | Axios | latest |
| Process Manager | PM2 | latest |
| Reverse Proxy | Nginx | 1.25 |
| SSL | Let's Encrypt (Certbot) | free |
| Containerisation | Docker + Compose | optional |

---

## SECTION 3 — THREE REPOSITORIES

The project is split into three separate Git repositories.

```
jtl-sync-engine/       → runs on JTL office server
jtl-analytics-backend/ → runs on backend server
jtl-analytics-frontend/→ built and served from backend server
```

### Repository: jtl-sync-engine

```
jtl-sync-engine/
├── src/
│   ├── main.ts                      entry point, starts scheduler
│   ├── scheduler.ts                 all cron jobs + idle watcher
│   ├── config.ts                    reads .env, exports typed config
│   │
│   ├── mssql/
│   │   ├── connection.ts            creates + manages node-mssql pool
│   │   └── queries/
│   │       ├── orders.query.ts      SELECT from tBestellung + tBestellPos
│   │       ├── products.query.ts    SELECT from tArtikel + tKategorie
│   │       ├── customers.query.ts   SELECT from tKunde + tRechnungsadresse
│   │       └── inventory.query.ts   SELECT from tWarenLagerBestand
│   │
│   ├── extractors/
│   │   ├── base.extractor.ts        watermark read/write, logging
│   │   ├── orders.extractor.ts
│   │   ├── products.extractor.ts
│   │   ├── customers.extractor.ts
│   │   └── inventory.extractor.ts
│   │
│   ├── sender/
│   │   ├── api-client.ts            axios instance, auth header, retry
│   │   └── ingest.sender.ts         batches rows, POSTs to backend
│   │
│   └── utils/
│       ├── logger.ts                winston file + console logger
│       ├── watermark.ts             read/write JSON watermark files
│       └── activity-checker.ts      polls /api/health for idle detection
│
├── watermarks/                      JSON files, one per module
│   ├── orders.json                  { "lastSyncTime": "ISO date" }
│   ├── products.json
│   ├── customers.json
│   └── inventory.json
│
├── logs/                            auto-created by logger
├── package.json
├── tsconfig.json
├── ecosystem.config.js              PM2 config
└── .env
```

### Repository: jtl-analytics-backend

```
jtl-analytics-backend/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   │
│   ├── config/
│   │   ├── app.config.ts
│   │   ├── database.config.ts
│   │   ├── redis.config.ts
│   │   └── jwt.config.ts
│   │
│   ├── database/
│   │   ├── database.module.ts
│   │   └── migrations/
│   │
│   ├── entities/
│   │   ├── tenant.entity.ts
│   │   ├── tenant-connection.entity.ts
│   │   ├── user.entity.ts
│   │   ├── order.entity.ts
│   │   ├── order-item.entity.ts
│   │   ├── product.entity.ts
│   │   ├── category.entity.ts
│   │   ├── customer.entity.ts
│   │   ├── inventory.entity.ts
│   │   ├── marketing-campaign.entity.ts
│   │   ├── marketing-metric.entity.ts
│   │   ├── sync-log.entity.ts
│   │   ├── sync-watermark.entity.ts
│   │   └── revoked-token.entity.ts
│   │
│   ├── common/
│   │   ├── decorators/
│   │   │   ├── roles.decorator.ts
│   │   │   ├── current-user.decorator.ts
│   │   │   └── current-tenant.decorator.ts
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts
│   │   ├── interceptors/
│   │   │   ├── response-transform.interceptor.ts
│   │   │   └── activity.interceptor.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   ├── roles.guard.ts
│   │   │   └── tenant-isolation.guard.ts
│   │   ├── pipes/
│   │   │   └── validation.pipe.ts
│   │   ├── utils/
│   │   │   ├── encryption.ts         AES-256-GCM for future use
│   │   │   └── masking.ts            field masking by user level
│   │   └── dto/
│   │       └── query-filters.dto.ts
│   │
│   ├── cache/
│   │   ├── cache.module.ts
│   │   ├── cache.service.ts
│   │   └── cache.interceptor.ts
│   │
│   ├── activity/
│   │   ├── activity.module.ts
│   │   └── activity.service.ts
│   │
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   └── strategies/
│   │       ├── jwt.strategy.ts
│   │       └── jwt-refresh.strategy.ts
│   │
│   ├── ingest/
│   │   ├── ingest.module.ts
│   │   ├── ingest.controller.ts
│   │   ├── ingest.service.ts
│   │   ├── ingest.guard.ts
│   │   ├── transformers/
│   │   │   ├── orders.transformer.ts
│   │   │   ├── products.transformer.ts
│   │   │   ├── customers.transformer.ts
│   │   │   ├── inventory.transformer.ts
│   │   │   └── region.transformer.ts
│   │   ├── loaders/
│   │   │   ├── base.loader.ts
│   │   │   ├── orders.loader.ts
│   │   │   ├── products.loader.ts
│   │   │   ├── customers.loader.ts
│   │   │   └── inventory.loader.ts
│   │   └── matviews/
│   │       └── matview-refresher.ts
│   │
│   └── modules/
│       ├── sales/
│       │   ├── sales.module.ts
│       │   ├── sales.controller.ts
│       │   └── sales.service.ts
│       ├── products/
│       │   ├── products.module.ts
│       │   ├── products.controller.ts
│       │   └── products.service.ts
│       ├── inventory/
│       │   ├── inventory.module.ts
│       │   ├── inventory.controller.ts
│       │   └── inventory.service.ts
│       ├── marketing/
│       │   ├── marketing.module.ts
│       │   ├── marketing.controller.ts
│       │   └── marketing.service.ts
│       └── admin/
│           ├── admin.module.ts
│           ├── admin.controller.ts
│           └── admin.service.ts
│
├── init-db/                         SQL files, run once on first DB start
│   ├── 01-extensions.sql            uuid-ossp, pgcrypto
│   ├── 02-tables.sql                all tables
│   ├── 03-partitions.sql            orders_2022 through orders_future
│   ├── 04-indexes.sql               all indexes
│   ├── 05-matviews.sql              all materialized views + refresh function
│   └── 06-seed.sql                  empty (seed done via npm run seed)
│
├── nginx/
│   └── nginx.conf                   used by Docker option
│
├── scripts/
│   ├── seed.ts                      creates super_admin + test tenant
│   └── rotate-sync-key.ts           rotates SYNC_API_KEY for a tenant
│
├── package.json
├── tsconfig.json
├── .env                             not committed — copy from .env.example
├── .env.example
├── ecosystem.config.js              PM2 config (no-Docker option)
├── Dockerfile                       NestJS container image
└── docker-compose.yml               full stack (Docker option)
```

### Repository: jtl-analytics-frontend
Already built (your v2 design). Changes needed: replace mock data with real API calls, add Inventory tab, add admin pages. Refer to the frontend plan document for details.

---

## SECTION 4 — SYNC ENGINE

### Dependencies (package.json)
```json
{
  "dependencies": {
    "mssql": "^10.0.0",
    "axios": "^1.6.0",
    "node-cron": "^3.0.0",
    "dotenv": "^16.0.0",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "@types/mssql": "^9.0.0",
    "@types/node-cron": "^3.0.0",
    "ts-node": "^10.9.0"
  }
}
```

### .env
```
# JTL MS SQL — local office LAN
MSSQL_HOST=192.168.1.x
MSSQL_PORT=1433
MSSQL_DATABASE=eazybusiness
MSSQL_USER=jtl_analytics_reader
MSSQL_PASSWORD=your-readonly-password
MSSQL_POOL_MAX=3
MSSQL_TIMEOUT_MS=30000

# Backend API
BACKEND_API_URL=https://yourdomain.com
SYNC_API_KEY=long-random-secret-from-backend-admin-panel
TENANT_ID=uuid-of-this-tenant

# Cron schedules
SYNC_ORDERS_CRON=*/15 * * * *
SYNC_INVENTORY_CRON=*/30 * * * *
SYNC_PRODUCTS_CRON=5 * * * *
SYNC_CUSTOMERS_CRON=0 * * * *
FULL_RESYNC_CRON=0 3 * * 0

# Idle sync
IDLE_THRESHOLD_MINUTES=30
IDLE_CHECK_INTERVAL_MINUTES=5
BATCH_SIZE=500
```

### How the sync engine works

**Step 1 — Scheduler fires** (e.g. orders cron every 15 min)

**Step 2 — Extractor reads watermark**
Read `watermarks/orders.json` → `{ "lastSyncTime": "2025-03-18T10:00:00Z" }`

**Step 3 — Query JTL MS SQL (incremental)**

Orders query:
```sql
SELECT b.kBestellung, b.cBestellNr, b.dErstellt, b.kKunde,
       b.fGesamtsumme, b.fVersandkostenNetto, b.cStatus, b.dGeaendert,
       p.cKurzbezeichnung AS channel_name
FROM tBestellung b
LEFT JOIN tPlattform p ON p.kPlattform = b.kPlattform
WHERE b.dGeaendert >= @lastSyncTime
  AND b.dGeaendert < @syncEndTime
ORDER BY b.dGeaendert ASC
OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY
```

Order items query (for each batch of order IDs):
```sql
SELECT p.kBestellPos, p.kBestellung, p.kArtikel, p.nAnzahl,
       p.fVKPreis, p.fVKPreisNetto, p.fEKPreis, p.nRabatt, p.cName
FROM tBestellPos p
WHERE p.kBestellung IN (@orderIds)
```

Products query (incremental):
```sql
SELECT a.kArtikel, a.cArtNr, a.cName, a.fEKNetto, a.fVKNetto,
       a.fVKBrutto, a.fGewicht, a.cBarcode,
       a.dErstellt, a.dLetzteAktualisierung,
       k.kKategorie, k.cName AS category_name
FROM tArtikel a
LEFT JOIN tArtikelKategorie ak ON ak.kArtikel = a.kArtikel
LEFT JOIN tKategorie k ON k.kKategorie = ak.kKategorie
WHERE a.dLetzteAktualisierung >= @lastSyncTime
   OR a.dErstellt >= @lastSyncTime
```

Customers query (incremental):
```sql
SELECT k.kKunde, k.cMail, k.cVorname, k.cNachname, k.cFirma,
       r.cPLZ, r.cOrt, r.cLand, k.dErstellt, k.dLetzteAenderung
FROM tKunde k
LEFT JOIN tRechnungsadresse r ON r.kKunde = k.kKunde
WHERE k.dLetzteAenderung >= @lastSyncTime
```

Inventory query (full refresh every time — no modified date):
```sql
SELECT wb.kArtikel, wb.kWarenLager, w.cName AS warehouse_name,
       wb.fVerfuegbar, wb.fReserviert, wb.fGesamt, wb.fMindestbestand
FROM tWarenLagerBestand wb
JOIN tWarenLager w ON w.kWarenLager = wb.kWarenLager
WHERE wb.fGesamt > 0 OR wb.fVerfuegbar > 0
```

**Step 4 — Batch and POST to backend**
```
POST https://yourdomain.com/api/sync/ingest
Authorization: Bearer <SYNC_API_KEY>
Content-Type: application/json

{
  "module": "orders",
  "tenantId": "uuid",
  "batchIndex": 0,
  "totalBatches": 10,
  "syncStartTime": "2025-03-18T10:15:00Z",
  "watermarkTime": "2025-03-18T10:00:00Z",
  "rows": [ ...500 raw JTL rows... ]
}
```

**Step 5 — Backend responds**
```json
{ "success": true, "received": 500, "inserted": 312, "updated": 188 }
```

**Step 6 — After last batch, update watermark**
Write `watermarks/orders.json` → `{ "lastSyncTime": "2025-03-18T10:14:30Z" }`

**Step 7 — Retry logic**
If backend is unreachable: retry 3 times (5s, 15s, 45s backoff).
After 3 failures: log error to `logs/failed-batches/`, continue to next scheduled sync.
Never block — a failed batch should not prevent the next cron from running.

### Idle sync logic (activity-checker.ts)

Every `IDLE_CHECK_INTERVAL_MINUTES` (5 min):
1. GET `https://yourdomain.com/api/health`
2. Read `tenants[0].last_dashboard_activity` from response
3. If `NOW - last_dashboard_activity > IDLE_THRESHOLD_MINUTES (30)`:
   AND `NOW - lastLocalSyncTime > 15 minutes`:
   → trigger a full sync of all modules
4. After idle sync completes, write current time to all watermark files

### PM2 config (ecosystem.config.js)
```javascript
module.exports = {
  apps: [{
    name: 'jtl-sync',
    script: './dist/main.js',
    instances: 1,            // MUST be 1 — cron must not run twice
    exec_mode: 'fork',       // NOT cluster
    env: { NODE_ENV: 'production' },
    max_memory_restart: '256M',
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    watch: false,
    autorestart: true,
    restart_delay: 10000,
  }]
};
```

### Install on JTL server

**Windows (most common for JTL):**
```
1. Install Node.js 20 LTS from nodejs.org
2. Open PowerShell as Administrator:
   npm install -g pm2 pm2-windows-startup
   pm2-startup install
3. Navigate to sync engine folder:
   npm install
   npx tsc
   pm2 start ecosystem.config.js
   pm2 save
```

**Linux (Ubuntu):**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs
sudo npm install -g pm2
pm2 startup | sudo bash  # run the outputted command
cd jtl-sync-engine
npm install && npx tsc
pm2 start ecosystem.config.js && pm2 save
```

---

## SECTION 5 — BACKEND API (NestJS)

### Dependencies (package.json)
```json
{
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/config": "^3.0.0",
    "@nestjs/typeorm": "^10.0.0",
    "@nestjs/jwt": "^10.0.0",
    "@nestjs/passport": "^10.0.0",
    "@nestjs/throttler": "^5.0.0",
    "@nestjs/swagger": "^7.0.0",
    "typeorm": "^0.3.0",
    "pg": "^8.11.0",
    "ioredis": "^5.3.0",
    "passport": "^0.6.0",
    "passport-jwt": "^4.0.0",
    "bcrypt": "^5.1.0",
    "helmet": "^7.0.0",
    "compression": "^1.7.0",
    "class-validator": "^0.14.0",
    "class-transformer": "^0.5.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "@types/bcrypt": "^5.0.0",
    "@types/passport-jwt": "^3.0.0",
    "@types/compression": "^1.7.0"
  }
}
```

### The ingest endpoint — most important

**POST /api/sync/ingest**

Authentication: `Authorization: Bearer <SYNC_API_KEY>` (not a user JWT)

Request body:
```typescript
{
  module:       'orders' | 'order_items' | 'products' | 'categories' | 'customers' | 'inventory'
  tenantId:     string   // UUID
  batchIndex:   number   // 0-based
  totalBatches: number
  syncStartTime: string  // ISO timestamp
  watermarkTime: string  // ISO timestamp (old watermark)
  rows:         any[]    // raw JTL field names — backend transforms these
}
```

What the backend does:
```
1. ingest.guard.ts: extract tenantId from body
                    look up tenant_connection for tenantId
                    bcrypt.compare(apiKey, stored_hash)
                    if no match → 401

2. ingest.service.ts:
   a. Verify tenant exists + is_active
   b. Call transformer for the module (orders, products, etc.)
      Transformer maps JTL field names → PostgreSQL column names
      Transformer calculates derived fields (region, RFM score, margins)
   c. Call loader for the module → upsert into PostgreSQL
   d. If this is the last batch (batchIndex === totalBatches - 1):
      - REFRESH MATERIALIZED VIEW CONCURRENTLY for affected matviews
      - invalidate Redis cache: del pattern jtl:{tenantId}:{module}:*
      - update sync_watermarks for this tenant + module
      - write sync_log row with status=ok, rows counts, duration

3. Return: { success: true, received, inserted, updated, batchIndex }
```

### Field transformations (transformer logic)

**orders.transformer.ts** — JTL → PostgreSQL
```
kBestellung       → jtl_order_id
cBestellNr        → order_number
dErstellt         → order_date
kKunde            → jtl_customer_id (joined to customer_id later)
fGesamtsumme      → gross_revenue
fGesamtsumme/1.19 → net_revenue (DE VAT 19% — use tenant.vat_rate)
fVersandkostenNetto → shipping_cost
cStatus           → status (mapped: Versandt→shipped, Storniert→cancelled, etc.)
dGeaendert        → jtl_modified_at
channel_name      → channel (normalized to lowercase)
```

JTL status → normalized status mapping:
```
Offen           → pending
In Bearbeitung  → processing
Versandt        → shipped
Abgeschlossen   → delivered
Storniert       → cancelled
Retour          → returned
```

**region.transformer.ts** — postcode → region
```
01–19  → North-East
20–29  → North
30–39  → Central-North
40–59  → West
60–69  → Central-West
70–79  → South-West
80–89  → South
90–99  → South-East
other  → International
```

**customers.transformer.ts** — derived fields
```
days_since_last_order = DATEDIFF(today, last_order_date)
rfm_score = calcRfmScore(days, order_count, ltv)
segment   = assignSegment(rfm_score, ltv)
```

RFM scoring:
```
Recency (R): ≤30 days=5, ≤90=4, ≤180=3, ≤365=2, else=1
Frequency (F): ≥20 orders=5, ≥10=4, ≥5=3, ≥2=2, else=1
Monetary (M): ≥€10K LTV=5, ≥€5K=4, ≥€2K=3, ≥€500=2, else=1
```

Segment assignment:
```
Recency=1         → Churned
Recency=2         → At-Risk
LTV≥€5K & R≥4    → VIP
LTV≥€1K & F≥3    → Regular
F=1 & R≥4        → New
else              → Casual
```

### Service pattern for all 4 dashboard modules

Every service method follows this exact pattern:
```typescript
async getKpis(tenantId: string, filters: QueryFiltersDto, userLevel: string) {
  const cacheKey = `jtl:${tenantId}:sales:kpis:${hashFilters(filters)}`;
  return this.cacheService.getOrSet(cacheKey, 300, async () => {
    const data = await this.dataSource
      .createQueryBuilder()
      .select([...])
      .from('mv_monthly_kpis', 'kpis')
      .where('kpis.tenant_id = :tenantId', { tenantId })
      .andWhere('kpis.year_month >= :start', { start: filters.startDate })
      .andWhere('kpis.year_month <= :end', { end: filters.endDate })
      .getRawMany();
    return applyFieldMasking(data, userLevel);
  });
}
```

### activity.interceptor.ts
Applied globally. On every authenticated request, calls:
```typescript
activityService.recordActivity(jwtPayload.tenantId)
// stores: Redis key `activity:{tenantId}` = Date.now()
```

### main.ts bootstrap
```typescript
app.use(helmet());
app.use(compression());
app.enableCors({ origin: process.env.FRONTEND_URL, credentials: true });
app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
app.useGlobalFilters(new HttpExceptionFilter());
app.useGlobalInterceptors(new ResponseTransformInterceptor());
app.setGlobalPrefix('api');
```

---

## SECTION 6 — POSTGRESQL SCHEMA

### Table: tenants
```
id              uuid PK default gen_random_uuid()
name            varchar(255) NOT NULL
slug            varchar(100) UNIQUE NOT NULL
is_active       boolean default true
timezone        varchar(50) default 'Europe/Berlin'
currency        varchar(3) default 'EUR'
vat_rate        numeric(5,4) default 0.19
created_at      timestamptz default now()
updated_at      timestamptz (auto-update)
created_by      uuid FK → users.id
```

### Table: tenant_connections
Stores the SYNC_API_KEY for authenticating ingest requests from the sync engine.
```
id                          uuid PK
tenant_id                   uuid FK → tenants.id UNIQUE
sync_api_key_hash           varchar(255) NOT NULL  (bcrypt hash of the key)
sync_api_key_prefix         varchar(10)            (first 8 chars, for display only)
sync_api_key_last_rotated   timestamptz
is_active                   boolean default true
last_ingest_at              timestamptz
last_ingest_module          varchar(50)
created_at                  timestamptz
```

### Table: users
```
id                      uuid PK default gen_random_uuid()
tenant_id               uuid FK → tenants.id  NULLABLE (null = super_admin)
email                   varchar(255) UNIQUE NOT NULL
password_hash           varchar(255) NOT NULL  (bcrypt 12 rounds)
full_name               varchar(255) NOT NULL
role                    varchar(20) CHECK IN ('super_admin','admin','user')
user_level              varchar(20) CHECK IN ('viewer','analyst','manager') NULLABLE
dept                    varchar(100)
is_active               boolean default true
must_change_pwd         boolean default true
failed_login_attempts   integer default 0
locked_until            timestamptz NULLABLE
last_login_at           timestamptz NULLABLE
created_by              uuid FK → users.id
created_at              timestamptz default now()
updated_at              timestamptz
INDEX on (tenant_id, role)
INDEX on email
```

### Table: sync_watermarks
```
id              bigserial PK
tenant_id       uuid FK → tenants.id NOT NULL
job_name        varchar(50) NOT NULL
last_synced_at  timestamptz NOT NULL
last_row_count  integer default 0
updated_at      timestamptz
UNIQUE (tenant_id, job_name)
```

### Table: sync_log
```
id              bigserial PK
tenant_id       uuid FK → tenants.id NOT NULL
job_name        varchar(50) NOT NULL
trigger_type    varchar(20) CHECK IN ('scheduled','idle','manual')
status          varchar(10) CHECK IN ('running','ok','warn','error')
rows_extracted  integer default 0
rows_inserted   integer default 0
rows_updated    integer default 0
duration_ms     integer
error_message   text NULLABLE
started_at      timestamptz NOT NULL
completed_at    timestamptz NULLABLE
INDEX on (tenant_id, started_at DESC)
```

### Table: orders  (PARTITIONED BY RANGE on order_date)
```
id                  bigserial
tenant_id           uuid NOT NULL
jtl_order_id        bigint NOT NULL
order_number        varchar(50)
order_date          date NOT NULL  ← partition key
customer_id         bigint NULLABLE
gross_revenue       numeric(12,2) NOT NULL
net_revenue         numeric(12,2)
shipping_cost       numeric(10,2)
cost_of_goods       numeric(12,2) NULLABLE
gross_margin        numeric(5,2) NULLABLE  (percentage)
status              varchar(30)
channel             varchar(50)
region              varchar(50)
postcode            varchar(10)
item_count          integer
jtl_modified_at     timestamptz
synced_at           timestamptz default now()
created_at          timestamptz default now()
updated_at          timestamptz

UNIQUE (tenant_id, jtl_order_id, order_date)
INDEX (tenant_id, order_date DESC)
INDEX (tenant_id, status, order_date DESC)
INDEX (tenant_id, channel, order_date DESC)
INDEX (tenant_id, region, order_date DESC)

Partitions:
  orders_2022  FOR VALUES FROM ('2022-01-01') TO ('2023-01-01')
  orders_2023  FOR VALUES FROM ('2023-01-01') TO ('2024-01-01')
  orders_2024  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01')
  orders_2025  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01')
  orders_2026  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01')
  orders_future FOR VALUES FROM ('2027-01-01') TO ('2099-01-01')
```

### Table: order_items
```
id                  bigserial PK
tenant_id           uuid NOT NULL
jtl_item_id         bigint NOT NULL
order_id            bigint FK → orders.id
product_id          bigint NULLABLE
quantity            numeric(10,3)
unit_price_gross    numeric(12,2)
unit_price_net      numeric(12,2)
unit_cost           numeric(12,2) NULLABLE
line_total_gross    numeric(12,2)
discount_pct        numeric(5,2) default 0
UNIQUE (tenant_id, jtl_item_id)
INDEX (tenant_id, order_id)
INDEX (tenant_id, product_id)
```

### Table: products
```
id                  bigserial PK
tenant_id           uuid NOT NULL
jtl_product_id      bigint NOT NULL
article_number      varchar(100)
name                varchar(500) NOT NULL
category_id         bigint NULLABLE
ean                 varchar(50)
unit_cost           numeric(12,2) NULLABLE  (fEKNetto)
list_price_net      numeric(12,2)           (fVKNetto)
list_price_gross    numeric(12,2)           (fVKBrutto)
is_active           boolean default true
weight_kg           numeric(8,3)
jtl_modified_at     timestamptz
synced_at           timestamptz default now()
updated_at          timestamptz
UNIQUE (tenant_id, jtl_product_id)
```

### Table: categories
```
id                  bigserial PK
tenant_id           uuid NOT NULL
jtl_category_id     bigint NOT NULL
name                varchar(500)
parent_id           bigint NULLABLE  (self-referencing FK)
level               integer default 1
UNIQUE (tenant_id, jtl_category_id)
```

### Table: customers
```
id                      bigserial PK
tenant_id               uuid NOT NULL
jtl_customer_id         bigint NOT NULL
email                   varchar(255)
first_name              varchar(255)
last_name               varchar(255)
company                 varchar(500) NULLABLE
postcode                varchar(10)
city                    varchar(255)
country_code            varchar(3) default 'DE'
region                  varchar(50)
total_orders            integer default 0
total_revenue           numeric(12,2) default 0
first_order_date        date
last_order_date         date
days_since_last_order   integer
ltv                     numeric(12,2) default 0
segment                 varchar(20)
rfm_score               varchar(3)
jtl_modified_at         timestamptz
synced_at               timestamptz default now()
updated_at              timestamptz
UNIQUE (tenant_id, jtl_customer_id)
```

### Table: inventory
```
id                  bigserial PK
tenant_id           uuid NOT NULL
jtl_product_id      bigint NOT NULL
jtl_warehouse_id    bigint NOT NULL
product_id          bigint NULLABLE
warehouse_name      varchar(255)
available           numeric(12,3) default 0
reserved            numeric(12,3) default 0
total               numeric(12,3) default 0
reorder_point       numeric(12,3) default 0
is_low_stock        boolean  (available <= reorder_point)
days_of_stock       integer NULLABLE
synced_at           timestamptz default now()
updated_at          timestamptz
UNIQUE (tenant_id, jtl_product_id, jtl_warehouse_id)
```

### Table: marketing_campaigns
```
id              bigserial PK
tenant_id       uuid NOT NULL
platform        varchar(20) CHECK IN ('google','meta','email','other')
external_id     varchar(100)
name            varchar(500)
status          varchar(20)
budget_daily    numeric(10,2)
synced_at       timestamptz
UNIQUE (tenant_id, platform, external_id)
```

### Table: marketing_metrics
```
id                  bigserial PK
tenant_id           uuid NOT NULL
campaign_id         bigint FK → marketing_campaigns.id
date                date NOT NULL
platform            varchar(20)
impressions         bigint default 0
clicks              bigint default 0
spend               numeric(10,2) default 0
conversions         integer default 0
conversion_value    numeric(12,2) default 0
cpc                 numeric(8,4)  GENERATED (spend / NULLIF(clicks,0))
cpa                 numeric(10,2) GENERATED (spend / NULLIF(conversions,0))
roas                numeric(8,4)  GENERATED (conversion_value / NULLIF(spend,0))
synced_at           timestamptz
UNIQUE (tenant_id, campaign_id, date)
```

### Table: revoked_tokens
```
jti         varchar(100) PK
revoked_at  timestamptz default now()
expires_at  timestamptz NOT NULL
INDEX on expires_at (for cleanup cron)
```

### Materialized Views

All have UNIQUE indexes (required for CONCURRENTLY refresh).
All include tenant_id in GROUP BY and UNIQUE index.

**mv_monthly_kpis**
```sql
SELECT
  tenant_id,
  DATE_TRUNC('month', order_date)::date AS year_month,
  COUNT(*) AS total_orders,
  SUM(gross_revenue) AS total_revenue,
  SUM(net_revenue) AS total_net_revenue,
  AVG(gross_revenue) AS avg_order_value,
  AVG(gross_margin) AS avg_margin_pct,
  COUNT(*) FILTER (WHERE status = 'returned') AS total_returns,
  ROUND(COUNT(*) FILTER (WHERE status = 'returned') * 100.0 / COUNT(*), 2) AS return_rate,
  COUNT(DISTINCT customer_id) AS unique_customers
FROM orders
WHERE status != 'cancelled'
GROUP BY tenant_id, DATE_TRUNC('month', order_date)::date;

UNIQUE INDEX ON mv_monthly_kpis (tenant_id, year_month);
```

**mv_product_performance**
```sql
SELECT
  o.tenant_id,
  oi.product_id,
  p.name AS product_name,
  p.article_number,
  c.name AS category_name,
  SUM(oi.line_total_gross) AS total_revenue,
  SUM(oi.quantity) AS total_units,
  AVG((oi.unit_price_net - oi.unit_cost) / NULLIF(oi.unit_price_net,0) * 100) AS margin_pct,
  COUNT(DISTINCT oi.order_id) AS order_count,
  COUNT(*) FILTER (WHERE ord.status = 'returned') AS return_count
FROM order_items oi
JOIN orders o ON oi.order_id = o.id
JOIN products p ON oi.product_id = p.id
LEFT JOIN categories c ON p.category_id = c.id
WHERE o.status != 'cancelled'
GROUP BY o.tenant_id, oi.product_id, p.name, p.article_number, c.name;

UNIQUE INDEX ON mv_product_performance (tenant_id, product_id);
```

**mv_daily_summary**
```sql
SELECT
  tenant_id,
  order_date AS summary_date,
  COUNT(*) AS total_orders,
  SUM(gross_revenue) AS total_revenue,
  AVG(gross_revenue) AS avg_order_value,
  COUNT(DISTINCT customer_id) AS unique_customers,
  COUNT(*) FILTER (WHERE status = 'returned') AS total_returns
FROM orders
WHERE status != 'cancelled'
GROUP BY tenant_id, order_date;

UNIQUE INDEX ON mv_daily_summary (tenant_id, summary_date);
```

**mv_inventory_summary**
```sql
SELECT
  i.tenant_id,
  i.product_id,
  p.name AS product_name,
  p.article_number,
  SUM(i.available) AS total_available,
  SUM(i.reserved) AS total_reserved,
  BOOL_OR(i.is_low_stock) AS is_low_stock,
  MIN(i.days_of_stock) AS days_of_stock
FROM inventory i
JOIN products p ON i.product_id = p.id
GROUP BY i.tenant_id, i.product_id, p.name, p.article_number;

UNIQUE INDEX ON mv_inventory_summary (tenant_id, product_id);
```

**mv_marketing_summary**
```sql
SELECT
  tenant_id,
  platform,
  DATE_TRUNC('month', date)::date AS month,
  SUM(spend) AS total_spend,
  SUM(conversion_value) AS total_revenue,
  SUM(clicks) AS total_clicks,
  SUM(conversions) AS total_conversions,
  ROUND(SUM(conversion_value) / NULLIF(SUM(spend),0), 4) AS roas,
  ROUND(SUM(spend) / NULLIF(SUM(clicks),0), 4) AS cpc
FROM marketing_metrics
GROUP BY tenant_id, platform, DATE_TRUNC('month', date)::date;

UNIQUE INDEX ON mv_marketing_summary (tenant_id, platform, month);
```

**Refresh function** (called by backend after every ingest last batch):
```sql
CREATE OR REPLACE FUNCTION refresh_all_matviews()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_kpis;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_performance;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_inventory_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_marketing_summary;
END;
$$;
```

---

## SECTION 7 — REDIS CACHE STRATEGY

### Key naming convention
```
jtl:{tenantId}:{module}:{endpoint}:{hash-of-query-params}

Examples:
  jtl:abc-uuid:sales:kpis:range=12M
  jtl:abc-uuid:products:list:range=3M:sort=revenue:page=1:limit=50
  jtl:abc-uuid:inventory:alerts:
```

### TTL per module
```
sales:kpis          300s  (5 min)
sales:daily         300s
sales:revenue       900s  (15 min)
sales:heatmap       1800s (30 min)
sales:channels      300s

products:kpis       900s
products:list       900s
products:categories 900s
products:top        900s

inventory:kpis      600s  (10 min)
inventory:list      600s
inventory:alerts    300s  (5 min — must be fresh)
inventory:movements 600s

marketing:kpis      1800s (30 min)
marketing:channels  1800s
marketing:campaigns 1800s
marketing:roas-trend 1800s

sync:status         60s   (1 min)
sync:logs           60s
```

### Invalidation after ingest
```
orders ingest  → invalidate jtl:{tenantId}:sales:*
products ingest → invalidate jtl:{tenantId}:products:*
inventory ingest → invalidate jtl:{tenantId}:inventory:*
marketing ingest → invalidate jtl:{tenantId}:marketing:*
```

---

## SECTION 8 — AUTHENTICATION & RBAC

### JWT Token Structure

**Access token** (15 min, stored in memory — never localStorage):
```json
{
  "sub": "user-uuid",
  "tenantId": "tenant-uuid",
  "role": "admin",
  "userLevel": "manager",
  "name": "Anna Schmidt",
  "jti": "unique-random-id",
  "isSuperAdmin": false,
  "mustChange": false,
  "exp": 1234567890
}
```
Notes: `tenantId` is null for super_admin. `userLevel` only set when role=user.

**Refresh token** (7 days, stored in httpOnly Secure SameSite=Strict cookie):
```json
{ "sub": "user-uuid", "jti": "different-unique-id", "exp": 1234567890 }
```

### Three roles

**super_admin**
- `tenantId = null`
- See data of ANY tenant (pass `?tenantId=` in admin endpoints)
- Create/deactivate tenants
- Create admin users
- Rotate any tenant's SYNC_API_KEY
- View platform-wide aggregated stats
- Only 1–3 accounts exist (seeded manually)

**admin** (one per company/tenant)
- `tenantId = their company UUID`
- All 4 dashboard tabs, all data unmasked
- Create/manage Users within their tenant only
- View sync status and logs for their tenant
- Cannot create another admin

**user** (end users within a tenant)
- `tenantId = their company UUID`
- `userLevel` controls field access:
  - `viewer`: all 4 tabs visible, sensitive fields null
  - `analyst`: all 4 tabs, all data visible
  - `manager`: all 4 tabs, all data, export enabled

### Field masking table

| Field | viewer | analyst | manager | admin | super_admin |
|---|---|---|---|---|---|
| Revenue, orders, dates | ✓ | ✓ | ✓ | ✓ | ✓ |
| gross_margin, margin_pct | null | ✓ | ✓ | ✓ | ✓ |
| unit_cost, cost_of_goods | null | ✓ | ✓ | ✓ | ✓ |
| marketing spend/ROAS/CPC | null | ✓ | ✓ | ✓ | ✓ |
| customer email | th•••@domain.com | ✓ | ✓ | ✓ | ✓ |
| customer full name | "Thomas M." | ✓ | ✓ | ✓ | ✓ |
| Export data button | hidden | hidden | shown | shown | shown |
| Sync status tab | hidden | hidden | hidden | shown | shown |
| Admin panel | hidden | hidden | hidden | shown (own tenant) | shown (all tenants) |

Masking is applied in `common/utils/masking.ts` and called in every service before returning data.
It is also enforced server-side — a viewer hitting the API directly gets masked data.

### auth.service.ts — key behaviors

**login(email, password):**
1. Look up user by email
2. Check is_active, check locked_until
3. bcrypt.compare(password, password_hash)
4. On fail: increment failed_login_attempts. At 5 fails: set locked_until = NOW + 15 min
5. On success: reset failed_login_attempts, set last_login_at
6. Issue access token (15 min) + refresh token (7 days in httpOnly cookie)
7. If must_change_pwd: include `mustChange: true` in access token

**refresh(refreshTokenFromCookie):**
1. Verify token signature + expiry
2. Check jti not in revoked_tokens table
3. Revoke old jti → insert into revoked_tokens
4. Issue new access token + new refresh token (rotation)

**logout(jti, exp):**
1. Insert jti into revoked_tokens with expires_at = token exp
2. Clear refresh cookie

**changePassword(userId, currentPwd, newPwd):**
1. Validate newPwd meets all 5 rules
2. Verify currentPwd against hash
3. bcrypt hash newPwd with 12 rounds
4. Update user: password_hash, must_change_pwd = false
5. Revoke current access token jti
6. Issue new access token without mustChange flag

**Password rules** (enforced both backend and frontend):
```
1. Minimum 8 characters
2. At least one uppercase letter
3. At least one lowercase letter
4. At least one number
5. At least one special character: ! @ # $ % ^ & *
```

---

## SECTION 9 — ALL API ENDPOINTS

### Ingest (sync engine → backend)
```
POST   /api/sync/ingest
  Auth:   Bearer SYNC_API_KEY (not user JWT)
  Body:   { module, tenantId, batchIndex, totalBatches, syncStartTime, watermarkTime, rows }
  Access: sync engine only (validated by ingest.guard.ts)
```

### Auth
```
POST   /api/auth/login              Public
POST   /api/auth/refresh            Public (reads refresh cookie)
POST   /api/auth/logout             Authenticated
GET    /api/auth/me                 Authenticated
PATCH  /api/auth/change-password    Authenticated
```

### Sales  (all: authenticated, tenant-scoped, viewer masking applied)
```
GET    /api/sales/kpis              ?range= &from= &to= &channel= &region=
GET    /api/sales/revenue           ?range=
GET    /api/sales/daily             ?range=
GET    /api/sales/heatmap           ?range=
GET    /api/sales/channels          ?range=
```

### Products  (all: authenticated, tenant-scoped)
```
GET    /api/products/kpis           ?range=
GET    /api/products                ?range= &sort= &order= &page= &limit= &search= &category=
GET    /api/products/categories     ?range=
GET    /api/products/top            ?range= &limit=
```

### Inventory  (all: authenticated, tenant-scoped)
```
GET    /api/inventory/kpis
GET    /api/inventory               ?search= &page= &limit=
GET    /api/inventory/alerts
GET    /api/inventory/movements     ?range=
```

### Marketing  (authenticated, viewer gets masked fields)
```
GET    /api/marketing/kpis          ?range= &platform=
GET    /api/marketing/channels      ?range=
GET    /api/marketing/campaigns     ?range= &platform= &page= &limit=
GET    /api/marketing/roas-trend    ?range=
```

### Sync status  (admin and super_admin only)
```
GET    /api/sync/status
GET    /api/sync/logs               ?page= &limit=
POST   /api/sync/rotate-key         super_admin or admin (own tenant)
```

### Admin — User management
```
GET    /api/admin/users             admin: own tenant | super_admin: ?tenantId= or all
POST   /api/admin/users             body: { email, full_name, role, user_level, dept }
                                    admin can only create role='user'
PATCH  /api/admin/users/:id         body: { full_name, user_level, dept, is_active }
PATCH  /api/admin/users/:id/deactivate
POST   /api/admin/users/:id/reset-pwd   sets must_change_pwd=true
```

### Admin — Tenant management (super_admin only)
```
GET    /api/admin/tenants
POST   /api/admin/tenants           body: { name, slug, timezone, currency, vat_rate }
                                    creates tenant + first admin user + SYNC_API_KEY
PATCH  /api/admin/tenants/:id
PATCH  /api/admin/tenants/:id/deactivate
GET    /api/admin/tenants/:id/sync-key  returns SYNC_API_KEY (plaintext, shown once)
POST   /api/admin/tenants/:id/rotate-sync-key  generates new key, invalidates old
GET    /api/admin/platform/overview  aggregate stats across all tenants
```

### Health
```
GET    /api/health                  Public
Response:
{
  "status": "ok",
  "version": "4.0.0",
  "uptime_seconds": 7200,
  "checks": {
    "postgres": { "status": "ok", "response_ms": 2 },
    "redis":    { "status": "ok", "response_ms": 1 }
  },
  "tenants": [
    {
      "tenantId": "uuid",
      "last_dashboard_activity": "ISO timestamp",  ← read by sync engine for idle detection
      "last_ingest_at": "ISO timestamp",
      "last_ingest_module": "orders"
    }
  ]
}
```

### Standard response envelope (all endpoints)
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "generated_at": "ISO timestamp",
    "cache_hit": true,
    "query_ms": 3,
    "total": 1842,
    "page": 1,
    "limit": 50,
    "range": "12M"
  }
}
```

Error response:
```json
{
  "success": false,
  "error": "Unauthorized",
  "code": "TOKEN_EXPIRED",
  "statusCode": 401
}
```

Special error codes:
```
MUST_CHANGE_PASSWORD — 403, frontend redirects to password change
ACCOUNT_LOCKED       — 423, includes locked_until timestamp
TENANT_INACTIVE      — 403, tenant deactivated
INVALID_SYNC_KEY     — 401, on ingest endpoint
```

---

## SECTION 10 — FRONTEND INTEGRATION

### What already exists (your v2 dashboard)
- Login screen with animated particles background
- Force password change screen with strength meter
- Dashboard shell: sidebar, topbar, ticker, user menu, sync status dot
- Sales tab: KPI cards, revenue chart, orders/returns, heatmap, daily chart
- Products tab: sortable table, category pie, margin bar
- Marketing tab: channel table, ROAS trend
- Customers tab (to be removed from scope or kept)
- Design system: dark theme (#04060f), Playfair Display, Outfit, IBM Plex Mono

### What needs to be added to the frontend

**1. Inventory tab** (does not exist yet)
```
Row 1: 4 KPI cards — Total SKUs, Low Stock Count, Total Inventory Value, Avg Days of Stock
Row 2: Alerts table (auto-refetch every 5 min) — products with is_low_stock=true
Row 3: 2 columns — Stock Movements area chart | Inventory turnover bar chart
```

**2. Real API calls** (replace all mock data)
Replace every `const MONTHLY = [...]` with a TanStack Query hook:
```typescript
// hooks/useSalesData.ts
export function useSalesKpis() {
  const filters = useFilterStore();
  return useQuery({
    queryKey: ['sales', 'kpis', filters.range, filters.from, filters.to],
    queryFn: () => api.get('/sales/kpis', { params: filters.toParams() }),
    staleTime: 5 * 60 * 1000,
  });
}
```

**3. Admin pages** (new routes)
```
/dashboard/admin/users     — CRUD table for users in this tenant (admin only)
/dashboard/admin/settings  — tenant settings, sync status (admin only)
/dashboard/super-admin     — tenant list, create tenant, platform stats (super_admin only)
```

**4. Zustand stores**
```typescript
// store/authStore.ts
{
  token: string | null        // in memory ONLY — never localStorage
  user: JwtPayload | null
  isAuthenticated: boolean
  setToken(token): void
  logout(): void
}

// store/filterStore.ts
{
  range: '7D'|'30D'|'3M'|'6M'|'12M'|'YTD'|'custom'
  from?: string
  to?: string
  setRange(r): void
  toParams(): URLSearchParams
}
```

**5. Axios instance** (lib/api.ts)
```typescript
const api = axios.create({ baseURL: process.env.NEXT_PUBLIC_API_URL });

// Request interceptor: add Authorization header from authStore token
api.interceptors.request.use(config => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor: on 401, refresh token then retry
api.interceptors.response.use(null, async error => {
  if (error.response?.status === 401 && !error.config._retry) {
    error.config._retry = true;
    const { data } = await axios.post('/api/auth/refresh', {}, { withCredentials: true });
    useAuthStore.getState().setToken(data.data.accessToken);
    error.config.headers.Authorization = `Bearer ${data.data.accessToken}`;
    return api(error.config);
  }
  return Promise.reject(error);
});
```

**6. next.config.ts** — required for standalone mode
```typescript
const config = {
  output: 'standalone',
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.NEXT_PUBLIC_API_URL}/:path*` }];
  }
};
```

---

## SECTION 11 — DEPLOYMENT OPTION A (WITH DOCKER)

Use this if Docker is installed on the backend server.

### Prerequisites
```bash
# Ubuntu 22.04
sudo apt update && sudo apt install -y curl git
curl -fsSL https://get.docker.com | bash
sudo usermod -aG docker $USER   # then logout and login again
docker --version                 # verify
```

### docker-compose.yml
```yaml
version: '3.9'

networks:
  jtl-net:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16

volumes:
  postgres_data:
  redis_data:
  nginx_certs:

services:

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: jtl_analytics
      POSTGRES_USER: jtl_api
      POSTGRES_PASSWORD: ${PG_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-db:/docker-entrypoint-initdb.d:ro
    networks: [jtl-net]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U jtl_api -d jtl_analytics"]
      interval: 10s
      timeout: 5s
      retries: 5
    # NOT exposed to host — internal only

  pgbouncer:
    image: edoburu/pgbouncer:latest
    restart: unless-stopped
    environment:
      DB_USER: jtl_api
      DB_PASSWORD: ${PG_PASSWORD}
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: jtl_analytics
      POOL_MODE: transaction
      MAX_CLIENT_CONN: 200
      DEFAULT_POOL_SIZE: 20
      MIN_POOL_SIZE: 5
    networks: [jtl-net]
    depends_on:
      postgres:
        condition: service_healthy

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD}
      --maxmemory 2gb
      --maxmemory-policy allkeys-lru
      --appendonly yes
    volumes:
      - redis_data:/data
    networks: [jtl-net]
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      retries: 3

  nestjs-api:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file: .env
    environment:
      NODE_ENV: production
      PORT: 3001
      PG_HOST: pgbouncer
      PG_PORT: 5432
      REDIS_HOST: redis
      REDIS_PORT: 6379
    networks: [jtl-net]
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    expose:
      - "3001"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:3001/api/health || exit 1"]
      interval: 30s
      retries: 3

  nextjs-frontend:
    build:
      context: ../jtl-analytics-frontend
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: 3000
      HOSTNAME: 0.0.0.0
      NEXT_PUBLIC_API_URL: https://${DOMAIN}/api
    networks: [jtl-net]
    expose:
      - "3000"
    depends_on:
      nestjs-api:
        condition: service_healthy

  nginx:
    image: nginx:1.25-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - nginx_certs:/etc/letsencrypt:ro
    networks: [jtl-net]
    depends_on:
      - nestjs-api
      - nextjs-frontend
```

### Dockerfile (NestJS backend)
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
EXPOSE 3001
USER node
CMD ["node", "dist/main.js"]
```

### Dockerfile (Next.js frontend)
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
USER node
CMD ["node", "server.js"]
```

### First-time deploy with Docker
```bash
# 1. Clone repo
git clone <repo> jtl-analytics-backend
cd jtl-analytics-backend

# 2. Copy and fill .env
cp .env.example .env
nano .env    # fill all values

# 3. Get SSL cert BEFORE starting Nginx
sudo apt install -y certbot
sudo certbot certonly --standalone -d yourdomain.com
# certs go to /etc/letsencrypt/live/yourdomain.com/

# 4. Start all services
docker compose up -d

# 5. Run migrations and seed
docker compose exec nestjs-api npm run migration:run
docker compose exec nestjs-api npm run seed

# 6. Verify
docker compose ps
curl https://yourdomain.com/api/health
```

### Update deploy with Docker
```bash
git pull
docker compose build nestjs-api nextjs-frontend
docker compose up -d --no-deps nestjs-api nextjs-frontend
docker compose exec nestjs-api npm run migration:run
docker compose ps
```

---

## SECTION 12 — DEPLOYMENT OPTION B (WITHOUT DOCKER)

Use this if Docker is NOT available. Everything installs directly on Ubuntu 22.04.

### Step 1 — Initial server setup
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git htop ufw fail2ban unzip build-essential

# Create deploy user
sudo adduser deploy
sudo usermod -aG sudo deploy

# Firewall — ONLY open 22, 80, 443
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# Timezone
sudo timedatectl set-timezone Europe/Berlin
```

### Step 2 — Install Node.js 20 + PM2
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
su - deploy
pm2 startup systemd -u deploy --hp /home/deploy
# Run the command it outputs
```

### Step 3 — Install PostgreSQL 16
```bash
sudo apt install -y gnupg2
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | \
  sudo gpg --dearmor -o /usr/share/keyrings/postgresql-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/postgresql-keyring.gpg] \
  http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | \
  sudo tee /etc/apt/sources.list.d/pgdg.list
sudo apt update && sudo apt install -y postgresql-16 postgresql-client-16

# Configure memory — edit /etc/postgresql/16/main/postgresql.conf
sudo nano /etc/postgresql/16/main/postgresql.conf
```

Key settings for 16GB RAM server:
```
shared_buffers = 4GB
effective_cache_size = 12GB
work_mem = 64MB
maintenance_work_mem = 1GB
max_connections = 100
listen_addresses = 'localhost'
random_page_cost = 1.1
```

```bash
sudo systemctl restart postgresql

# Create DB and users
sudo -u postgres psql <<EOF
CREATE DATABASE jtl_analytics;
CREATE USER jtl_api WITH PASSWORD 'strong-password-here';
GRANT ALL PRIVILEGES ON DATABASE jtl_analytics TO jtl_api;
\c jtl_analytics
GRANT ALL ON SCHEMA public TO jtl_api;
EOF
```

### Step 4 — Install PgBouncer
```bash
sudo apt install -y pgbouncer

# Edit /etc/pgbouncer/pgbouncer.ini
sudo nano /etc/pgbouncer/pgbouncer.ini
```
```ini
[databases]
jtl_analytics = host=127.0.0.1 port=5432 dbname=jtl_analytics

[pgbouncer]
listen_addr = 127.0.0.1
listen_port = 6432
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 200
default_pool_size = 20
min_pool_size = 5
```

```bash
# Edit /etc/pgbouncer/userlist.txt
echo '"jtl_api" "strong-password-here"' | sudo tee /etc/pgbouncer/userlist.txt

sudo systemctl enable pgbouncer
sudo systemctl start pgbouncer

# Test
psql -h 127.0.0.1 -p 6432 -U jtl_api -d jtl_analytics -c "SELECT 1"
```

### Step 5 — Install Redis 7
```bash
sudo apt install -y redis-server

# Edit /etc/redis/redis.conf
sudo nano /etc/redis/redis.conf
```
Key changes:
```
bind 127.0.0.1
requirepass your-redis-password
maxmemory 2gb
maxmemory-policy allkeys-lru
appendonly yes
```

```bash
sudo systemctl enable redis-server
sudo systemctl restart redis-server

# Test
redis-cli -a your-redis-password ping   # should return PONG
```

### Step 6 — Install Nginx + SSL
```bash
sudo apt install -y nginx certbot python3-certbot-nginx

# Get SSL cert first (Nginx must be stopped)
sudo systemctl stop nginx
sudo certbot certonly --standalone -d yourdomain.com
sudo systemctl start nginx

# Create site config
sudo nano /etc/nginx/sites-available/jtl-analytics
# (paste the nginx config from Section 13)

sudo ln -s /etc/nginx/sites-available/jtl-analytics /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### Step 7 — Deploy NestJS backend
```bash
su - deploy
git clone <repo> /home/deploy/jtl-analytics-backend
cd /home/deploy/jtl-analytics-backend
npm install
cp .env.example .env
nano .env   # fill all values (use 127.0.0.1 for PG_HOST and REDIS_HOST)
npm run build
npm run migration:run
npm run seed
pm2 start ecosystem.config.js
pm2 save
pm2 status   # verify jtl-api is online
```

### Step 8 — Deploy Next.js frontend
```bash
git clone <repo> /home/deploy/jtl-analytics-frontend
cd /home/deploy/jtl-analytics-frontend
npm install
cat > .env.local <<EOF
NEXT_PUBLIC_API_URL=https://yourdomain.com/api
EOF
npm run build
# Copy static files for standalone mode
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
pm2 start ecosystem.config.js
pm2 save
pm2 status   # verify jtl-frontend is online
```

### PM2 config for no-Docker

**jtl-analytics-backend/ecosystem.config.js:**
```javascript
module.exports = {
  apps: [{
    name: 'jtl-api',
    script: './dist/main.js',
    instances: 2,           // 2 workers for 4-core server, 4 for 8-core
    exec_mode: 'cluster',
    env: { NODE_ENV: 'production', PORT: 3001 },
    max_memory_restart: '1G',
    error_file: '/home/deploy/logs/api-error.log',
    out_file: '/home/deploy/logs/api-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    watch: false,
    autorestart: true,
    restart_delay: 5000,
  }]
};
```

**jtl-analytics-frontend/ecosystem.config.js:**
```javascript
module.exports = {
  apps: [{
    name: 'jtl-frontend',
    script: '.next/standalone/server.js',
    instances: 1,
    env: { NODE_ENV: 'production', PORT: 3000, HOSTNAME: '127.0.0.1' },
    max_memory_restart: '512M',
    error_file: '/home/deploy/logs/frontend-error.log',
    out_file: '/home/deploy/logs/frontend-out.log',
    watch: false,
    autorestart: true,
  }]
};
```

### Update deploy without Docker
```bash
cd /home/deploy/jtl-analytics-backend
git pull && npm install && npm run build
npm run migration:run   # only if migrations changed
pm2 reload jtl-api

cd /home/deploy/jtl-analytics-frontend
git pull && npm install && npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
pm2 reload jtl-frontend
```

---

## SECTION 13 — NGINX CONFIGURATION

Same config for both Docker and no-Docker. Only the proxy_pass addresses differ (commented inline).

```nginx
limit_req_zone $binary_remote_addr zone=api:10m    rate=60r/m;
limit_req_zone $binary_remote_addr zone=login:10m  rate=5r/m;
limit_req_zone $binary_remote_addr zone=ingest:10m rate=30r/m;

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    # SSL
    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;

    # Security headers
    add_header Strict-Transport-Security  "max-age=63072000; includeSubDomains" always;
    add_header X-Frame-Options            DENY;
    add_header X-Content-Type-Options     nosniff;
    add_header X-XSS-Protection          "1; mode=block";
    add_header Referrer-Policy            "strict-origin-when-cross-origin";

    # Gzip
    gzip on;
    gzip_types application/json text/css application/javascript application/xml;
    gzip_min_length 1000;

    # Ingest endpoint (sync engine) — higher rate limit
    location = /api/sync/ingest {
        limit_req zone=ingest burst=10 nodelay;
        proxy_pass         http://127.0.0.1:3001;   # no-Docker
        # proxy_pass       http://nestjs-api:3001;   # Docker
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_read_timeout 120s;   # large batches need more time
        client_max_body_size 10M;  # 500 rows can be ~5MB
    }

    # Login — strict rate limit
    location = /api/auth/login {
        limit_req zone=login burst=3 nodelay;
        proxy_pass         http://127.0.0.1:3001;   # no-Docker
        # proxy_pass       http://nestjs-api:3001;   # Docker
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
    }

    # All other API routes
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass         http://127.0.0.1:3001;   # no-Docker
        # proxy_pass       http://nestjs-api:3001;   # Docker
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_read_timeout 60s;
    }

    # Frontend
    location / {
        proxy_pass         http://127.0.0.1:3000;   # no-Docker
        # proxy_pass       http://nextjs-frontend:3000;  # Docker
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host       $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Block internal endpoints
    location /api/metrics { deny all; return 404; }
}
```

---

## SECTION 14 — ENVIRONMENT VARIABLES

### Backend .env (same values for Docker and no-Docker — only host values differ)

```bash
# Application
PORT=3001
NODE_ENV=production
FRONTEND_URL=https://yourdomain.com

# Security
ENCRYPTION_KEY=           # openssl rand -hex 32  (32 bytes)

# JWT
JWT_SECRET=               # openssl rand -base64 64
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d

# PostgreSQL
# Docker: PG_HOST=pgbouncer
# No-Docker: PG_HOST=127.0.0.1
PG_HOST=pgbouncer
PG_PORT=5432              # Docker: 5432 (pgbouncer port inside network)
# PG_PORT=6432            # No-Docker: 6432 (pgbouncer port on localhost)
PG_DATABASE=jtl_analytics
PG_USER=jtl_api
PG_PASSWORD=              # strong password

# Redis
# Docker: REDIS_HOST=redis
# No-Docker: REDIS_HOST=127.0.0.1
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=           # strong password

# Idle sync settings
IDLE_SYNC_THRESHOLD_MINUTES=30
IDLE_CHECK_INTERVAL_MINUTES=5

# Super Admin (used only by npm run seed — change immediately after)
SUPER_ADMIN_EMAIL=superadmin@yourcompany.com
SUPER_ADMIN_PASSWORD=ChangeThisNow123!

# Docker only
DOMAIN=yourdomain.com
```

### Sync engine .env

```bash
# JTL MS SQL
MSSQL_HOST=192.168.1.x         # office LAN IP
MSSQL_PORT=1433
MSSQL_DATABASE=eazybusiness
MSSQL_USER=jtl_analytics_reader
MSSQL_PASSWORD=                 # readonly SQL user password
MSSQL_POOL_MAX=3
MSSQL_TIMEOUT_MS=30000

# Backend API
BACKEND_API_URL=https://yourdomain.com
SYNC_API_KEY=                   # get from super_admin panel after tenant created
TENANT_ID=                      # get from super_admin panel after tenant created

# Cron schedules
SYNC_ORDERS_CRON=*/15 * * * *
SYNC_INVENTORY_CRON=*/30 * * * *
SYNC_PRODUCTS_CRON=5 * * * *
SYNC_CUSTOMERS_CRON=0 * * * *
FULL_RESYNC_CRON=0 3 * * 0

# Idle sync
IDLE_THRESHOLD_MINUTES=30
IDLE_CHECK_INTERVAL_MINUTES=5
BATCH_SIZE=500
```

### Frontend .env.local

```bash
NEXT_PUBLIC_API_URL=https://yourdomain.com/api
NEXT_PUBLIC_APP_NAME=JTL Analytics
```

---

## SECTION 15 — BACKUP & MAINTENANCE

### Daily PostgreSQL backup
Create `/home/deploy/scripts/backup-postgres.sh`:
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
DIR="/home/deploy/backups/postgres"
mkdir -p $DIR

PGPASSWORD="strong-password-here" pg_dump \
  -h 127.0.0.1 -p 5432 -U jtl_api jtl_analytics \
  -Fc -f "$DIR/jtl_analytics_$DATE.dump"

# Keep 7 days
find $DIR -name "*.dump" -mtime +7 -delete
echo "[$(date)] Backup: jtl_analytics_$DATE.dump"
```

```bash
chmod +x /home/deploy/scripts/backup-postgres.sh
```

### Crontab (as deploy user)
```
crontab -e
```
Add:
```
# Daily backup at 01:00
0 1 * * * /home/deploy/scripts/backup-postgres.sh >> /home/deploy/logs/backup.log 2>&1

# Monthly SSL renewal check
0 3 1 * * certbot renew --quiet

# Daily cleanup of expired revoked_tokens
0 4 * * * psql -h 127.0.0.1 -p 5432 -U jtl_api jtl_analytics -c "DELETE FROM revoked_tokens WHERE expires_at < NOW();"

# December 1st every year — add next year's orders partition
0 9 1 12 * psql -h 127.0.0.1 -p 5432 -U jtl_api jtl_analytics -c "CREATE TABLE IF NOT EXISTS orders_NEXTYEAR PARTITION OF orders FOR VALUES FROM ('NEXTYEAR-01-01') TO ('NEXTYEAR2-01-01');"
```
Note: Update the December cron each year with the correct year values.

### Status check commands
```bash
# Docker option
docker compose ps
docker compose logs nestjs-api --tail=50
docker compose logs nextjs-frontend --tail=20
docker exec -it jtl-analytics-backend-postgres-1 psql -U jtl_api jtl_analytics -c "SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 10;"

# No-Docker option
pm2 status
pm2 logs jtl-api --lines 50
pm2 logs jtl-frontend --lines 20
systemctl status postgresql redis-server pgbouncer nginx
psql -h 127.0.0.1 -p 5432 -U jtl_api jtl_analytics -c "SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 10;"
```

---

## SECTION 16 — COMPLETE BUILD ORDER

Give this exact order to your AI code editor. Build one step, verify it works, then next step.

### PHASE 1 — Backend foundation (build first)

```
Step  1   Create jtl-analytics-backend/ folder, package.json, tsconfig.json, .env.example
Step  2   Install all dependencies (npm install)
Step  3   src/lib/types.ts — all TypeScript interfaces (Role, User, JwtPayload, etc.)
Step  4   src/lib/constants.ts — ROLES, TABS, field masking rules, password rules
Step  5   src/config/ — all 4 config files reading from .env
Step  6   src/entities/ — all 14 TypeORM entities (schema only, no methods)
Step  7   src/database/database.module.ts — TypeORM connection
Step  8   Write init-db/02-tables.sql, 03-partitions.sql, 04-indexes.sql, 05-matviews.sql
Step  9   Run npm run migration:run — verify all tables exist in PostgreSQL
Step 10   src/common/utils/masking.ts — applyFieldMasking()
Step 11   src/common/utils/encryption.ts — encrypt/decrypt (AES-256)
Step 12   src/common/dto/query-filters.dto.ts — with toDateRange() method
Step 13   src/common/filters/http-exception.filter.ts
Step 14   src/common/interceptors/response-transform.interceptor.ts
Step 15   src/common/interceptors/activity.interceptor.ts
Step 16   src/common/decorators/ — 3 decorators
Step 17   src/common/guards/ — jwt-auth, roles, tenant-isolation
Step 18   src/common/pipes/validation.pipe.ts
Step 19   src/cache/cache.service.ts + cache.module.ts + cache.interceptor.ts
Step 20   src/activity/activity.service.ts + activity.module.ts
```

### PHASE 2 — Auth

```
Step 21   src/auth/strategies/jwt.strategy.ts + jwt-refresh.strategy.ts
Step 22   src/auth/auth.service.ts — login, refresh, logout, changePassword
Step 23   src/auth/auth.controller.ts — all 5 endpoints
Step 24   src/auth/auth.module.ts
Step 25   scripts/seed.ts — creates super_admin user + test tenant + SYNC_API_KEY
Step 26   npm run seed — verify super_admin exists
Step 27   Test: POST /api/auth/login → get token → GET /api/auth/me → verify response
```

### PHASE 3 — Ingest endpoint (sync engine receiver)

```
Step 28   src/ingest/ingest.guard.ts — validates SYNC_API_KEY
Step 29   src/ingest/transformers/region.transformer.ts
Step 30   src/ingest/transformers/orders.transformer.ts
Step 31   src/ingest/transformers/products.transformer.ts
Step 32   src/ingest/transformers/customers.transformer.ts
Step 33   src/ingest/transformers/inventory.transformer.ts
Step 34   src/ingest/loaders/base.loader.ts — upsert helper
Step 35   src/ingest/loaders/orders.loader.ts
Step 36   src/ingest/loaders/products.loader.ts
Step 37   src/ingest/loaders/customers.loader.ts
Step 38   src/ingest/loaders/inventory.loader.ts
Step 39   src/ingest/matviews/matview-refresher.ts
Step 40   src/ingest/ingest.service.ts — orchestrates transform + load + refresh + cache clear
Step 41   src/ingest/ingest.controller.ts — POST /api/sync/ingest
Step 42   src/ingest/ingest.module.ts
Step 43   Test ingest with curl (see Section 9 test commands)
Step 44   Verify data appeared in PostgreSQL tables
Step 45   Verify matviews refreshed (SELECT COUNT(*) FROM mv_monthly_kpis)
```

### PHASE 4 — API modules (dashboard data)

```
Step 46   src/modules/sales/sales.service.ts + controller + module
Step 47   Test GET /api/sales/kpis with Admin JWT — verify data + correct response shape
Step 48   Test GET /api/sales/kpis with viewer JWT — verify margins are null
Step 49   src/modules/products/products.service.ts + controller + module
Step 50   src/modules/inventory/inventory.service.ts + controller + module
Step 51   src/modules/marketing/marketing.service.ts + controller + module
Step 52   src/modules/admin/admin.service.ts + controller + module
Step 53   src/app.module.ts — register all modules, global interceptors, global guards
Step 54   src/main.ts — bootstrap with helmet, CORS, throttler, global pipes
Step 55   GET /api/health — verify postgres + redis status + tenants activity block
```

### PHASE 5 — Sync engine

```
Step 56   Create jtl-sync-engine/ folder, package.json, tsconfig.json
Step 57   src/config.ts — reads .env
Step 58   src/utils/logger.ts — winston setup
Step 59   src/utils/watermark.ts — read/write JSON watermark files
Step 60   src/mssql/connection.ts — node-mssql pool
Step 61   src/mssql/queries/orders.query.ts
Step 62   src/mssql/queries/products.query.ts
Step 63   src/mssql/queries/customers.query.ts
Step 64   src/mssql/queries/inventory.query.ts
Step 65   src/extractors/base.extractor.ts
Step 66   src/extractors/orders.extractor.ts
Step 67   src/extractors/products.extractor.ts
Step 68   src/extractors/customers.extractor.ts
Step 69   src/extractors/inventory.extractor.ts
Step 70   src/sender/api-client.ts — axios with auth + retry
Step 71   src/sender/ingest.sender.ts — batch and POST logic
Step 72   src/utils/activity-checker.ts — polls /api/health for idle detection
Step 73   src/scheduler.ts — all cron jobs + idle watcher
Step 74   src/main.ts — starts scheduler
Step 75   Test with real JTL MS SQL (or mock data): run one manual sync
Step 76   Verify sync_log shows ok in backend database
Step 77   Deploy on JTL server with PM2
```

### PHASE 6 — Frontend wiring

```
Step 78   Add lib/api.ts — Axios instance with 401 interceptor
Step 79   Add store/authStore.ts — Zustand auth (memory-only token)
Step 80   Add store/filterStore.ts — Zustand filters
Step 81   Add hooks/useSalesData.ts — all sales TanStack Query hooks
Step 82   Add hooks/useProductsData.ts
Step 83   Add hooks/useInventoryData.ts
Step 84   Add hooks/useMarketingData.ts
Step 85   Wire Sales tab: replace all mock data with hooks
Step 86   Wire Products tab
Step 87   Wire Marketing tab
Step 88   Build Inventory tab (new) — wire with hooks
Step 89   Build admin pages: /dashboard/admin/users, /admin/settings
Step 90   Build super admin page: /dashboard/super-admin
Step 91   Test full flow: login → dashboard loads real data → sync runs → data updates
```

### PHASE 7 — Deploy

```
Step 92   Choose Option A (Docker) or Option B (no-Docker)
Step 93   Follow deployment steps in Section 11 or 12
Step 94   Run full test checklist (Section 17)
Step 95   Create all 4 test accounts (super_admin, admin, user-analyst, user-viewer)
Step 96   Verify role masking on all 4 accounts
Step 97   Configure backup cron
Step 98   Test backup restores correctly
Step 99   Monitor logs for first 48 hours
```

---

## SECTION 17 — TESTING CHECKLIST

Complete all checks before going live.

### Auth
- [ ] super_admin login → JWT contains tenantId=null, isSuperAdmin=true
- [ ] admin login → JWT contains correct tenantId
- [ ] user(viewer) login → JWT contains role=user, userLevel=viewer
- [ ] Wrong password → 401, failed_login_attempts incremented
- [ ] 5 wrong passwords → 423 ACCOUNT_LOCKED, locked_until set
- [ ] must_change_pwd=true → all endpoints return 403 MUST_CHANGE_PASSWORD
- [ ] Password change → must_change_pwd=false, new token issued
- [ ] Refresh token → new access token issued, old refresh revoked
- [ ] Logout → jti in revoked_tokens, refresh cookie cleared

### Multi-tenant isolation
- [ ] user from tenant A cannot read tenant B data (403)
- [ ] admin cannot see other tenants in /api/admin/tenants (403)
- [ ] super_admin CAN see all tenants
- [ ] admin can create users with role=user only
- [ ] admin cannot create role=admin (403)

### Field masking
- [ ] viewer: gross_margin = null in /api/sales/kpis
- [ ] viewer: unit_cost = null in /api/products
- [ ] viewer: spend = null in /api/marketing/kpis
- [ ] viewer: email is masked (th•••@domain.com)
- [ ] analyst: all fields visible, no masking
- [ ] admin: all fields visible

### Ingest endpoint
- [ ] Valid SYNC_API_KEY → 200 response
- [ ] Invalid key → 401
- [ ] Wrong tenantId → 401
- [ ] Last batch → matviews refreshed
- [ ] Last batch → Redis cache invalidated
- [ ] Last batch → sync_log row created with status=ok
- [ ] 500 rows batch processes without timeout

### Sync engine
- [ ] Watermark file exists after first sync
- [ ] Second sync only pulls rows changed since watermark
- [ ] Idle sync fires after 30 min no dashboard activity
- [ ] Failed backend request retries 3 times
- [ ] After 3 failures, engine continues (does not crash)

### API correctness
- [ ] All KPI deltas calculate correctly (current vs prior period)
- [ ] Date range filter works (?range=7D shows last 7 days only)
- [ ] Pagination works (page=2 returns different rows than page=1)
- [ ] Cache hit=true on second identical request
- [ ] Cache invalidated after sync (cache_hit=false after ingest)
- [ ] /api/health shows postgres + redis status

### Infrastructure
- [ ] HTTPS works (cert valid, HTTP redirects to HTTPS)
- [ ] PostgreSQL not reachable from internet (try: telnet yourdomain.com 5432 → fail)
- [ ] Redis not reachable from internet
- [ ] PM2 / Docker restarts services on crash
- [ ] Services restart on server reboot
- [ ] Backup script creates .dump file
- [ ] Backup older than 7 days is deleted

---

## SECTION 18 — COMMON MISTAKES

1. **Sync engine must NOT connect to PostgreSQL directly.** It only calls the backend API. If direct DB connection is used, you lose tenant isolation, transformation, and matview refresh.

2. **Never expose database ports.** PostgreSQL (5432), Redis (6379), PgBouncer (6432) must only be on localhost. UFW must block them from outside.

3. **Never store access tokens in localStorage or sessionStorage.** Token lives in Zustand memory only. On page refresh, the user re-authenticates via the httpOnly refresh cookie silently.

4. **Never skip bcrypt on SYNC_API_KEY.** Store only the hash. The plaintext key is shown once when created and never stored again.

5. **Never use PM2 cluster mode for the sync engine.** `instances: 1` and `exec_mode: 'fork'` — cron running twice causes duplicate data.

6. **Never use `REFRESH MATERIALIZED VIEW` without `CONCURRENTLY`.** Without it, all API reads block until refresh is done. All matviews must have UNIQUE indexes for CONCURRENTLY to work.

7. **Never query dashboard data directly from the base `orders` table in API services.** Always read from materialized views for aggregations. Direct table queries for large datasets will timeout at 1M+ orders.

8. **Never omit tenant_id from every WHERE clause.** Every single query against any business table must include `WHERE tenant_id = :tenantId`. Missing this leaks data between tenants.

9. **Never take tenantId from the request body or query params** for data queries. Always read from the JWT payload. The tenant-isolation.guard enforces this but services must also be explicit.

10. **Never commit .env files.** `.env` must be in `.gitignore`. Use `.env.example` with empty values as the template.

11. **Docker option: PG_HOST=pgbouncer, REDIS_HOST=redis.** No-Docker option: PG_HOST=127.0.0.1, REDIS_HOST=127.0.0.1. This is the only code difference between the two deployment options.

12. **Always run `npm run migration:run` after deploying backend updates** that include new entities or schema changes.

---

*End of JTL Analytics Platform — Complete Development Plan v4.0*
*Single source of truth. All previous plan documents are superseded by this one.*
*Architecture: Sync Engine (JTL server) → HTTPS API → Backend (any server, Docker or direct).*
