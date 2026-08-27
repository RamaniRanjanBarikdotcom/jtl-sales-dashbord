# Current Runtime Baseline

Collected locally on 2026-08-27 without restarting or modifying services.

| Service | State | CPU snapshot | Memory snapshot | PIDs |
|---|---|---:|---:|---:|
| NestJS API | healthy | 0.00% | 125.9 MiB | 11 |
| Next.js frontend | running | 0.00% | 30.56 MiB | 11 |
| Redis cache | healthy | 0.80% | 19.23 MiB | 6 |
| Queue Redis | disabled/not running | n/a | n/a | n/a |

Host data volume usage was 60% with approximately 82 GiB available and negligible inode pressure. Redis reported 1.22 MiB used, a 1.22 MiB peak, and a configured 512 MiB maximum. These are idle local snapshots, not production sizing evidence.

Docker stored 5.359 GB of images and 24.72 GB of build cache. No prune or deletion was run.

Resource limits are intentionally not selected from this idle sample. Production limits require peak traffic, export, ingest, marketplace-worker, and PostgreSQL latency measurements.
