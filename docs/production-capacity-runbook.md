# Production Capacity Runbook

1. Capture 7-14 days of CPU, memory, PID, disk, inode, Redis, PostgreSQL, queue, and API latency telemetry.
2. Exercise ingest, bounded exports, Sales, Products, Inventory, Compare, and marketplace workers at expected concurrency.
3. Record p50/p95/p99 latency, database locks/temp files, cache keys/memory, queue depth/AOF growth, and container peaks.
4. Set warning thresholds below hard limits and verify alert delivery.
5. Introduce CPU, memory, PID, and Node heap limits one service at a time with at least 30% headroom over measured peaks.
6. Verify graceful degradation, worker retry behavior, materialized-view lock skipping, and export bounds.
7. Roll back by restoring prior Compose limits/image configuration; do not delete volumes or caches as part of rollback.

Disk alerts should warn at 80% and become critical at 90% for both bytes and inodes. Queue Redis/AOF capacity applies only when marketplace workers are enabled.
