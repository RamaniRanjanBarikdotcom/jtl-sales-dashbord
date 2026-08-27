# Reliability Optimization Report

## Implemented Safely

- Fail-closed schema capability detection for canonical and marketplace schemas.
- Pure legacy SQL and ingest when schema 19 is incomplete.
- Canonical cache namespace includes mode and resolution version.
- Source platform is distinct from canonical marketplace in supported schemas.
- Marketplace feedback routes require schema 21.
- Docker `json-file` rotation is capped at five 10 MiB files per container.
- Filesystem capacity, inode pressure, process memory/resources, and Redis cardinality/memory are available in detailed health.
- Scheduled and ingest-triggered materialized-view refreshes use the same coordinator, dedicated PostgreSQL session, advisory lock, allowlist, and failure backoff.
- Startup materialized-view refresh and startup order repair writes were removed.
- Operational retention SQL supports read-only preview, tenant scope, bounded batches, and `SKIP LOCKED`; execution remains unapproved.
- Critical Sales, Product, Inventory, and Customer queries no longer inject false zero placeholder KPI data.
- Sales, Product, and Inventory React Query stale times use bounded caching and preserve previous successful data; visibility-aware inventory polling reduces repeated load.
- Full channel data is retained for the Sales channel list while the donut uses a compact Top-7-plus-Other projection.
- Compare includes an independent raw source-platform filter.
- Queue Redis has an explicit configurable memory ceiling with `noeviction`, and marketplace enqueue rejects excess waiting work with a retryable service-unavailable response.
- CI includes legacy, canonical, marketplace-disabled, and marketplace-enabled database profiles; each profile starts the API and submits a real order ingest.

## Intentionally Deferred

- Production resource limits and Node heap limits pending representative capacity data.
- Retention execution pending approved legal/customer policy.
- Canonical rule activation and historical backfill.
- Production deploy/restart and production load testing.
