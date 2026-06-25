-- ============================================================
-- Dashboard-controlled manual sync command queue.
-- Safe to rerun against existing databases.
-- ============================================================

ALTER TABLE sync_triggers
  ADD COLUMN IF NOT EXISTS sync_mode varchar(30) NOT NULL DEFAULT 'incremental',
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS requested_by uuid NULL,
  ADD COLUMN IF NOT EXISTS started_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS engine_id varchar(100) NULL,
  ADD COLUMN IF NOT EXISTS progress_percent integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_batch integer NULL,
  ADD COLUMN IF NOT EXISTS total_batches integer NULL,
  ADD COLUMN IF NOT EXISTS rows_synced integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_message text NULL,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE sync_triggers
SET status = 'completed'
WHERE status = 'done';

UPDATE sync_triggers
SET requested_by = COALESCE(requested_by, triggered_by),
    progress_percent = CASE WHEN status = 'completed' THEN 100 ELSE COALESCE(progress_percent, 0) END,
    completed_at = CASE WHEN status = 'completed' THEN COALESCE(completed_at, updated_at, created_at) ELSE completed_at END,
    failed_at = CASE WHEN status = 'failed' THEN COALESCE(failed_at, completed_at, updated_at, created_at) ELSE failed_at END,
    expires_at = COALESCE(expires_at, created_at + INTERVAL '6 hours'),
    updated_at = COALESCE(updated_at, created_at);

DO $$
BEGIN
  ALTER TABLE sync_triggers DROP CONSTRAINT IF EXISTS sync_triggers_status_check;
  ALTER TABLE sync_triggers DROP CONSTRAINT IF EXISTS sync_triggers_sync_mode_check;
  ALTER TABLE sync_triggers DROP CONSTRAINT IF EXISTS sync_triggers_module_check;
END $$;

ALTER TABLE sync_triggers
  ADD CONSTRAINT sync_triggers_status_check
    CHECK (status IN ('pending','picked','running','completed','failed','cancelled','expired')),
  ADD CONSTRAINT sync_triggers_sync_mode_check
    CHECK (sync_mode IN ('incremental','full')),
  ADD CONSTRAINT sync_triggers_module_check
    CHECK (module IN ('orders','products','customers','inventory'));

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_id, module
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM sync_triggers
  WHERE status IN ('pending','picked','running')
)
UPDATE sync_triggers st
SET status = 'expired',
    result_message = 'Expired during active trigger de-duplication',
    updated_at = now()
FROM ranked r
WHERE st.id = r.id
  AND r.rn > 1;

CREATE INDEX IF NOT EXISTS idx_sync_triggers_tenant_status
ON sync_triggers (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_triggers_tenant_module_status
ON sync_triggers (tenant_id, module, status);

CREATE INDEX IF NOT EXISTS idx_sync_triggers_engine
ON sync_triggers (engine_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS ux_sync_triggers_active_tenant_module
ON sync_triggers (tenant_id, module)
WHERE status IN ('pending','picked','running');

ALTER TABLE sync_engine_installations
  ADD COLUMN IF NOT EXISTS status varchar(30) NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_sync_engine_installations_tenant
ON sync_engine_installations (tenant_id, last_seen_at DESC);
