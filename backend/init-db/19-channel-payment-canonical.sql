BEGIN;

CREATE TABLE IF NOT EXISTS tenant_channel_payment_settings (
  tenant_id                 uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  channel_shadow_enabled    boolean NOT NULL DEFAULT true,
  channel_enabled           boolean NOT NULL DEFAULT false,
  payment_shadow_enabled    boolean NOT NULL DEFAULT true,
  payment_enabled           boolean NOT NULL DEFAULT false,
  resolution_version        integer NOT NULL DEFAULT 1 CHECK (resolution_version > 0),
  updated_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_channel_payment_rules (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_kind                  varchar(20) NOT NULL CHECK (rule_kind IN ('channel', 'payment', 'combined')),
  exact_platform             varchar(255),
  exact_payment              varchar(255),
  exact_shipping             varchar(255),
  exact_marketplace_source   varchar(255),
  exact_account_source       varchar(255),
  exact_shop_source          varchar(255),
  canonical_marketplace      varchar(100),
  canonical_account          varchar(255),
  canonical_shop             varchar(255),
  canonical_payment          varchar(100),
  evidence_status            varchar(20) NOT NULL DEFAULT 'candidate'
    CHECK (evidence_status IN ('candidate', 'verified', 'rejected')),
  enabled                    boolean NOT NULL DEFAULT false,
  priority                   integer NOT NULL DEFAULT 100,
  resolution_version         integer NOT NULL DEFAULT 1 CHECK (resolution_version > 0),
  evidence_reference         text,
  verified_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  verified_at                timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CHECK (canonical_marketplace IS NOT NULL OR canonical_payment IS NOT NULL),
  CHECK (enabled = false OR evidence_status = 'verified')
);

DROP INDEX IF EXISTS ux_tenant_channel_payment_rules_exact;
CREATE UNIQUE INDEX ux_tenant_channel_payment_rules_exact
ON tenant_channel_payment_rules (
  tenant_id,
  rule_kind,
  COALESCE(LOWER(TRIM(exact_platform)), ''),
  COALESCE(LOWER(TRIM(exact_payment)), ''),
  COALESCE(LOWER(TRIM(exact_shipping)), ''),
  COALESCE(LOWER(TRIM(exact_marketplace_source)), ''),
  COALESCE(LOWER(TRIM(exact_account_source)), ''),
  COALESCE(LOWER(TRIM(exact_shop_source)), ''),
  COALESCE(LOWER(TRIM(canonical_marketplace)), ''),
  COALESCE(LOWER(TRIM(canonical_account)), ''),
  COALESCE(LOWER(TRIM(canonical_shop)), ''),
  COALESCE(LOWER(TRIM(canonical_payment)), ''),
  resolution_version
);

CREATE INDEX IF NOT EXISTS idx_tenant_channel_payment_rules_active
ON tenant_channel_payment_rules (tenant_id, enabled, evidence_status, priority, id);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_platform_raw varchar(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_payment_raw varchar(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_shipping_raw varchar(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_marketplace_raw varchar(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_account_raw varchar(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_shop_raw varchar(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_external_order_raw varchar(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS canonical_marketplace varchar(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS canonical_marketplace_account varchar(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS canonical_shop varchar(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS canonical_payment_method varchar(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel_resolution_status varchar(20) NOT NULL DEFAULT 'unresolved';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_resolution_status varchar(20) NOT NULL DEFAULT 'unresolved';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel_rule_id uuid;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_rule_id uuid;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS canonical_resolution_version integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel_rule_version integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_rule_version integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS canonical_resolved_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_channel_resolution_status_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_channel_resolution_status_check
      CHECK (channel_resolution_status IN ('resolved', 'ambiguous', 'unresolved'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_payment_resolution_status_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_payment_resolution_status_check
      CHECK (payment_resolution_status IN ('resolved', 'ambiguous', 'unresolved'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_tenant_canonical_marketplace
ON orders (tenant_id, canonical_marketplace, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_canonical_payment
ON orders (tenant_id, canonical_payment_method, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_channel_resolution
ON orders (tenant_id, channel_resolution_status, order_date DESC);

CREATE OR REPLACE FUNCTION resolve_channel_payment_exact(
  p_tenant_id uuid,
  p_platform text,
  p_payment text,
  p_shipping text,
  p_marketplace_source text DEFAULT NULL,
  p_account_source text DEFAULT NULL,
  p_shop_source text DEFAULT NULL
)
RETURNS TABLE (
  channel_rule_id uuid,
  payment_rule_id uuid,
  canonical_marketplace text,
  canonical_account text,
  canonical_shop text,
  canonical_payment text,
  channel_status text,
  payment_status text,
  channel_rule_version integer,
  payment_rule_version integer,
  resolution_version integer
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    CASE WHEN channel_rule.match_count = 1 THEN channel_rule.id ELSE NULL END,
    CASE WHEN payment_rule.match_count = 1 THEN payment_rule.id ELSE NULL END,
    CASE WHEN channel_rule.match_count = 1 THEN channel_rule.canonical_marketplace ELSE NULL END,
    CASE WHEN channel_rule.match_count = 1 THEN channel_rule.canonical_account ELSE NULL END,
    CASE WHEN channel_rule.match_count = 1 THEN channel_rule.canonical_shop ELSE NULL END,
    CASE WHEN payment_rule.match_count = 1 THEN payment_rule.canonical_payment ELSE NULL END,
    CASE
      WHEN COALESCE(channel_rule.match_count, 0) = 0 THEN 'unresolved'
      WHEN channel_rule.match_count = 1 THEN 'resolved'
      ELSE 'ambiguous'
    END,
    CASE
      WHEN COALESCE(payment_rule.match_count, 0) = 0 THEN 'unresolved'
      WHEN payment_rule.match_count = 1 THEN 'resolved'
      ELSE 'ambiguous'
    END,
    CASE WHEN channel_rule.match_count = 1 THEN channel_rule.resolution_version ELSE NULL END,
    CASE WHEN payment_rule.match_count = 1 THEN payment_rule.resolution_version ELSE NULL END,
    settings.resolution_version
  FROM tenant_channel_payment_settings settings
  LEFT JOIN LATERAL (
    SELECT (ARRAY_AGG(rule.id ORDER BY rule.priority, rule.id))[1] AS id,
           (ARRAY_AGG(rule.canonical_marketplace ORDER BY rule.priority, rule.id))[1] AS canonical_marketplace,
           (ARRAY_AGG(rule.canonical_account ORDER BY rule.priority, rule.id))[1] AS canonical_account,
           (ARRAY_AGG(rule.canonical_shop ORDER BY rule.priority, rule.id))[1] AS canonical_shop,
           (ARRAY_AGG(rule.resolution_version ORDER BY rule.priority, rule.id))[1] AS resolution_version,
           COUNT(DISTINCT CONCAT_WS(E'\x1f', rule.canonical_marketplace, rule.canonical_account, rule.canonical_shop))::int AS match_count
    FROM (
      SELECT candidate.*
      FROM (
        SELECT rule.*, MIN(rule.priority) OVER () AS winning_priority
        FROM tenant_channel_payment_rules rule
        WHERE rule.tenant_id = p_tenant_id
          AND settings.channel_enabled
          AND rule.enabled
          AND rule.evidence_status = 'verified'
          AND rule.rule_kind IN ('channel', 'combined')
          AND (rule.exact_platform IS NULL OR LOWER(TRIM(rule.exact_platform)) = LOWER(TRIM(COALESCE(p_platform, ''))))
          AND (rule.exact_payment IS NULL OR LOWER(TRIM(rule.exact_payment)) = LOWER(TRIM(COALESCE(p_payment, ''))))
          AND (rule.exact_shipping IS NULL OR LOWER(TRIM(rule.exact_shipping)) = LOWER(TRIM(COALESCE(p_shipping, ''))))
          AND (rule.exact_marketplace_source IS NULL OR LOWER(TRIM(rule.exact_marketplace_source)) = LOWER(TRIM(COALESCE(p_marketplace_source, ''))))
          AND (rule.exact_account_source IS NULL OR LOWER(TRIM(rule.exact_account_source)) = LOWER(TRIM(COALESCE(p_account_source, ''))))
          AND (rule.exact_shop_source IS NULL OR LOWER(TRIM(rule.exact_shop_source)) = LOWER(TRIM(COALESCE(p_shop_source, ''))))
      ) candidate
      WHERE candidate.priority = candidate.winning_priority
    ) rule
  ) channel_rule ON true
  LEFT JOIN LATERAL (
    SELECT (ARRAY_AGG(rule.id ORDER BY rule.priority, rule.id))[1] AS id,
           (ARRAY_AGG(rule.canonical_payment ORDER BY rule.priority, rule.id))[1] AS canonical_payment,
           (ARRAY_AGG(rule.resolution_version ORDER BY rule.priority, rule.id))[1] AS resolution_version,
           COUNT(DISTINCT rule.canonical_payment)::int AS match_count
    FROM (
      SELECT candidate.*
      FROM (
        SELECT rule.*, MIN(rule.priority) OVER () AS winning_priority
        FROM tenant_channel_payment_rules rule
        WHERE rule.tenant_id = p_tenant_id
          AND settings.payment_enabled
          AND rule.enabled
          AND rule.evidence_status = 'verified'
          AND rule.rule_kind IN ('payment', 'combined')
          AND (rule.exact_platform IS NULL OR LOWER(TRIM(rule.exact_platform)) = LOWER(TRIM(COALESCE(p_platform, ''))))
          AND (rule.exact_payment IS NULL OR LOWER(TRIM(rule.exact_payment)) = LOWER(TRIM(COALESCE(p_payment, ''))))
          AND (rule.exact_shipping IS NULL OR LOWER(TRIM(rule.exact_shipping)) = LOWER(TRIM(COALESCE(p_shipping, ''))))
          AND (rule.exact_marketplace_source IS NULL OR LOWER(TRIM(rule.exact_marketplace_source)) = LOWER(TRIM(COALESCE(p_marketplace_source, ''))))
          AND (rule.exact_account_source IS NULL OR LOWER(TRIM(rule.exact_account_source)) = LOWER(TRIM(COALESCE(p_account_source, ''))))
          AND (rule.exact_shop_source IS NULL OR LOWER(TRIM(rule.exact_shop_source)) = LOWER(TRIM(COALESCE(p_shop_source, ''))))
      ) candidate
      WHERE candidate.priority = candidate.winning_priority
    ) rule
  ) payment_rule ON true
  WHERE settings.tenant_id = p_tenant_id;
$$;

CREATE TABLE IF NOT EXISTS canonical_backfill_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  requested_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_limit       integer NOT NULL CHECK (requested_limit BETWEEN 1 AND 5000),
  processed_rows        integer NOT NULL DEFAULT 0,
  resolved_channels     integer NOT NULL DEFAULT 0,
  resolved_payments     integer NOT NULL DEFAULT 0,
  resolution_version    integer NOT NULL DEFAULT 1,
  checkpoint_order_date date,
  checkpoint_order_id   bigint,
  status                varchar(20) NOT NULL CHECK (status IN ('running', 'paused', 'completed', 'failed', 'rolled_back')),
  rollback_status       varchar(20) NOT NULL DEFAULT 'available'
    CHECK (rollback_status IN ('available', 'running', 'completed', 'failed')),
  error_message         text,
  started_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz
);

CREATE TABLE IF NOT EXISTS canonical_backfill_snapshots (
  run_id                         uuid NOT NULL REFERENCES canonical_backfill_runs(id) ON DELETE CASCADE,
  tenant_id                      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  jtl_order_id                   bigint NOT NULL,
  order_date                     date NOT NULL,
  canonical_marketplace          varchar(100),
  canonical_marketplace_account  varchar(255),
  canonical_shop                 varchar(255),
  canonical_payment_method       varchar(100),
  channel_resolution_status      varchar(20) NOT NULL,
  payment_resolution_status      varchar(20) NOT NULL,
  channel_rule_id                uuid,
  payment_rule_id                uuid,
  channel_rule_version           integer,
  payment_rule_version           integer,
  canonical_resolution_version   integer,
  canonical_resolved_at          timestamptz,
  PRIMARY KEY (run_id, tenant_id, jtl_order_id, order_date)
);

ALTER TABLE canonical_backfill_snapshots
  DROP CONSTRAINT IF EXISTS canonical_backfill_snapshots_pkey;
ALTER TABLE canonical_backfill_snapshots
  ADD PRIMARY KEY (run_id, tenant_id, jtl_order_id, order_date);

CREATE TABLE IF NOT EXISTS canonical_rule_reprocess_queue (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_id           uuid NOT NULL REFERENCES tenant_channel_payment_rules(id) ON DELETE CASCADE,
  rule_version      integer NOT NULL,
  status            varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  UNIQUE (tenant_id, rule_id, rule_version)
);

CREATE INDEX IF NOT EXISTS idx_canonical_reprocess_queue_pending
ON canonical_rule_reprocess_queue (tenant_id, status, created_at, id);

INSERT INTO tenant_channel_payment_settings (tenant_id)
SELECT id FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

UPDATE tenant_channel_payment_rules
SET exact_payment = '',
    updated_at = now()
WHERE tenant_id = (SELECT id FROM tenants WHERE name = 'My Company')
  AND rule_kind = 'channel'
  AND LOWER(TRIM(exact_platform)) = 'ebay.de'
  AND LOWER(TRIM(COALESCE(exact_payment, ''))) = 'unknown'
  AND canonical_marketplace = 'eBay'
  AND evidence_status = 'candidate'
  AND enabled = false;

INSERT INTO tenant_channel_payment_rules (
  tenant_id, rule_kind, exact_platform, exact_payment,
  canonical_marketplace, canonical_payment, evidence_status, enabled,
  priority, evidence_reference
)
SELECT tenant.id, candidate.rule_kind, candidate.platform, candidate.payment,
       candidate.marketplace, candidate.canonical_payment, 'candidate', false,
       candidate.priority, 'Phase 0B reporting candidate; direct JTL-Wawi verification required'
FROM tenants tenant
CROSS JOIN (VALUES
  ('channel', 'amazon.de', NULL, 'Amazon', NULL, 5),
  ('channel', 'amazon.de', 'Amazon Marktplatz', 'Amazon', NULL, 10),
  ('channel', 'ebay.de', NULL, 'eBay', NULL, 5),
  ('channel', 'weitere verkaufskanäle', 'Otto.de', 'Otto', NULL, 20),
  ('channel', 'weitere verkaufskanäle', 'Kaufland.de', 'Kaufland', NULL, 20),
  ('channel', 'weitere verkaufskanäle', 'MediaMarktSaturn', 'MediaMarktSaturn', NULL, 20),
  ('channel', 'unicorn', 'Kaufland', 'Kaufland', NULL, 20),
  ('channel', 'unicorn', 'OTTO market', 'Otto', NULL, 20),
  ('channel', 'xml-import', 'MMS', 'MediaMarktSaturn', NULL, 20),
  ('channel', 'xml-import', 'Conrad', 'Conrad', NULL, 20),
  ('channel', 'onlineshop', NULL, 'Direct', NULL, 20),
  ('channel', 'onlineshop', 'PayPal', 'Direct', NULL, 30),
  ('channel', 'onlineshop', 'Überweisung', 'Direct', NULL, 30),
  ('channel', 'onlineshop', 'Amazon Pay', 'Direct', NULL, 30),
  ('payment', 'onlineshop', 'PayPal', NULL, 'PayPal', 30),
  ('payment', 'onlineshop', 'Überweisung', NULL, 'Bank Transfer', 30),
  ('payment', 'onlineshop', 'Amazon Pay', NULL, 'Amazon Pay', 30)
) AS candidate(rule_kind, platform, payment, marketplace, canonical_payment, priority)
WHERE tenant.name = 'My Company'
ON CONFLICT DO NOTHING;

INSERT INTO permissions (key, description) VALUES
  ('channel_payment.preview', 'Preview canonical channel and payment resolution'),
  ('channel_payment.manage', 'Manage verified tenant channel and payment rules'),
  ('channel_payment.backfill', 'Run bounded audited canonical backfills')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

COMMIT;
