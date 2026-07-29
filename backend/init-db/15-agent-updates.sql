CREATE TABLE IF NOT EXISTS agent_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id VARCHAR(80) NOT NULL DEFAULT 'JtlSyncEngine',
  channel VARCHAR(30) NOT NULL,
  version VARCHAR(50) NOT NULL,
  git_sha VARCHAR(64) NOT NULL,
  protocol_version INTEGER NOT NULL,
  package_path TEXT NOT NULL,
  package_size BIGINT,
  package_sha256 VARCHAR(64),
  manifest JSONB,
  manifest_signature TEXT,
  publisher_thumbprint VARCHAR(128) NOT NULL,
  minimum_supported_version VARCHAR(50),
  release_notes TEXT,
  health_timeout_seconds INTEGER NOT NULL DEFAULT 120,
  requires_service_restart BOOLEAN NOT NULL DEFAULT true,
  requires_machine_restart BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(30) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','validated','published','revoked','superseded','blocked')),
  published_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_agent_release_channel_version UNIQUE (channel, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_releases_status_channel
  ON agent_releases (status, channel, published_at DESC);

CREATE TABLE IF NOT EXISTS agent_update_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id VARCHAR(150) NOT NULL,
  release_id UUID NOT NULL REFERENCES agent_releases(id),
  requested_by UUID NOT NULL REFERENCES users(id),
  request_reason TEXT NOT NULL,
  install_mode VARCHAR(20) NOT NULL DEFAULT 'maintenance'
    CHECK (install_mode IN ('now','maintenance')),
  allow_retry BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(30) NOT NULL DEFAULT 'requested'
    CHECK (status IN (
      'requested','approved','claimed','downloading','verifying','staged',
      'waiting_for_window','installing','restarting','verifying_health',
      'completed','failed','rollback_started','rolled_back','cancelled','rejected'
    )),
  current_version VARCHAR(50),
  current_git_sha VARCHAR(64),
  target_version VARCHAR(50) NOT NULL,
  target_git_sha VARCHAR(64) NOT NULL,
  update_transaction_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  download_started_at TIMESTAMPTZ,
  staged_at TIMESTAMPTZ,
  install_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ,
  error_code VARCHAR(100),
  error_message TEXT,
  result JSONB,
  correlation_id UUID,
  requested_ip VARCHAR(100),
  requested_user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_updates_tenant_agent_status
  ON agent_update_requests (tenant_id, agent_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_updates_release
  ON agent_update_requests (release_id);
CREATE INDEX IF NOT EXISTS idx_agent_updates_transaction
  ON agent_update_requests (update_transaction_id);
CREATE INDEX IF NOT EXISTS idx_agent_updates_correlation
  ON agent_update_requests (correlation_id);
CREATE INDEX IF NOT EXISTS idx_agent_updates_requested
  ON agent_update_requests (requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_updates_active
  ON agent_update_requests (tenant_id, agent_id)
  WHERE status IN (
    'requested','approved','claimed','downloading','verifying','staged',
    'waiting_for_window','installing','restarting','verifying_health','rollback_started'
  );

ALTER TABLE agent_update_requests
  ADD COLUMN IF NOT EXISTS install_mode VARCHAR(20) NOT NULL DEFAULT 'maintenance',
  ADD COLUMN IF NOT EXISTS allow_retry BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS agent_bad_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id VARCHAR(150) NOT NULL,
  release_id UUID NOT NULL REFERENCES agent_releases(id),
  version VARCHAR(50) NOT NULL,
  failure_category VARCHAR(100) NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  rollback_result VARCHAR(50),
  suppressed_until TIMESTAMPTZ,
  permanently_blocked BOOLEAN NOT NULL DEFAULT false,
  last_failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, agent_id, release_id)
);

ALTER TABLE sync_agents
  ADD COLUMN IF NOT EXISTS protocol_version INTEGER,
  ADD COLUMN IF NOT EXISTS last_update_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_update_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS last_update_result JSONB,
  ADD COLUMN IF NOT EXISTS last_rollback_result JSONB;

INSERT INTO permissions (key, description) VALUES
  ('sync.agent.update', 'Request approved updates for company sync agents'),
  ('sync.agent.update.manage_releases', 'Manage and publish sync-agent releases'),
  ('sync.agent.update.retry_failed', 'Retry a previously failed sync-agent release')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO membership_permissions (membership_id, permission_key, granted_by)
SELECT m.id, permission_key, m.user_id
FROM user_tenant_memberships m
JOIN users u ON u.id = m.user_id
CROSS JOIN unnest(ARRAY['sync.agent.update']::text[]) permission_key
WHERE u.role = 'admin' AND m.is_active = true
ON CONFLICT (membership_id, permission_key) DO NOTHING;
