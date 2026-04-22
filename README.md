# JTL Sales Dashboard

Monorepo for JTL analytics:

- `backend` — NestJS API + ingest pipeline + PostgreSQL/Redis cache
- `web` — Next.js dashboard UI
- `sync-engine-dotnet` — .NET sync engine
- `nginx` — reverse-proxy and security headers

## Quick Start

1. Set required env vars (`POSTGRES_PASSWORD`, `REDIS_PASSWORD`) or provide compose `.env`.
2. Run:

```bash
docker compose up -d --build
```

Named volumes are Compose-managed and auto-created (`backend_postgres_data`, `backend_redis_data`).

## Secret Rotation

Generate fresh production secrets:

```bash
cd backend
npm run secrets:generate
```

Update these values in your deployment platform:

- `POSTGRES_PASSWORD`
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

`GET /api/health`

Response contains:

- service status (`ok`/`degraded`)
- PostgreSQL and Redis checks with latency
- data-integrity checks (tenant/connection consistency + required order fields)
- tenant sync/activity overview

Use this endpoint for container health checks and operational monitoring.

## Materialized Views

Materialized views are refreshed in two ways:

1. on ingest completion for relevant modules
2. by backend scheduler (`MATVIEW_REFRESH_INTERVAL_MINUTES`, default `30`)

Set `MATVIEW_REFRESH_INTERVAL_MINUTES=0` to disable scheduled refresh.
