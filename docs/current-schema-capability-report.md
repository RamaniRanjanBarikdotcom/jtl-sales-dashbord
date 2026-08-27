# Current Schema Capability Report

Read-only metadata inspection on 2026-08-27 found a partial deployment:

- `tenant_channel_payment_settings`: present.
- Schema-19 order columns: 6 of 19 present.
- `resolve_channel_payment_exact(...)`: absent.
- Marketplace schema 20 (`marketplace_accounts`): present.
- Marketplace feedback schema 21: absent.

The application therefore classifies canonical schema 19 as unavailable and uses pure legacy order SQL. It does not reference missing canonical columns, settings, rules, or resolver functions during legacy reads or ingest. Marketplace account APIs may run when enabled, while feedback APIs fail closed with an explicit service-unavailable response until schema 21 exists.

Capabilities are detected using PostgreSQL metadata only and are exposed in detailed health output. Detection failure also fails closed to legacy mode.
