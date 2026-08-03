-- Repair analytics export and comparison grants for the current membership model.
-- Current company administrators use role=company_admin. Tenant managers use
-- role=user with user_level=manager. Earlier migrations only matched legacy
-- role names. Idempotent: safe to run on existing installations.

BEGIN;

INSERT INTO permissions (key, description) VALUES
  ('sales.export', 'Export sales analytics data'),
  ('products.export', 'Export product analytics data'),
  ('inventory.export', 'Export inventory analytics data'),
  ('customers.export', 'Export customer analytics data'),
  ('comparison.view', 'View Compare and Analyse'),
  ('comparison.sales.view', 'View channel and sales comparisons'),
  ('comparison.products.view', 'View product comparisons'),
  ('comparison.inventory.view', 'View inventory comparisons'),
  ('comparison.customers.view', 'View customer comparisons'),
  ('comparison.export', 'Export comparison data'),
  ('comparison.saved_views.manage', 'Create and delete saved comparison views'),
  ('comparison.cost_margin.view', 'View comparison cost and margin metrics'),
  ('comparison.customer_details.view', 'View customer comparison details')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO membership_permissions (membership_id, permission_key)
SELECT m.id, p.key
FROM user_tenant_memberships m
CROSS JOIN permissions p
WHERE m.is_active = true
  AND (
    m.role IN ('admin', 'manager', 'company_admin')
    OR (m.role = 'user' AND m.user_level = 'manager')
  )
  AND (
    p.key IN ('sales.export', 'products.export', 'inventory.export', 'customers.export')
    OR p.key LIKE 'comparison.%'
  )
ON CONFLICT (membership_id, permission_key) DO NOTHING;

COMMIT;
