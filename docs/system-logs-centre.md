# System Logs Centre

System events use controlled severity/source fields, tenant scoping, server pagination, and centralized metadata sanitization. The API is append-only; no update/delete endpoint exists. Log viewing and export are separate permissions and flags.

## API

- `GET /api/admin/logs/summary`
- `GET /api/admin/logs/events`
- `GET /api/admin/logs/events/:id`
- `GET /api/admin/logs/events/:id/related`
- `GET /api/admin/logs/audit`
- `GET /api/admin/logs/security`
- `GET /api/admin/logs/sources`
- `POST /api/admin/logs/export`
- `POST /api/sync-agent/events`

The legacy tenant route `/api/logs/system` remains compatible.

## Operational Rules

- Recent event queries default to seven days and never become unbounded.
- Page size is capped at 200; synchronous export is separately capped.
- Operational event writes are best-effort and cannot stop sync.
- Audit and export actions remain durable and visible.
- Agent events require the exact tenant API key and a registered agent ID.
- Retention deletes at most 1,000 rows per batch and excludes active incidents.
