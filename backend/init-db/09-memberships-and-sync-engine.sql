-- Idempotent multi-company/membership and sync-engine tracking migration.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by uuid,
  ADD COLUMN IF NOT EXISTS reactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS reactivated_by uuid;

CREATE TABLE IF NOT EXISTS user_tenant_memberships (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id      uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role           varchar(30)  NOT NULL DEFAULT 'user',
  user_level     varchar(30),
  dept           varchar(100),
  is_active      boolean      NOT NULL DEFAULT true,
  created_by     uuid         REFERENCES users(id) ON DELETE SET NULL,
  deactivated_at timestamptz,
  deactivated_by uuid         REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user_id ON user_tenant_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_tenant_id ON user_tenant_memberships(tenant_id);
CREATE INDEX IF NOT EXISTS idx_memberships_tenant_role ON user_tenant_memberships(tenant_id, role);

CREATE TABLE IF NOT EXISTS membership_permissions (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id  uuid         NOT NULL REFERENCES user_tenant_memberships(id) ON DELETE CASCADE,
  permission_key varchar(100) NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  granted_by     uuid         REFERENCES users(id) ON DELETE SET NULL,
  granted_at     timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (membership_id, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_membership_permissions_membership_id
ON membership_permissions(membership_id);

INSERT INTO user_tenant_memberships (
  user_id,
  tenant_id,
  role,
  user_level,
  dept,
  is_active,
  created_by,
  created_at,
  updated_at
)
SELECT
  u.id,
  u.tenant_id,
  CASE WHEN u.role = 'admin' THEN 'company_admin' ELSE COALESCE(u.role, 'user') END,
  u.user_level,
  u.dept,
  u.is_active,
  u.created_by,
  COALESCE(u.created_at, now()),
  COALESCE(u.updated_at, now())
FROM users u
WHERE u.tenant_id IS NOT NULL
ON CONFLICT (user_id, tenant_id)
DO UPDATE SET
  role = EXCLUDED.role,
  user_level = EXCLUDED.user_level,
  dept = EXCLUDED.dept,
  is_active = EXCLUDED.is_active,
  updated_at = now();

INSERT INTO membership_permissions (membership_id, permission_key, granted_by, granted_at)
SELECT m.id, p.key, up.granted_by, up.created_at
FROM user_tenant_memberships m
JOIN user_permissions up ON up.user_id = m.user_id
JOIN permissions p ON p.id = up.permission_id
ON CONFLICT (membership_id, permission_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS sync_runs (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module        varchar(50)  NOT NULL,
  sync_mode     varchar(30)  NOT NULL DEFAULT 'incremental',
  trigger_type  varchar(30)  NOT NULL DEFAULT 'scheduled',
  status        varchar(30)  NOT NULL,
  started_at    timestamptz  NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  failed_at     timestamptz,
  error_message text,
  total_rows    integer      NOT NULL DEFAULT 0,
  inserted_rows integer      NOT NULL DEFAULT 0,
  updated_rows  integer      NOT NULL DEFAULT 0,
  deleted_rows  integer      NOT NULL DEFAULT 0,
  created_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_tenant_started
ON sync_runs (tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_runs_tenant_module_started
ON sync_runs (tenant_id, module, started_at DESC);

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
  status        varchar(30)  NOT NULL DEFAULT 'running',
  queued_at     timestamptz  NOT NULL DEFAULT now(),
  started_at    timestamptz  NOT NULL DEFAULT now(),
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

CREATE INDEX IF NOT EXISTS idx_inventory_staging_run
ON inventory_staging (sync_run_id);

CREATE INDEX IF NOT EXISTS idx_inventory_staging_tenant_product
ON inventory_staging (tenant_id, jtl_product_id, jtl_warehouse_id);

ALTER TABLE sync_runs
  ADD COLUMN IF NOT EXISTS trigger_type varchar(30) NOT NULL DEFAULT 'scheduled',
  ADD COLUMN IF NOT EXISTS deleted_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE sync_runs DROP CONSTRAINT IF EXISTS sync_runs_status_check;
ALTER TABLE sync_runs
  ADD CONSTRAINT sync_runs_status_check CHECK (status IN ('queued','running','ok','failed','partial_failed','cancelled'));

ALTER TABLE sync_run_batches
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS module varchar(50),
  ADD COLUMN IF NOT EXISTS total_batches integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS checksum varchar(128),
  ADD COLUMN IF NOT EXISTS inserted_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_rows integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS queued_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS started_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;

ALTER TABLE sync_run_batches DROP CONSTRAINT IF EXISTS sync_run_batches_status_check;
ALTER TABLE sync_run_batches
  ADD CONSTRAINT sync_run_batches_status_check CHECK (status IN ('queued','processing','running','ok','failed','dead_letter'));

CREATE INDEX IF NOT EXISTS idx_sync_run_batches_tenant_module
ON sync_run_batches (tenant_id, module, created_at DESC);

CREATE TABLE IF NOT EXISTS sync_engine_installations (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  machine_id     varchar(100) NOT NULL,
  machine_name   varchar(255),
  engine_version varchar(50),
  os_version     varchar(100),
  last_seen_at   timestamptz,
  last_ip        inet,
  status         varchar(30)  NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('unknown','online','offline','outdated','error')),
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, machine_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_engine_installations_tenant_id
ON sync_engine_installations(tenant_id);

CREATE TABLE IF NOT EXISTS company_settings (
  tenant_id   uuid        PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  settings    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  sync_config jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_by  uuid        REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key        varchar(100) PRIMARY KEY,
  value      jsonb        NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid         REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz  NOT NULL DEFAULT now()
);
