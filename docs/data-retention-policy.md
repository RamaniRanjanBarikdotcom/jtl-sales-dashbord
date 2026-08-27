# Data Retention Policy

No production deletion is authorized by this document.

## Protected Business Data

Orders, order items, products, customers, inventory, raw canonical evidence, watermarks, failed batches, tenant configuration, permissions, and authentication data are excluded from automated retention.

## Candidate Operational Data

The code defines preview and bounded cleanup SQL for `sync_log`, `system_events`, `audit_logs`, `sync_runs`, and `sync_run_batches`. Every operation is tenant-scoped, age-scoped, bounded by a batch limit, ordered oldest-first, and uses `FOR UPDATE SKIP LOCKED`.

Before enabling deletion, approve retention days per table, legal/customer obligations, audit requirements, batch size, schedule, monitoring, and rollback/backup evidence. Run preview counts first and record an audit event for each executed batch.

Diagnostics, exports, and release packages require separate filesystem/object-storage lifecycle policies; active releases and rollback artifacts must never be deleted by age alone.
