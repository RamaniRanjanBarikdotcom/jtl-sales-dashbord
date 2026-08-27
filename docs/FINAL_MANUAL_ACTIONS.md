# Final Manual Actions

## Reliability Remediation Production Actions

- Apply missing schema files only through the approved migration process; the current database is partial schema 19 and lacks schema 21.
- Do not enable canonical channel/payment reads or run backfills until schema 19 is complete, rules are human-verified, reconciliation passes, and rollback is rehearsed.
- Do not enable marketplace review APIs until schema 21 is applied and an authorized review source is configured.
- Collect representative production capacity data before setting Compose CPU/memory/PID or Node heap limits.
- Approve retention days and legal/customer requirements before enabling any bounded operational cleanup.
- Rebuild and deploy exact images in a controlled window; this local work did not restart or deploy production services.

## REQUIRED BEFORE EXPORTS WORK — run the export permission migration

Analytics exports return **403 for every user** until this runs. `sales.export`,
`products.export`, `inventory.export` and `customers.export` were defined in
`permission-keys.ts` and enforced by the controllers, but were never inserted into
the `permissions` table. `PermissionsGuard` resolves against `membership_permissions`
in the database, not the JWT, so the keys must exist as rows.

```bash
psql "$DATABASE_URL" -f backend/init-db/17-analytics-export-permissions.sql
```

The script is idempotent and safe to re-run. Verify afterwards:

```sql
SELECT key FROM permissions WHERE key LIKE '%.export' ORDER BY key;
-- expect: comparison.export, customers.export, inventory.export,
--         logs.export, products.export, sales.export

SELECT m.role, COUNT(*) FROM membership_permissions mp
JOIN user_tenant_memberships m ON m.id = mp.membership_id
WHERE mp.permission_key LIKE '%.export' GROUP BY m.role;
```

Users must log out and back in afterwards — permissions are resolved into the
session at login.

## Security

- Rotate any credentials that were ever exposed outside approved secret storage.
- Purge exposed secrets from Git history using the approved security runbook.
- Re-run full-history secret scanning and revoke superseded tokens.

## Production Configuration

- Verify export and comparison permission keys are seeded and assigned to intended memberships.
- Review and progressively enable comparison/detail feature flags only after smoke and load tests.
- Rebuild backend/frontend images and recreate containers; source changes do not update running containers automatically.
- Deploy exact Git-SHA images and retain previous rollback images.

## Authenticated Data QA

- Reconcile Sales, Product, Inventory, Customer, and Compare totals for one small and one large tenant.
- Verify tenant switching never leaks another tenant's products, orders, inventory, exports, or saved views.
- Test export-denied users: buttons hidden and API returns forbidden.
- Verify Product Intelligence with an existing SKU/model such as TN2420 when that product exists for the selected tenant.
- Verify Inventory Alerts and DSI category/warehouse/channel filters against known JTL/PostgreSQL rows.
- Verify Channel A/B common and unique product counts against direct tenant-scoped SQL.

## Performance And Operations

- Run long-period query plans and concurrency/load tests before enabling detailed comparison for large tenants.
- Implement durable asynchronous export jobs before relying on exports above configured synchronous limits.
- Monitor API latency, PostgreSQL CPU/locks/temp usage, queue health, and cache behavior during rollout.
- Rehearse feature-flag rollback and previous-image deployment.

## Exact Local Verification Commands

```bash
cd backend
npm run typecheck
npm test -- --runInBand
npm run build

cd ../web
npm run test:run
npm run build

cd ..
docker compose config
git diff --check
git status --short
git diff --stat
```
