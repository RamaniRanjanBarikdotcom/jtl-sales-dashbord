# System Logs Centre Implementation Status

## Complete in Repository

| Plan area | Status | Evidence |
|---|---|---|
| Current-state audit | Complete | `docs/logging-current-state-audit.md` |
| Real-data-only policy | Complete | No mock event source; all UI rows come from protected APIs. |
| Event contract and taxonomy | Complete | Controlled types, sources, severities, numeric metrics, IDs, version/SHA, and sanitized metadata. |
| Database and indexes | Complete | Additive migration 13 passed the full isolated PostgreSQL initialization chain. |
| Correlation/request IDs | Complete | Headers are validated/generated, returned, persisted, and propagated to commands/events. |
| Sanitization | Complete | Recursive key/content redaction, raw ingest suppression, JWT/URL/card protection, size bounds, explicit truncation. |
| Non-blocking operations | Complete | Operational event failures return safely and continue local/application logging. |
| Permissions and isolation | Complete | JWT, tenant guard, membership permissions, exact tenant scope, Super Admin all-company scope. |
| Logs API | Complete | Summary, events, details, related, audit, security, sources, export, agent events. |
| Filters and pagination | Complete | Server filters, allowlisted sorting, seven-day default, 366-day maximum, 50 default/200 maximum page. |
| Summary | Complete | Events, real sync runs, and real heartbeat state. |
| Frontend | Complete | Navigation, six tabs, summary, filters, pagination, detail drawer, related timeline, states, export. |
| Live updates | Complete | 15-second configurable polling, background-tab pause, historical-range pause. |
| Export | Complete | Filtered bounded CSV/JSON service, dedicated permission/flag, requested/completed/failed audit records. |
| Retention | Complete | Configurable scheduler, severity policies, active-incident exclusion, 1,000-row batches, summary event. |
| Sync Engine integration | Complete | Best-effort structured transition events, registered-agent validation, version, Git SHA, local fallback. |
| Stack-trace policy | Complete | Sanitized and omitted from tables; detail access requires elevated permission. |
| Automated validation | Complete | Backend 86 tests, frontend 12 tests, backend/frontend production builds, .NET build with zero warnings/errors. |

## Requires Deployment Environment

- Enable feature flags progressively after applying migration 13.
- Assign granular membership permissions to intended users.
- Rebuild and install the Windows Service/EXE artifact.
- Execute real failed-login, tenant-switch, permission-change, sync, JTL disconnect/recovery, and export scenarios.
- Run production-like load targets and legal retention review.
- Perform deployment rollback rehearsal and production Docker smoke checks.

These are external verification or activation steps, not missing repository implementation. No production database, credentials, service installation, or deployment was changed during this work.
