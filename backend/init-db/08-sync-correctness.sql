-- Idempotent sync-correctness migration for existing Docker volumes.

ALTER TABLE tenant_connections
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_module varchar(50),
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_success_module varchar(50),
  ADD COLUMN IF NOT EXISTS last_failure_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_failure_message text;

CREATE TABLE IF NOT EXISTS sync_runs (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module        varchar(50)  NOT NULL,
  sync_mode     varchar(20)  NOT NULL DEFAULT 'incremental' CHECK (sync_mode IN ('incremental','full')),
  status        varchar(20)  NOT NULL CHECK (status IN ('running','ok','failed')),
  started_at    timestamptz  NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  failed_at     timestamptz,
  error_message text,
  total_rows    integer      NOT NULL DEFAULT 0,
  inserted_rows integer      NOT NULL DEFAULT 0,
  updated_rows  integer      NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_tenant_started ON sync_runs (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_runs_tenant_module_started ON sync_runs (tenant_id, module, started_at DESC);

CREATE TABLE IF NOT EXISTS sync_run_batches (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id   uuid         NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  tenant_id     uuid         REFERENCES tenants(id) ON DELETE CASCADE,
  module        varchar(50),
  batch_index   integer      NOT NULL,
  total_batches integer      NOT NULL DEFAULT 1,
  checksum      varchar(128),
  row_count     integer      NOT NULL DEFAULT 0,
  inserted_rows integer      NOT NULL DEFAULT 0,
  updated_rows  integer      NOT NULL DEFAULT 0,
  status        varchar(30)  NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','running','ok','failed','dead_letter')),
  queued_at     timestamptz  NOT NULL DEFAULT now(),
  started_at    timestamptz,
  completed_at  timestamptz,
  failed_at     timestamptz,
  duration_ms   integer,
  error_message text,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (sync_run_id, batch_index)
);

CREATE TABLE IF NOT EXISTS inventory_staging (
  id               bigserial     PRIMARY KEY,
  sync_run_id      uuid          NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  tenant_id        uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  jtl_product_id   bigint        NOT NULL,
  jtl_warehouse_id bigint        NOT NULL DEFAULT 0,
  warehouse_name   varchar(255),
  available        numeric(12,3) NOT NULL DEFAULT 0,
  reserved         numeric(12,3) NOT NULL DEFAULT 0,
  total            numeric(12,3) NOT NULL DEFAULT 0,
  reorder_point    numeric(12,3) NOT NULL DEFAULT 0,
  is_low_stock     boolean       NOT NULL DEFAULT false,
  created_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_staging_run ON inventory_staging (sync_run_id);
CREATE INDEX IF NOT EXISTS idx_inventory_staging_tenant_product ON inventory_staging (tenant_id, jtl_product_id, jtl_warehouse_id);
