CREATE TABLE IF NOT EXISTS sync_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id VARCHAR(150) NOT NULL,
  display_name VARCHAR(150) NOT NULL,
  machine_name VARCHAR(150),
  service_version VARCHAR(50),
  git_sha VARCHAR(64),
  scheduler_state VARCHAR(30),
  current_job VARCHAR(100),
  current_command_id UUID,
  jtl_connection_status VARCHAR(30),
  backend_connection_status VARCHAR(30),
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_heartbeat_at TIMESTAMPTZ,
  last_successful_sync_at TIMESTAMPTZ,
  next_scheduled_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, agent_id)
);
CREATE INDEX IF NOT EXISTS idx_sync_agents_tenant_heartbeat ON sync_agents (tenant_id, last_heartbeat_at DESC);

CREATE TABLE IF NOT EXISTS sync_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id VARCHAR(150) NOT NULL,
  command_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(30) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','claimed','running','completed','failed','cancel_requested','cancelled','expired','interrupted','rejected')),
  priority INTEGER NOT NULL DEFAULT 100,
  idempotency_key VARCHAR(200),
  requested_by UUID REFERENCES users(id),
  request_reason TEXT,
  requested_ip VARCHAR(100),
  requested_user_agent TEXT,
  progress_percent INTEGER CHECK (progress_percent BETWEEN 0 AND 100),
  progress_message TEXT,
  rows_processed BIGINT,
  current_batch INTEGER,
  total_batches INTEGER,
  claimed_at TIMESTAMPTZ,
  lease_until TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  result JSONB,
  error_code VARCHAR(100),
  error_message TEXT,
  cancellation_requested_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_sync_commands_queue ON sync_commands (tenant_id, agent_id, status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_commands_history ON sync_commands (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sync_command_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  command_id UUID NOT NULL REFERENCES sync_commands(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  message TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sync_command_events_command ON sync_command_events (tenant_id, command_id, created_at);

CREATE TABLE IF NOT EXISTS system_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  source VARCHAR(50) NOT NULL,
  module VARCHAR(80),
  event_type VARCHAR(120) NOT NULL,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('debug','info','warning','error','critical')),
  status VARCHAR(30),
  message TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id),
  agent_id VARCHAR(150),
  correlation_id VARCHAR(128),
  request_id VARCHAR(128),
  sync_run_id UUID,
  command_id UUID,
  rows_processed BIGINT,
  duration_ms BIGINT,
  service_version VARCHAR(50),
  git_sha VARCHAR(64),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  event_key VARCHAR(200),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE system_events ADD COLUMN IF NOT EXISTS event_key VARCHAR(200);
CREATE INDEX IF NOT EXISTS idx_system_events_tenant_occurred ON system_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_severity_occurred ON system_events (severity, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_correlation ON system_events (correlation_id);
CREATE INDEX IF NOT EXISTS idx_system_events_source_occurred ON system_events (source, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_module_occurred ON system_events (module, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_type_occurred ON system_events (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_status_occurred ON system_events (status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_agent_occurred ON system_events (agent_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_sync_run ON system_events (sync_run_id);
CREATE INDEX IF NOT EXISTS idx_system_events_command ON system_events (command_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_system_events_agent_event_key
  ON system_events (tenant_id, agent_id, event_key) WHERE event_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  actor_id TEXT,
  tenant_id TEXT,
  target_id TEXT,
  request_id TEXT,
  metadata JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS outcome VARCHAR(30) NOT NULL DEFAULT 'success';
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(128);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_time ON audit_logs (tenant_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation_id ON audit_logs (correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_time ON audit_logs (action, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_time ON audit_logs (actor_id, at DESC);

ALTER TABLE sync_commands ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(128);

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) NOT NULL DEFAULT 'Europe/Berlin';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'EUR';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS locale VARCHAR(20) NOT NULL DEFAULT 'de-DE';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS week_starts_on VARCHAR(10) NOT NULL DEFAULT 'monday';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS fiscal_year_start_month SMALLINT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL DEFAULT 'New conversation',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_tenant_user ON ai_conversations (tenant_id, user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tool_name VARCHAR(100) NOT NULL,
  arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL,
  duration_ms INTEGER,
  error_code VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_query_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_call_id UUID NOT NULL REFERENCES ai_tool_calls(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  result JSONB NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
  comment VARCHAR(1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, message_id)
);

INSERT INTO permissions (key, description)
SELECT permission_key, 'Unified operations permission'
FROM unnest(ARRAY[
  'sync.status.view','sync.history.view','sync.run.incremental','sync.resync.inventory',
  'sync.resync.products','sync.resync.orders','sync.resync.customers','sync.resync.full',
  'sync.cancel','sync.diagnostics','sync.manage_agents','logs.system.view','logs.audit.view',
  'logs.security.view','logs.export','logs.stacktrace.view','logs.tenant.view',
  'ai.analytics.use','ai.sales.view','ai.products.view','ai.inventory.view',
  'ai.customers.aggregate.view','ai.customers.details.view','ai.operations.view','ai.logs.view',
  'ai.conversations.manage','ai.feedback.submit','ai.admin.view_usage'
]::text[]) permission_key
ON CONFLICT (key) DO NOTHING;

INSERT INTO membership_permissions (membership_id, permission_key, granted_by)
SELECT m.id, permission_key, m.user_id
FROM user_tenant_memberships m
JOIN users u ON u.id=m.user_id
CROSS JOIN unnest(ARRAY[
  'sync.status.view','sync.history.view','sync.run.incremental','sync.resync.inventory',
  'sync.resync.products','sync.resync.orders','sync.resync.customers','sync.resync.full',
  'sync.cancel','sync.diagnostics','sync.manage_agents','logs.system.view','logs.audit.view',
  'logs.security.view','logs.export','logs.stacktrace.view','logs.tenant.view',
  'ai.analytics.use','ai.sales.view','ai.products.view','ai.inventory.view',
  'ai.customers.aggregate.view','ai.operations.view','ai.logs.view',
  'ai.conversations.manage','ai.feedback.submit','ai.admin.view_usage'
]::text[]) permission_key
WHERE u.role='admin' AND m.is_active=true
ON CONFLICT (membership_id, permission_key) DO NOTHING;
