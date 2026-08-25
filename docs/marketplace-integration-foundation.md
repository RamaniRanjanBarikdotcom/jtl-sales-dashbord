# Marketplace Integration Foundation

This repository implements the safe shared foundation from the marketplace blueprint. It does not enable live provider writes or alter existing JTL dashboard totals.

## Implemented

- Marketplace enums, resource/capability contracts and connector registry.
- Dedicated BullMQ dependency and per-provider realtime, bulk and financial queue names.
- Separate durable `redis-queue` Compose service with AOF and `noeviction`.
- Isolated scheduler, realtime, bulk and postprocess process entrypoints.
- Additive tenant-scoped schema for accounts, encrypted credentials, capabilities, policies, cursors, runs, failures, raw source records, normalized orders/items, reconciliation links and worker heartbeats.
- AES-256-GCM credential envelopes and centralized credential redaction.
- Tenant-scoped account, credential rotation, connection test, manual shadow sync, run history and reconciliation-summary APIs.
- Mock Amazon connector fixtures and bounded, idempotent shadow order ingestion.
- Cursor updates inside the same transaction as raw/normalized source persistence.
- Feature flags default OFF; canonical reads and all marketplace write actions remain OFF.

## Intentionally not enabled

- Real Amazon/eBay/Kaufland/OTTO/MediaMarktSaturn credentials or API calls.
- Provider OAuth callbacks/webhook signatures.
- Marketplace data influencing current sales totals.
- Inventory, pricing, refund or listing write-back.
- Historical provider backfills.

These require provider applications, scopes, sandbox credentials, API contract fixtures, human security review and a tenant pilot. Unsupported capability must remain explicit rather than appearing as zero.

Amazon Client ID and Client Secret may be stored through the pilot UI, but they do not by themselves authorize access to a seller account. Live Selling Partner API reads require the seller authorization flow and its refresh token; the current connection test remains an explicitly labelled simulation.

## Safe rollout

1. Review and apply `20-marketplace-foundation.sql` with `npm run migration:marketplaces`.
2. Generate independent Redis queue and 32-byte credential encryption secrets.
3. Start `docker compose --profile marketplaces up -d` while all marketplace flags remain false.
4. Enable the platform/account API for a non-production pilot tenant.
5. Enable the mock connector and worker roles; verify shadow records and reconciliation coverage.
6. Implement and contract-test Amazon authentication/orders before enabling any real account.
7. Keep `MARKETPLACE_CANONICAL_READS_ENABLED=false` and `MARKETPLACE_WRITE_ACTIONS_ENABLED=false` until reconciliation and rollback acceptance criteria pass.

The existing JTL ingest queue and source tables remain unchanged.
