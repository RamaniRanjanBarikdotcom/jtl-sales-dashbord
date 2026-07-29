ALTER TABLE sync_agents ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE sync_agents ADD COLUMN IF NOT EXISTS last_failure_at timestamptz;
ALTER TABLE sync_agents ADD COLUMN IF NOT EXISTS last_failure_message text;

CREATE INDEX IF NOT EXISTS idx_sync_agents_tenant_machine
  ON sync_agents (tenant_id, machine_name);
CREATE INDEX IF NOT EXISTS idx_sync_agents_tenant_enabled
  ON sync_agents (tenant_id, is_enabled);
CREATE INDEX IF NOT EXISTS idx_sync_commands_active
  ON sync_commands (tenant_id, agent_id, status);

ALTER TABLE sync_command_events ALTER COLUMN details SET DEFAULT '{}'::jsonb;

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'sync_commands'
    AND c.contype = 'u'
    AND pg_get_constraintdef(c.oid) LIKE '%(tenant_id, idempotency_key)%'
  LIMIT 1;
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE sync_commands DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_commands_active_idempotency
  ON sync_commands (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND status IN ('queued','claimed','running','cancel_requested');

INSERT INTO permissions (key, description) VALUES
  ('sync.pause', 'Pause scheduled synchronization'),
  ('sync.resume', 'Resume scheduled synchronization')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO membership_permissions (membership_id, permission_key, granted_by)
SELECT m.id, permission_key, m.user_id
FROM user_tenant_memberships m
JOIN users u ON u.id = m.user_id
CROSS JOIN unnest(ARRAY['sync.pause','sync.resume']::text[]) permission_key
WHERE u.role = 'admin' AND m.is_active = true
ON CONFLICT (membership_id, permission_key) DO NOTHING;
