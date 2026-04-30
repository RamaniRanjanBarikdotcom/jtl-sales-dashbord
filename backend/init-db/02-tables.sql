-- ============================================================
-- JTL Analytics — Full Schema
-- Run after 01-extensions.sql
-- ============================================================

-- ── tenants ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        varchar(255) NOT NULL,
  slug        varchar(100) UNIQUE NOT NULL,
  is_active   boolean      NOT NULL DEFAULT true,
  timezone    varchar(50)  NOT NULL DEFAULT 'Europe/Berlin',
  currency    varchar(3)   NOT NULL DEFAULT 'EUR',
  vat_rate    numeric(5,4) NOT NULL DEFAULT 0.19,
  created_by  uuid,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

-- ── tenant_connections ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_connections (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid        NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  sync_api_key_hash         varchar(255) NOT NULL,
  sync_api_key_prefix       varchar(10),
  sync_api_key_last_rotated timestamptz,
  is_active                 boolean     NOT NULL DEFAULT true,
  last_ingest_at            timestamptz,
  last_ingest_module        varchar(50),
  created_at                timestamptz NOT NULL DEFAULT now()
);

-- ── users ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        REFERENCES tenants(id) ON DELETE SET NULL,
  email                 varchar(255) UNIQUE NOT NULL,
  password_hash         varchar(255) NOT NULL,
  full_name             varchar(255) NOT NULL,
  role                  varchar(20)  NOT NULL CHECK (role IN ('super_admin','admin','user')),
  user_level            varchar(20)  CHECK (user_level IN ('viewer','analyst','manager')),
  dept                  varchar(100),
  is_active             boolean      NOT NULL DEFAULT true,
  must_change_pwd       boolean      NOT NULL DEFAULT true,
  failed_login_attempts integer      NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  created_by            uuid         REFERENCES users(id) ON DELETE SET NULL,
  preferences           jsonb,
  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_tenant_role ON users (tenant_id, role);
CREATE INDEX IF NOT EXISTS idx_users_email       ON users (email);

-- ── permissions / RBAC ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS permissions (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  key         varchar(100) UNIQUE NOT NULL,
  description text,
  created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  role          varchar(30)  NOT NULL,
  permission_id uuid         NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (role, permission_id)
);

CREATE TABLE IF NOT EXISTS user_permissions (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id uuid         NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_by    uuid         REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (user_id, permission_id)
);

-- ── sync_watermarks ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_watermarks (
  id             bigserial    PRIMARY KEY,
  tenant_id      uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_name       varchar(50)  NOT NULL,
  last_synced_at timestamptz  NOT NULL,
  last_row_count integer      NOT NULL DEFAULT 0,
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, job_name)
);

-- ── sync_log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sync_log (
  id             bigserial    PRIMARY KEY,
  tenant_id      uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_name       varchar(50)  NOT NULL,
  trigger_type   varchar(20)  NOT NULL CHECK (trigger_type IN ('scheduled','idle','manual')),
  status         varchar(10)  NOT NULL CHECK (status IN ('running','ok','warn','error')),
  rows_extracted integer      NOT NULL DEFAULT 0,
  rows_inserted  integer      NOT NULL DEFAULT 0,
  rows_updated   integer      NOT NULL DEFAULT 0,
  duration_ms    integer,
  error_message  text,
  started_at     timestamptz  NOT NULL,
  completed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sync_log_tenant_started ON sync_log (tenant_id, started_at DESC);

-- ── sync_triggers (manual sync trigger queue) ─────────────────
-- Populated by admin dashboard; polled by .NET sync engine every 10s.
CREATE TABLE IF NOT EXISTS sync_triggers (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module         varchar(50)  NOT NULL CHECK (module IN ('orders','products','customers','inventory')),
  status         varchar(20)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','picked','done','failed')),
  triggered_by   uuid,
  result_message text,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  picked_at      timestamptz,
  completed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sync_triggers_tenant_status ON sync_triggers (tenant_id, status);

-- ── orders (partitioned by range on order_date) ───────────────
CREATE TABLE IF NOT EXISTS orders (
  id              bigserial     NOT NULL,
  tenant_id       uuid          NOT NULL,
  jtl_order_id    bigint        NOT NULL,
  order_number    varchar(50),
  order_date      date          NOT NULL,
  customer_id     bigint,
  gross_revenue   numeric(12,2) NOT NULL,
  net_revenue     numeric(12,2),
  shipping_cost   numeric(10,2),
  cost_of_goods   numeric(12,2),
  gross_margin    numeric(5,2),
  status          varchar(30),
  channel         varchar(50),
  region          varchar(50),
  postcode        varchar(32),
  city            varchar(255),
  country         varchar(100),
  item_count      integer,
  jtl_modified_at       timestamptz,
  external_order_number varchar(100),
  customer_number       varchar(50),
  payment_method        varchar(100),
  shipping_method       varchar(100),
  synced_at             timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  -- PK must include partition key (order_date) for partitioned tables
  CONSTRAINT orders_pkey PRIMARY KEY (id, order_date),
  UNIQUE (tenant_id, jtl_order_id, order_date)
) PARTITION BY RANGE (order_date);

CREATE INDEX IF NOT EXISTS idx_orders_tenant_date    ON orders (tenant_id, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_status  ON orders (tenant_id, status, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_channel ON orders (tenant_id, channel, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_region  ON orders (tenant_id, region, order_date DESC);

-- ── order_items ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id               bigserial     PRIMARY KEY,
  tenant_id        uuid          NOT NULL,
  jtl_item_id      bigint        NOT NULL,
  order_id         bigint,
  product_id       bigint,
  quantity         numeric(10,3),
  unit_price_gross numeric(12,2),
  unit_price_net   numeric(12,2),
  unit_cost        numeric(12,2),
  line_total_gross numeric(12,2),
  discount_pct     numeric(5,2)  NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, jtl_item_id)
);

CREATE INDEX IF NOT EXISTS idx_order_items_tenant_order   ON order_items (tenant_id, order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_tenant_product ON order_items (tenant_id, product_id);

-- ── products ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id              bigserial     PRIMARY KEY,
  tenant_id       uuid          NOT NULL,
  jtl_product_id  bigint        NOT NULL,
  article_number  varchar(100),
  name            varchar(500)  NOT NULL,
  category_id     bigint,
  ean             varchar(50),
  unit_cost       numeric(12,2),
  list_price_net  numeric(12,2),
  list_price_gross numeric(12,2),
  is_active       boolean       NOT NULL DEFAULT true,
  weight_kg       numeric(8,3),
  stock_quantity  numeric(12,2) NOT NULL DEFAULT 0,
  jtl_modified_at timestamptz,
  synced_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, jtl_product_id)
);

-- ── categories ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id              bigserial    PRIMARY KEY,
  tenant_id       uuid         NOT NULL,
  jtl_category_id bigint       NOT NULL,
  name            varchar(500),
  parent_id       bigint       REFERENCES categories(id) ON DELETE SET NULL,
  level           integer      NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, jtl_category_id)
);

-- ── customers ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id                    bigserial     PRIMARY KEY,
  tenant_id             uuid          NOT NULL,
  jtl_customer_id       bigint        NOT NULL,
  email                 varchar(255),
  first_name            varchar(255),
  last_name             varchar(255),
  company               varchar(500),
  postcode              varchar(32),
  city                  varchar(255),
  country_code          varchar(100)  NOT NULL DEFAULT 'DE',
  region                varchar(50),
  total_orders          integer       NOT NULL DEFAULT 0,
  total_revenue         numeric(12,2) NOT NULL DEFAULT 0,
  first_order_date      date,
  last_order_date       date,
  days_since_last_order integer,
  ltv                   numeric(12,2) NOT NULL DEFAULT 0,
  segment               varchar(20),
  rfm_score             varchar(3),
  jtl_modified_at       timestamptz,
  synced_at             timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, jtl_customer_id)
);

-- ── inventory ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory (
  id               bigserial     PRIMARY KEY,
  tenant_id        uuid          NOT NULL,
  jtl_product_id   bigint        NOT NULL,
  jtl_warehouse_id bigint        NOT NULL,
  product_id       bigint        REFERENCES products(id) ON DELETE SET NULL,
  warehouse_name   varchar(255),
  available        numeric(12,3) NOT NULL DEFAULT 0,
  reserved         numeric(12,3) NOT NULL DEFAULT 0,
  total            numeric(12,3) NOT NULL DEFAULT 0,
  reorder_point    numeric(12,3) NOT NULL DEFAULT 0,
  is_low_stock     boolean       NOT NULL DEFAULT false,
  days_of_stock    integer,
  synced_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, jtl_product_id, jtl_warehouse_id)
);

-- ── marketing_campaigns ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id          bigserial     PRIMARY KEY,
  tenant_id   uuid          NOT NULL,
  platform    varchar(20)   NOT NULL CHECK (platform IN ('google','meta','email','other')),
  external_id varchar(100),
  name        varchar(500),
  status      varchar(20),
  budget_daily numeric(10,2),
  synced_at   timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, platform, external_id)
);

-- ── marketing_metrics ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_metrics (
  id               bigserial     PRIMARY KEY,
  tenant_id        uuid          NOT NULL,
  campaign_id      bigint        REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  date             date          NOT NULL,
  platform         varchar(20),
  impressions      bigint        NOT NULL DEFAULT 0,
  clicks           bigint        NOT NULL DEFAULT 0,
  spend            numeric(10,2) NOT NULL DEFAULT 0,
  conversions      integer       NOT NULL DEFAULT 0,
  conversion_value numeric(12,2) NOT NULL DEFAULT 0,
  cpc              numeric(8,4)  GENERATED ALWAYS AS (spend / NULLIF(clicks, 0)) STORED,
  cpa              numeric(10,2) GENERATED ALWAYS AS (spend / NULLIF(conversions, 0)) STORED,
  roas             numeric(8,4)  GENERATED ALWAYS AS (conversion_value / NULLIF(spend, 0)) STORED,
  synced_at        timestamptz,
  UNIQUE (tenant_id, campaign_id, date)
);

-- ── revoked_tokens ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti        varchar(100) PRIMARY KEY,
  revoked_at timestamptz  NOT NULL DEFAULT now(),
  expires_at timestamptz  NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens (expires_at);

-- ── Auto-update updated_at via trigger ───────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants','users','products','customers','inventory']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at
       BEFORE UPDATE ON %s
       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
      t, t
    );
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
