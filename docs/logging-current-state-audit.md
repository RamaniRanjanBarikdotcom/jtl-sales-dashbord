# System Logs Current-State Audit

## Existing Sources Reused

| Source | Existing owner | Logs Centre treatment |
|---|---|---|
| Backend request logs | `backend/src/main.ts` | Existing application log remains; request/correlation IDs propagate to structured events where meaningful. |
| Security and admin audit | `AuditService` | Existing append-only audit records remain authoritative and are exposed through the audit tab. Selected real actions are mirrored to `system_events`. |
| Sync runs and batches | `sync_runs`, `sync_run_batches`, `sync_log` | Summary reads failed sync counts directly; event records link by `sync_run_id` when supplied. |
| Remote commands | `sync_commands`, `sync_command_events` | Command transitions emit controlled events linked by command and correlation IDs. |
| Agent heartbeat | `sync_agents` | Active/offline counts are calculated from real heartbeat timestamps; heartbeats are not persisted every 30 seconds as events. |
| Sync Engine local logs | `LogService` | Remain the local fallback when structured event delivery fails. |
| Inventory safety | Ingest/inventory pipeline | Existing real audit actions are retained; structured event taxonomy supports staged instrumentation. |
| Database/Redis health | Existing health/cache services | Existing service logs remain; controlled event types are registered for recovery-aware instrumentation. |

## Implemented in the Logs Centre

- Central recursive sanitizer with secret, JWT, infrastructure URL, raw ingest rows, and sensitive payment/address redaction.
- Bounded structured metadata and explicit truncation markers.
- Additive indexed `system_events` schema and immutable audit API.
- Tenant/global scope enforcement through the existing JWT, tenant-isolation, and membership-permission guards.
- Summary, events, event detail, related timeline, audit, security, source, export, and agent-event APIs.
- Server filtering, allowlisted sorting, default seven-day bound, maximum page size, and export row limits.
- Best-effort operational event persistence and durable audited export activity.
- Batched configurable retention with active-incident exclusion.
- Real Sync Engine/Windows Service transition events with version and Git SHA.
- Super Admin dashboard UI with summary, tabs, filters, live polling, pagination, detail drawer, related events, empty/unavailable/403 states, and export.

## Deliberately Not Duplicated

- No second audit database.
- No fake or generated frontend events.
- No heartbeat event written every 30 seconds.
- No raw ingest/request-body storage.
- No arbitrary event names, SQL, shell, or Windows command surface.
- No application API that updates or deletes individual audit records.

## External Production Verification

Docker deployment, real failed-login/tenant-switch/sync scenarios, Windows service disconnect/recovery, load targets, legal retention approval, and rollback rehearsal require the deployment environment. The repository contains the code paths and runbook, but does not claim those external checks were executed here.
