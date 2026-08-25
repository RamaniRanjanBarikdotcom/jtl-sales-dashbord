BEGIN;

CREATE TABLE IF NOT EXISTS marketplace_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  marketplace varchar(30) NOT NULL CHECK (marketplace IN ('AMAZON','EBAY','KAUFLAND','OTTO','MEDIAMARKT')),
  display_name varchar(160) NOT NULL,
  external_merchant_id varchar(200),
  region_code varchar(30),
  currency_code char(3),
  status varchar(30) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','AUTH_EXPIRED','DISABLED')),
  shadow_mode boolean NOT NULL DEFAULT true,
  last_connection_test_at timestamptz,
  last_connection_status varchar(40),
  last_safe_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_account_identity
  ON marketplace_accounts (tenant_id, marketplace, external_merchant_id)
  WHERE external_merchant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marketplace_accounts_tenant_status
  ON marketplace_accounts (tenant_id, status);

CREATE TABLE IF NOT EXISTS marketplace_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  marketplace_account_id uuid NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  encrypted_payload text NOT NULL,
  encryption_key_id varchar(64) NOT NULL,
  encryption_version integer NOT NULL DEFAULT 1,
  expires_at timestamptz,
  rotated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, marketplace_account_id)
);

CREATE TABLE IF NOT EXISTS marketplace_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  marketplace_account_id uuid NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  resource varchar(40) NOT NULL,
  level varchar(30) NOT NULL CHECK (level IN ('FULL','PARTIAL','AGGREGATE_ONLY','EXTERNAL_SOURCE','NOT_AUTHORIZED','NOT_SUPPORTED')),
  source varchar(40) NOT NULL DEFAULT 'CONNECTOR',
  reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, marketplace_account_id, resource)
);

CREATE TABLE IF NOT EXISTS marketplace_sync_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  marketplace_account_id uuid NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  resource varchar(40) NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  cadence_seconds integer NOT NULL DEFAULT 900 CHECK (cadence_seconds BETWEEN 60 AND 604800),
  next_due_at timestamptz,
  priority_class varchar(30) NOT NULL DEFAULT 'NORMAL',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, marketplace_account_id, resource)
);

CREATE TABLE IF NOT EXISTS marketplace_sync_cursors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  marketplace_account_id uuid NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  resource varchar(40) NOT NULL,
  committed_cursor text,
  window_end timestamptz,
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, marketplace_account_id, resource)
);

CREATE TABLE IF NOT EXISTS marketplace_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  marketplace_account_id uuid NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  marketplace varchar(30) NOT NULL,
  resource varchar(40) NOT NULL,
  trigger varchar(30) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'QUEUED',
  shadow_mode boolean NOT NULL DEFAULT true,
  protocol_version integer NOT NULL DEFAULT 1,
  records_seen integer NOT NULL DEFAULT 0,
  records_written integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  safe_error text,
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_sync_runs_account_created
  ON marketplace_sync_runs (tenant_id, marketplace_account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS marketplace_sync_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  marketplace_account_id uuid NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  sync_run_id uuid REFERENCES marketplace_sync_runs(id) ON DELETE SET NULL,
  resource varchar(40) NOT NULL,
  failure_class varchar(40) NOT NULL,
  safe_error_code varchar(100),
  safe_error_message text,
  attempt_count integer NOT NULL DEFAULT 1,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketplace_raw_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  marketplace_account_id uuid NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  marketplace varchar(30) NOT NULL,
  resource varchar(40) NOT NULL,
  external_id varchar(300) NOT NULL,
  payload_hash varchar(40) NOT NULL,
  payload jsonb NOT NULL,
  connector_version varchar(40) NOT NULL,
  normalizer_version varchar(40) NOT NULL,
  source_updated_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, marketplace_account_id, resource, external_id)
);

CREATE TABLE IF NOT EXISTS marketplace_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  marketplace_account_id uuid NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  marketplace varchar(30) NOT NULL,
  external_order_id varchar(300) NOT NULL,
  status varchar(80),
  currency_code char(3),
  gross_total numeric(18,4),
  ordered_at timestamptz NOT NULL,
  canonical_state varchar(40) NOT NULL DEFAULT 'SOURCE_ONLY',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, marketplace_account_id, external_order_id)
);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_tenant_ordered
  ON marketplace_orders (tenant_id, ordered_at DESC);

CREATE TABLE IF NOT EXISTS marketplace_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  marketplace_account_id uuid REFERENCES marketplace_accounts(id) ON DELETE SET NULL,
  marketplace varchar(30) NOT NULL,
  canonical_channel_id varchar(100) NOT NULL,
  external_review_id varchar(300) NOT NULL,
  external_product_id varchar(300),
  sku varchar(300),
  rating numeric(3,2) NOT NULL CHECK (rating >= 1 AND rating <= 5),
  sentiment varchar(10) GENERATED ALWAYS AS (
    CASE WHEN rating >= 4 THEN 'positive' WHEN rating <= 2 THEN 'negative' ELSE 'neutral' END
  ) STORED,
  title varchar(500),
  review_text text,
  reviewed_at timestamptz NOT NULL,
  verified_purchase boolean,
  source_payload_hash varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, marketplace, external_review_id)
);
CREATE INDEX IF NOT EXISTS idx_marketplace_reviews_tenant_channel_date
  ON marketplace_reviews (tenant_id, canonical_channel_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_reviews_tenant_sentiment_date
  ON marketplace_reviews (tenant_id, sentiment, reviewed_at DESC);

CREATE TABLE IF NOT EXISTS marketplace_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  marketplace_account_id uuid NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  marketplace_order_id uuid NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  external_order_id varchar(300) NOT NULL,
  external_item_id varchar(300) NOT NULL,
  external_product_id varchar(300),
  sku varchar(300),
  quantity numeric(18,4) NOT NULL DEFAULT 0,
  gross_total numeric(18,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, marketplace_account_id, external_order_id, external_item_id)
);

CREATE TABLE IF NOT EXISTS marketplace_order_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  marketplace_order_id uuid NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
  jtl_order_id bigint,
  jtl_order_date date,
  status varchar(30) NOT NULL CHECK (status IN ('UNRESOLVED','MATCHED','CONFLICT','IGNORED','SEPARATE')),
  confidence numeric(6,5),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, marketplace_order_id)
);

CREATE TABLE IF NOT EXISTS marketplace_worker_heartbeats (
  worker_id varchar(160) PRIMARY KEY,
  role varchar(40) NOT NULL,
  version varchar(80) NOT NULL,
  status varchar(30) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  heartbeat_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO permissions (key, description) VALUES
  ('marketplaces.view', 'View tenant marketplace accounts and health'),
  ('marketplaces.manage', 'Manage tenant marketplace accounts and credentials'),
  ('marketplaces.sync', 'Queue marketplace shadow synchronization')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

COMMIT;
