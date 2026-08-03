-- Analytics export permissions.
--
-- sales.export, products.export, inventory.export and customers.export were
-- defined in backend/src/common/permissions/permission-keys.ts and enforced by
-- the export controllers, but were never inserted into the permissions table.
-- PermissionsGuard resolves against membership_permissions in the database, so
-- every analytics export returned 403 regardless of the user's role.
--
-- Idempotent: safe to re-run.

BEGIN;

INSERT INTO permissions (key, description) VALUES
  ('sales.export',     'Export sales analytics data'),
  ('products.export',  'Export product analytics data'),
  ('inventory.export', 'Export inventory analytics data'),
  ('customers.export', 'Export customer analytics data')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

-- Grant to the same roles that already hold the equivalent comparison.export
-- permission, so export access stays consistent across modules.
INSERT INTO membership_permissions (membership_id, permission_key)
SELECT m.id, p.key
FROM user_tenant_memberships m
CROSS JOIN permissions p
WHERE m.is_active = true
  AND (
    m.role IN ('admin', 'manager', 'company_admin')
    OR (m.role = 'user' AND m.user_level = 'manager')
  )
  AND p.key IN ('sales.export', 'products.export', 'inventory.export', 'customers.export')
ON CONFLICT (membership_id, permission_key) DO NOTHING;

COMMIT;
