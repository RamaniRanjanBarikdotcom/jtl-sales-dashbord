BEGIN;

CREATE TABLE IF NOT EXISTS marketplace_feedback_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  marketplace_account_id uuid NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  marketplace varchar(30) NOT NULL,
  source_key varchar(120) NOT NULL,
  source_type varchar(40) NOT NULL CHECK (source_type IN (
    'OFFICIAL_API','PRIVATE_MARKETPLACE_FEED','PORTAL_EXPORT',
    'AUTHORIZED_SYNDICATION','LICENSED_PROVIDER','OPERATIONAL_PROXY'
  )),
  provider_name varchar(160),
  display_name varchar(200) NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'UNVERIFIED' CHECK (status IN (
    'UNVERIFIED','ACTIVE','NOT_AUTHORIZED','NOT_SUPPORTED','ERROR','DISABLED'
  )),
  credential_reference uuid,
  enabled boolean NOT NULL DEFAULT false,
  storage_allowed boolean NOT NULL DEFAULT false,
  display_allowed boolean NOT NULL DEFAULT false,
  sentiment_allowed boolean NOT NULL DEFAULT false,
  retention_days integer CHECK (retention_days IS NULL OR retention_days > 0),
  priority integer NOT NULL DEFAULT 100,
  last_tested_at timestamptz,
  last_successful_sync_at timestamptz,
  last_failed_sync_at timestamptz,
  last_error_code varchar(120),
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, marketplace_account_id, source_key)
);
CREATE INDEX IF NOT EXISTS idx_marketplace_feedback_sources_account
  ON marketplace_feedback_sources (tenant_id, marketplace_account_id, enabled, priority);

CREATE TABLE IF NOT EXISTS marketplace_feedback_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  marketplace_account_id uuid NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  feedback_source_id uuid NOT NULL REFERENCES marketplace_feedback_sources(id) ON DELETE CASCADE,
  resource_type varchar(50) NOT NULL,
  availability varchar(30) NOT NULL CHECK (availability IN (
    'UNKNOWN','DISCOVERING','AVAILABLE','NOT_AUTHORIZED','NOT_SUPPORTED',
    'EXTERNAL_SOURCE_REQUIRED','ERROR'
  )),
  coverage varchar(40) NOT NULL CHECK (coverage IN (
    'FULL','PARTIAL','AGGREGATE_ONLY','INSIGHTS_ONLY','SELLER_FEEDBACK_ONLY',
    'ORDER_EVALUATION_ONLY','OPERATIONAL_SIGNALS_ONLY','NONE','UNKNOWN'
  )),
  reason_code varchar(120),
  message text,
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feedback_source_id, resource_type)
);
CREATE INDEX IF NOT EXISTS idx_marketplace_feedback_capability_account
  ON marketplace_feedback_capabilities (tenant_id, marketplace_account_id, resource_type);

ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS feedback_source_id uuid
  REFERENCES marketplace_feedback_sources(id) ON DELETE SET NULL;
ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS feedback_type varchar(40)
  NOT NULL DEFAULT 'PRODUCT_REVIEW';
ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS source_type varchar(40);
ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS source_provider varchar(160);
ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS marketplace_product_id varchar(300);
ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS marketplace_listing_id varchar(300);
ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS jtl_product_id bigint;
ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS external_order_id varchar(300);
ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS external_order_item_id varchar(300);
ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS rating_scale numeric(6,2) NOT NULL DEFAULT 5;
ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS body text;
ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS language varchar(20);
ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS reviewer_external_id_hash varchar(128);
ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS reviewer_public_name varchar(300);
ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;
ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS moderation_status varchar(40);
ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS visible boolean NOT NULL DEFAULT true;
ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS content_hash varchar(64);
ALTER TABLE marketplace_reviews ADD COLUMN IF NOT EXISTS raw_entity_id uuid
  REFERENCES marketplace_raw_entities(id) ON DELETE SET NULL;
UPDATE marketplace_reviews
SET marketplace_product_id = COALESCE(marketplace_product_id, external_product_id),
    body = COALESCE(body, review_text)
WHERE marketplace_product_id IS NULL OR body IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_review_source_external
  ON marketplace_reviews (feedback_source_id, external_review_id)
  WHERE feedback_source_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_marketplace_review_source_content
  ON marketplace_reviews (feedback_source_id, content_hash)
  WHERE feedback_source_id IS NOT NULL AND content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS marketplace_review_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  marketplace_account_id uuid NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  feedback_source_id uuid NOT NULL REFERENCES marketplace_feedback_sources(id) ON DELETE CASCADE,
  marketplace varchar(30) NOT NULL,
  marketplace_product_id varchar(300),
  jtl_product_id bigint,
  asin varchar(30),
  marketplace_id varchar(40),
  insight_scope varchar(20) NOT NULL CHECK (insight_scope IN ('ITEM','BROWSE_NODE')),
  topic varchar(500) NOT NULL,
  sentiment varchar(30),
  sort_type varchar(30) NOT NULL CHECK (sort_type IN ('MENTIONS','STAR_RATING_IMPACT')),
  mentions integer,
  occurrence_percentage numeric(8,4),
  star_rating_impact numeric(8,4),
  customer_snippets jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_period_start timestamptz,
  source_period_end timestamptz NOT NULL,
  source_updated_at timestamptz,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  raw_entity_id uuid REFERENCES marketplace_raw_entities(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feedback_source_id, asin, insight_scope, topic, sentiment, sort_type, source_period_end)
);
CREATE INDEX IF NOT EXISTS idx_mp_review_insights_product
  ON marketplace_review_insights (tenant_id, marketplace_account_id, jtl_product_id, source_period_end DESC);

CREATE TABLE IF NOT EXISTS marketplace_review_trends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  marketplace_account_id uuid NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  feedback_source_id uuid NOT NULL REFERENCES marketplace_feedback_sources(id) ON DELETE CASCADE,
  marketplace varchar(30) NOT NULL,
  marketplace_product_id varchar(300),
  jtl_product_id bigint,
  asin varchar(30),
  marketplace_id varchar(40),
  topic varchar(500) NOT NULL,
  sentiment varchar(30),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  occurrence_percentage numeric(8,4),
  star_rating_impact numeric(8,4),
  source_updated_at timestamptz,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  raw_entity_id uuid REFERENCES marketplace_raw_entities(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feedback_source_id, asin, topic, sentiment, period_start)
);
CREATE INDEX IF NOT EXISTS idx_mp_review_trends_product_period
  ON marketplace_review_trends (tenant_id, marketplace_account_id, jtl_product_id, period_start DESC);

CREATE TABLE IF NOT EXISTS marketplace_rating_aggregates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  marketplace_account_id uuid NOT NULL REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
  feedback_source_id uuid NOT NULL REFERENCES marketplace_feedback_sources(id) ON DELETE CASCADE,
  marketplace varchar(30) NOT NULL,
  marketplace_product_id varchar(300) NOT NULL,
  marketplace_listing_id varchar(300),
  jtl_product_id bigint,
  average_rating numeric(8,4),
  rating_scale numeric(8,4),
  review_count bigint,
  rating_1_count bigint,
  rating_2_count bigint,
  rating_3_count bigint,
  rating_4_count bigint,
  rating_5_count bigint,
  source_updated_at timestamptz,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  raw_entity_id uuid REFERENCES marketplace_raw_entities(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (feedback_source_id, marketplace_product_id)
);
CREATE INDEX IF NOT EXISTS idx_mp_rating_aggregates_product
  ON marketplace_rating_aggregates (tenant_id, marketplace_account_id, jtl_product_id);

COMMIT;
