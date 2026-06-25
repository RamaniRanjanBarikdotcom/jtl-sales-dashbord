# JTL Sales Dashboard

Monorepo for JTL analytics:

- `backend` — NestJS API + ingest pipeline + PostgreSQL/Redis cache
- `web` — Next.js dashboard UI
- `sync-engine-dotnet` — .NET sync engine
- `apache` — reverse-proxy and security headers

## Quick Start

1. Create the backend env file:

```bash
cp backend/.env.example backend/.env
```

2. Fill the `CHANGE_ME_*` values in `backend/.env`. Docker Compose uses your online Postgres credentials from this file:

```env
PG_HOST=your-online-postgres-host
PG_SSL=true
REDIS_HOST=redis
```

3. Run:

```bash
docker compose up -d --build
```

4. Open:

- Frontend: `http://localhost:3000/jtl-app/dashboard`
- Backend health: `http://localhost:3001/api/healthz`
- Swagger: `http://localhost:3001/api/docs`

Redis uses a Compose-managed local volume (`backend_redis_data`). Postgres is external/online and is not started by Docker Compose.

## Tests

Production Docker images intentionally omit dev dependencies. Use the dedicated test compose image when running Jest/Vitest:

```bash
make test-backend
make test-web
make test-all
```

## Production Quick Start

1. Create `backend/.env.production` from the safe template:

```bash
cp backend/.env.production.example backend/.env.production
```

2. Fill all `CHANGE_ME_*` values.
3. Run:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Production uses `apache/httpd.prod.conf` as the reverse proxy.

## Secret Rotation

Generate fresh production secrets:

```bash
cd backend
npm run secrets:generate
```

Update these values in your deployment platform:

- `PG_PASSWORD`
- `REDIS_PASSWORD`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `SUPER_ADMIN_PASSWORD`

The backend now blocks startup in `NODE_ENV=production` if weak/default secrets are detected.

## Remove Env Files From Git History

`.env` files are ignored, but if they were committed previously, rewrite history once:

```bash
./scripts/purge-env-history.sh --yes
git push --force --all
git push --force --tags
```

This should be coordinated with all collaborators because it rewrites commit history.

## API

- Base prefix: `/api`
- Versioning: header-based via `x-api-version` (default `1`)
- Swagger docs: `/api/docs`

## Health Endpoint

Public liveness:

```http
GET /api/healthz
GET /api/health
```

Detailed admin diagnostics:

```http
GET /api/admin/health
Authorization: Bearer <admin JWT>
```

Admin diagnostics contain:

- service status (`ok`/`degraded`)
- PostgreSQL check + cache mode
- data-integrity checks (tenant/connection consistency + required order fields)
- tenant sync/activity overview

Use `/api/healthz` for container health checks.

## Feature Status

- Machine-readable feature inventory: `JTL_Dashboard_Features.csv`
- Human-readable implementation summary: `FEATURE_STATUS.md`

## PgBouncer Templates

Real PgBouncer config files are ignored because they contain secrets. Use:

- `pgbouncer/pgbouncer.ini.example`
- `pgbouncer/userlist.txt.example`

## Materialized Views

Materialized views are refreshed in two ways:

1. on ingest completion for relevant modules
2. by backend scheduler (`MATVIEW_REFRESH_INTERVAL_MINUTES`, default `30`)

Set `MATVIEW_REFRESH_INTERVAL_MINUTES=0` to disable scheduled refresh.
