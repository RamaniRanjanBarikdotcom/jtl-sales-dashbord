# Reliability Optimization Report

## Implemented Safely

- Fail-closed schema capability detection for canonical and marketplace schemas.
- Pure legacy SQL and ingest when schema 19 is incomplete.
- Canonical cache namespace includes mode and resolution version.
- Source platform is distinct from canonical marketplace in supported schemas.
- Marketplace feedback routes require schema 21.
- Docker `json-file` rotation is capped at five 10 MiB files per container.
- Filesystem capacity, inode pressure, process memory/resources, and Redis cardinality/memory are available in detailed health.
- Materialized-view refresh uses one dedicated PostgreSQL session and an advisory lock.
- Startup materialized-view refresh and startup order repair writes were removed.
- Operational retention SQL supports read-only preview, tenant scope, bounded batches, and `SKIP LOCKED`; execution remains unapproved.
- Critical Product, Inventory, and Customer queries no longer inject false zero placeholder KPI data.
- React Query stale times and visibility-aware inventory polling reduce repeated load.
- CI includes legacy, canonical, marketplace-disabled, and marketplace-enabled database profiles.

## Intentionally Deferred

- Production resource limits and Node heap limits pending representative capacity data.
- Retention execution pending approved legal/customer policy.
- Canonical rule activation and historical backfill.
- Production deploy/restart and production load testing.
