# Implementation Status

## 2026-08 Reliability and Schema Remediation

- P0 schema capability detection, pure legacy reads/ingest, canonical cache versioning, source-platform separation, and marketplace feedback gating are implemented.
- The current database is partial schema 19 (6/19 order columns, missing resolver), so canonical behavior correctly remains disabled.
- Marketplace schema 20 is present and schema 21 is absent; feedback APIs now fail closed instead of issuing missing-table SQL.
- Sales, Product, Inventory, and Customer critical queries no longer substitute false KPI placeholders after API failures; remaining Sales/Product/Inventory zero-stale policies were replaced with bounded stale windows and previous-data preservation.
- Materialized-view refresh is advisory-lock coordinated through one coordinator for scheduled and ingest-triggered refreshes, and boot-time repair/refresh writes were removed.
- Sales preserves the complete channel result separately from the compact Top-7-plus-Other chart presentation.
- Compare exposes a tenant-scoped raw source-platform dimension and applies it to summary, trends, channels, products, channel-pair, and orders queries.
- Docker log rotation, health capacity metrics, retention dry-run SQL, queue Redis max-memory/no-eviction policy, enqueue backpressure, and four CI schema profiles are implemented.
- Every CI schema profile now builds and starts the backend, submits a real order through `/sync/ingest`, and verifies legacy versus canonical raw-evidence behavior.
- Production resource limits, retention execution, canonical activation/backfill, and deployment remain blocked pending production evidence/approval.
- Verification: backend typecheck/build plus 41 suites and 247 tests; frontend build plus 9 files and 43 tests. The new runtime profile matrix is configured in CI; its local execution was blocked because Docker Desktop did not become ready.

## Baseline

- Authoritative scope: `JTL_Dashboard_Detail_Filter_Export_Compare_Master_Plan_v2.md` and `CODE_BUDDY_JTL_DASHBOARD_AUTONOMOUS_PROMPT_v2.md`.
- The repository already contained unrelated local changes. They were preserved.
- All analytics queries changed in this pass remain scoped through `TenantContextService` and resolved tenant IDs.
- JTL SQL Server remains read-only; this work changes PostgreSQL reporting queries and dashboard presentation only.

## Existing Reusable Capabilities

- Global analytics filter state in `web/src/lib/store.ts`.
- Comparison controllers/services, saved views, feature flags, tenant scope, and permission guards.
- Existing Sales, Product, Inventory, Customer, and System Logs data services.
- Existing dashboard cards, drawers, tables, pagination, and chart components.

## Completed Requirements

- Canonical screen/export query merging through `web/src/lib/analytics-query.ts`.
- Shared safe CSV generation with UTF-8 BOM, quotes/newlines, delimiter safety, and formula neutralisation in `backend/src/common/utils/csv-export.ts` and `web/src/lib/csv.ts`.
- Real permission-guarded Sales, Product, Inventory, Customer, Compare, Product Intelligence, and System Logs exports.
- Explicit export metadata: matching rows, exported rows, completeness, limit, and generation timestamp.
- Sales Export route and live button wiring.
- Product screen/export filter and server-sort parity.
- Inventory stock semantics preserve `inventory.total`, `inventory.available`, and `inventory.reserved` separately.
- Inventory Available Stock now includes real sales, channels, last sale, classifications, pagination, filters, and matching export.
- Inventory Alerts now supports status, category, warehouse, channel, product/SKU, pagination, detail, and matching export.
- Days of Stock now supports category, warehouse, channel, cover range, classification, pagination, and matching export; no-demand remains null rather than fabricated as 999.
- Category stock rows are paginated/exportable and can drill into the filtered Available Stock table.
- Sales Daily Revenue low-value axis and single-point rendering are repaired.
- Unreliable margin is shown as unavailable rather than zero.
- Product Intelligence search/report supports product name, model, SKU/article number, and EAN; report data includes current stock, sales, channels, channel gaps, classifications, orders/order lines, and export.
- Compare supports quick periods, custom Period A/B, saved views, channel A/B panels, product comparisons, product-channel matrix, inventory filters, customer filters, and exports.
- Channel comparison now includes revenue, orders, units, customers, AOV, products sold, returns, stocked products with zero sales, common products, products unique to A/B, current stock, paginated detail, and export.
- Data freshness endpoint/banner exposes order, product, inventory, and aggregate timestamps and warns about material lag.
- Export buttons use permission keys rather than hardcoded role lists.
- No production mock/dummy imports were found in the changed analytics modules.

## Partially Implemented Requirements

- The broad-view interaction exists through module-specific drawers/modals and detail tables, but one universal `AnalyticsBroadViewModal`/`AnalyticsDetailTable` contract is not used by every major card.
- Sales has detailed/exportable module views, but not every chart exposes every requested Products/Customers/Inventory/Returns tab.
- Product category, ranking, matrix, stock-vs-sales, and Product Intelligence experiences exist, but the complete ranking operator family (above/below median, between, configurable Top/Bottom N, growth thresholds) is not implemented everywhere.
- Compare supports period, channel, product, inventory, and customer analysis. Dedicated category-vs-category, warehouse-vs-warehouse, and segment-vs-segment two-entity builders are not complete.
- Exports no longer truncate silently, but large exports are still synchronous and bounded with explicit `complete=false`; queued asynchronous export jobs are not implemented.
- Automated tests cover core filters, CSV safety, tenant scope, product sorting, inventory semantics, and comparison paging. Browser-level coverage for every card/filter/export combination is incomplete.

## Unavailable From Current Source Data

- Brand/manufacturer filtering is disabled because manufacturer data is not synced into the reporting schema.
- Margin is unavailable when real unit-cost coverage is insufficient; list price is never substituted as cost.
- Historical stock movement, stock ageing, and statistically reliable multivariate forecast confidence require source history not currently available.
- Return reasons and advanced customer identity fields are not displayed where source data does not provide them.

## Current Phase

- Phase 0 audit: complete.
- Phase 1 shared foundations: complete for canonical filters, permissions, safe CSV, exports, and freshness; asynchronous export jobs remain partial.
- Phase 2 Sales: substantially complete; universal per-widget detail-tab parity remains partial.
- Phase 3 Products: substantially complete; advanced ranking operators remain partial.
- Phase 4 Inventory: complete for current-stock, alerts, DSI, demand, categories, filters, pagination, and exports.
- Phase 5 Compare: complete for period/channel/product/matrix/inventory/customer flows; dedicated category/warehouse/segment pair builders remain partial.
- Phase 6 Product Intelligence search: complete for supported real fields.
- Phase 7 local verification: complete; production/load/browser verification remains manual.

## Tests Passed

- Backend: 41 suites, 247 tests, typecheck, and production build.
- Frontend: 9 files, 43 tests, and production build.
- Docker Compose configuration and backend/frontend image builds.
- `git diff --check`, generated-file scan, production mock scan, and JTL write scan.

## Export Defects Found And Fixed (download was broken end to end)

Exports were wired on all five pages but failed at runtime for two independent reasons.
Both are fixed and covered by `backend/src/common/permissions/export-permissions.spec.ts`.

1. **Route shadowing — `GET /products/export` was unreachable.**
   `products.controller.ts` declared `@Get(':productId/intelligence')` before
   `@Get('export')`. NestJS matches in declaration order, so `/products/export`
   was captured by the parameterised route and rejected by `ParseIntPipe`.
   Fixed by moving the static route above the parameterised ones. A repo-wide scan
   confirmed no other controller has this conflict.

2. **Unseeded permissions — every export returned 403.**
   `sales.export`, `products.export`, `inventory.export` and `customers.export`
   existed in `permission-keys.ts` and were enforced by `@RequirePermissions`, but
   were never inserted into the `permissions` table. `PermissionsGuard` resolves
   against `membership_permissions` in the database, not the JWT, so no user held
   them. Fixed by `backend/init-db/17-analytics-export-permissions.sql`.
   **This migration must be run — see `docs/FINAL_MANUAL_ACTIONS.md`.**

Also bounded the paged export loops in the products, inventory, sales and comparison
services. They had been changed from a hidden 2,000-row cap to
`page <= Number.MAX_SAFE_INTEGER`, which removed silent truncation but allowed an
unbounded loop on a large tenant. They now stop at `CSV_EXPORT_MAX_ROWS` and report
`complete: false` plus `row_limit` in the CSV metadata, so truncation stays visible.

## Known Risks

- Large synchronous exports can consume API/database resources despite explicit completeness metadata.
- SQL behavior still requires reconciliation against representative small and large tenant datasets.
- Production feature flags and permission grants can keep completed UI hidden until configured.

## Manual Verification Required

- Authenticated browser reconciliation against real tenant data.
- Large-tenant load tests and query-plan review.
- Docker image rebuild/recreate and production-equivalent smoke tests.
- Production feature-flag rollout, permission grants, monitoring, and rollback rehearsal.
