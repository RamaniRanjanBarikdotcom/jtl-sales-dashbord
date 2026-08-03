BEGIN;

CREATE TABLE IF NOT EXISTS channel_mappings (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  raw_channel   varchar(255) NOT NULL,
  canonical_id  varchar(100) NOT NULL,
  display_name  varchar(255) NOT NULL,
  channel_type  varchar(50)  NOT NULL DEFAULT 'other',
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, raw_channel)
);

CREATE INDEX IF NOT EXISTS idx_channel_mappings_tenant_canonical
ON channel_mappings (tenant_id, canonical_id);

INSERT INTO channel_mappings (tenant_id, raw_channel, canonical_id, display_name, channel_type)
SELECT DISTINCT
  o.tenant_id,
  COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown'),
  CASE
    WHEN LOWER(COALESCE(o.channel, '')) LIKE '%amazon%' THEN 'amazon'
    WHEN LOWER(COALESCE(o.channel, '')) LIKE '%ebay%' THEN 'ebay'
    WHEN LOWER(COALESCE(o.channel, '')) LIKE '%shopify%' THEN 'shopify'
    WHEN LOWER(COALESCE(o.channel, '')) LIKE '%jtl%' OR LOWER(COALESCE(o.channel, '')) LIKE '%wawi%' THEN 'jtl-wawi'
    WHEN LOWER(COALESCE(o.channel, '')) LIKE '%market%' THEN 'marketplace'
    WHEN LOWER(COALESCE(o.channel, '')) IN ('', 'unknown', 'n/a', '-') THEN 'unknown'
    ELSE 'raw-' || md5(COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown'))
  END,
  CASE
    WHEN LOWER(COALESCE(o.channel, '')) LIKE '%amazon%' THEN 'Amazon'
    WHEN LOWER(COALESCE(o.channel, '')) LIKE '%ebay%' THEN 'eBay'
    WHEN LOWER(COALESCE(o.channel, '')) LIKE '%shopify%' THEN 'Shopify'
    WHEN LOWER(COALESCE(o.channel, '')) LIKE '%jtl%' OR LOWER(COALESCE(o.channel, '')) LIKE '%wawi%' THEN 'JTL-Wawi'
    WHEN LOWER(COALESCE(o.channel, '')) LIKE '%market%' THEN 'Marketplace'
    WHEN LOWER(COALESCE(o.channel, '')) IN ('', 'unknown', 'n/a', '-') THEN 'Unknown'
    ELSE COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')
  END,
  CASE
    WHEN LOWER(COALESCE(o.channel, '')) LIKE '%amazon%' OR LOWER(COALESCE(o.channel, '')) LIKE '%ebay%' OR LOWER(COALESCE(o.channel, '')) LIKE '%market%' THEN 'marketplace'
    WHEN LOWER(COALESCE(o.channel, '')) LIKE '%shopify%' THEN 'webshop'
    WHEN LOWER(COALESCE(o.channel, '')) LIKE '%jtl%' OR LOWER(COALESCE(o.channel, '')) LIKE '%wawi%' THEN 'erp'
    ELSE 'other'
  END
FROM orders o
ON CONFLICT (tenant_id, raw_channel) DO NOTHING;

CREATE TABLE IF NOT EXISTS inventory_daily_snapshots (
  id               bigserial     PRIMARY KEY,
  tenant_id        uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_date    date          NOT NULL,
  jtl_product_id   bigint        NOT NULL,
  jtl_warehouse_id bigint        NOT NULL,
  warehouse_name   varchar(255),
  available        numeric(12,3) NOT NULL DEFAULT 0,
  reserved         numeric(12,3) NOT NULL DEFAULT 0,
  total            numeric(12,3) NOT NULL DEFAULT 0,
  unit_cost        numeric(12,2) NOT NULL DEFAULT 0,
  stock_value      numeric(16,2) NOT NULL DEFAULT 0,
  captured_at      timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, snapshot_date, jtl_product_id, jtl_warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_snapshots_tenant_date
ON inventory_daily_snapshots (tenant_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_snapshots_tenant_product_date
ON inventory_daily_snapshots (tenant_id, jtl_product_id, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS analytics_saved_views (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        varchar(120) NOT NULL,
  tab         varchar(50)  NOT NULL,
  config      jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_saved_views_tenant_user
ON analytics_saved_views (tenant_id, user_id, updated_at DESC);

INSERT INTO permissions (key, description) VALUES
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
  AND p.key LIKE 'comparison.%'
ON CONFLICT (membership_id, permission_key) DO NOTHING;

COMMIT;
