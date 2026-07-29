# Unified Operations Current-State Audit

## Reused

- Existing JWT, tenant-isolation, membership-permission, company-switch, audit, cache, analytics, inventory, sync-run, watermark, trigger, and ingest services remain authoritative.
- Existing sync engine orchestration remains the only JTL extraction/ingest implementation.
- Existing dashboard query services remain the metric owners; no model-controlled SQL was added.

## Added

- Typed feature flags with safe defaults.
- Request and correlation identifiers with bounded accepted header syntax.
- Recursive metadata redaction and truncation.
- Durable sync agent, command, command-event, system-event, and Copilot persistence.
- Tenant timezone, currency, locale, week-start, and fiscal-year settings.
- Atomic command claim with `FOR UPDATE SKIP LOCKED`, a 120-second lease, progress, terminal status, cancellation, and idempotency.
- System Logs and Analytics Copilot dashboard routes.

## Deliberate Compatibility

- Legacy `sync_triggers` remains active while the new command channel is opt-in.
- Existing broad permissions remain; granular permissions are additive.
- Remote commands, system logs, and Copilot are disabled until explicitly enabled.

## Safety Boundaries

- Sync agent authentication requires both tenant ID and sync API key.
- Command types are allowlisted and DTO-validated.
- No generic shell, Windows command, SQL, or arbitrary tool endpoint exists.
- AI receives only fixed aggregate results and never receives a tenant selector.
- All persistence is tenant-scoped and parameterized.
