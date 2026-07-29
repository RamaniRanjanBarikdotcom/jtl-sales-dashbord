# Rollout and Rollback Runbook

1. Back up Postgres and apply migration 13.
2. Deploy backend with all new risky flags disabled.
3. Deploy the signed sync agent and verify heartbeat/status.
4. Assign granular membership permissions.
5. Enable System Logs, then command control, then sales Copilot in staging.
6. Monitor failures, latency, command leases, and tenant audit events.

Rollback by disabling the relevant flag first. The migration is additive, so application rollback does not require dropping tables. Retain data for investigation and remove schema only through a separately reviewed migration.
