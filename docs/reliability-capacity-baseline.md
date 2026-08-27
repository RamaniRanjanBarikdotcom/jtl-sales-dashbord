# Reliability Capacity Baseline

The current local baseline is recorded in `docs/current-runtime-baseline.md`.

## Measured

- Container CPU, memory, and PID snapshots.
- Host disk capacity and inode usage.
- Docker image, volume, and build-cache footprint.
- Redis used, peak, and configured maximum memory.
- PostgreSQL schema capability metadata.

## Not Yet Measured

- Production p50/p95/p99 API and query latency.
- Peak ingest and export memory.
- Concurrent Compare, Sales, Products, and Inventory load.
- Marketplace queue depth and AOF growth because queue workers are disabled locally.
- Production disk growth per day and retention impact.

No production CPU, memory, PID, or Node heap limits should be enabled until those measurements are captured under representative load.

Queue Redis now has a configurable `REDIS_QUEUE_MAXMEMORY` ceiling and `noeviction` policy. Marketplace producers enforce `MARKETPLACE_QUEUE_MAX_WAITING` before enqueue. These safeguards prevent silent eviction and unbounded waiting growth, but production values still require queue-depth, payload-size, AOF-growth, and drain-rate measurements.
