import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../cache/cache.module';
import { sanitizeMetadata } from '../utils/metadata-sanitizer';

export interface AuditLogEvent {
  action: string;
  actorId?: string | null;
  tenantId?: string | null;
  targetId?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  outcome?: string;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  at?: string;
}

@Injectable()
export class AuditService implements OnModuleInit {
  private readonly logger = new Logger(AuditService.name);
  private dbAvailable = false;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    try {
      await this.dataSource.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id         BIGSERIAL PRIMARY KEY,
          action     TEXT NOT NULL,
          actor_id   TEXT,
          tenant_id  TEXT,
          target_id  TEXT,
          request_id TEXT,
          metadata   JSONB,
          at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS audit_logs_at_idx     ON audit_logs (at DESC)`,
      );
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS audit_logs_tenant_idx ON audit_logs (tenant_id)`,
      );
      await this.dataSource.query(`
        ALTER TABLE audit_logs
          ADD COLUMN IF NOT EXISTS outcome VARCHAR(30) NOT NULL DEFAULT 'success',
          ADD COLUMN IF NOT EXISTS reason TEXT,
          ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(128)
      `);
      this.dbAvailable = true;
      this.logger.log('Audit log table ready');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Audit DB init failed, falling back to Redis only: ${message}`);
    }
  }

  async getRecentLogs(limit = 100): Promise<AuditLogEvent[]> {
    if (this.dbAvailable) {
      try {
        const rows = await this.dataSource.query<Record<string, unknown>[]>(
          `SELECT action,
                  actor_id   AS "actorId",
                  tenant_id  AS "tenantId",
                  target_id  AS "targetId",
                  request_id AS "requestId",
                  correlation_id AS "correlationId",
                  outcome,
                  reason,
                  metadata,
                  at
           FROM audit_logs
           ORDER BY at DESC
           LIMIT $1`,
          [Math.min(limit, 1000)],
        );
        return rows.map((r) => ({
          action:    String(r.action),
          actorId:   r.actorId   != null ? String(r.actorId)   : undefined,
          tenantId:  r.tenantId  != null ? String(r.tenantId)  : undefined,
          targetId:  r.targetId  != null ? String(r.targetId)  : undefined,
          requestId: r.requestId != null ? String(r.requestId) : undefined,
          correlationId: r.correlationId != null ? String(r.correlationId) : undefined,
          outcome: r.outcome != null ? String(r.outcome) : undefined,
          reason: r.reason != null ? String(r.reason) : undefined,
          metadata:  r.metadata  as Record<string, unknown> | undefined,
          at:        r.at instanceof Date ? r.at.toISOString() : String(r.at),
        }));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error';
        this.logger.warn(`Audit DB read failed, falling back to Redis: ${message}`);
      }
    }
    try {
      const raw = await this.redis.lrange('audit:events', 0, Math.min(limit, 1000) - 1);
      return raw.map((r) => {
        try { return JSON.parse(r) as AuditLogEvent; }
        catch { return null; }
      }).filter(Boolean) as AuditLogEvent[];
    } catch {
      return [];
    }
  }

  async log(event: AuditLogEvent): Promise<void> {
    const payload = {
      ...event,
      metadata: event.metadata ? sanitizeMetadata(event.metadata) : undefined,
      at: event.at ?? new Date().toISOString(),
    };

    this.logger.log(`[AUDIT] ${payload.action} ${JSON.stringify(payload)}`);

    // Write to Redis (fast, volatile — for real-time queries)
    try {
      await this.redis
        .multi()
        .lpush('audit:events', JSON.stringify(payload))
        .ltrim('audit:events', 0, 4999)
        .exec();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown audit redis error';
      this.logger.warn(`Failed to persist audit event to Redis: ${message}`);
    }

    // Write to Postgres (durable — survives Redis eviction/restart)
    if (this.dbAvailable) {
      try {
        await this.dataSource.query(
          `INSERT INTO audit_logs
             (action, actor_id, tenant_id, target_id, request_id, correlation_id,
              outcome, reason, metadata, at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            payload.action,
            payload.actorId   ?? null,
            payload.tenantId  ?? null,
            payload.targetId  ?? null,
            payload.requestId ?? null,
            payload.correlationId ?? null,
            payload.outcome ?? 'success',
            payload.reason ?? null,
            payload.metadata  ? JSON.stringify(payload.metadata) : null,
            new Date(payload.at),
          ],
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error';
        this.logger.warn(`Failed to persist audit event to DB: ${message}`);
      }
    }
    await this.mirrorOperationalEvent(payload);
  }

  private async mirrorOperationalEvent(payload: AuditLogEvent & { at: string }): Promise<void> {
    if (String(process.env.SYSTEM_LOGS_ENABLED).toLowerCase() !== 'true') return;
    const mapping: Record<string, { type: string; source: string; severity: string }> = {
      'auth.login.failed': { type: 'auth.login.failed',source: 'authentication',severity: 'warning' },
      'auth.login.success': { type: 'auth.login.succeeded',source: 'authentication',severity: 'info' },
      'access.denied': { type: 'access.denied',source: 'authentication',severity: 'warning' },
      'auth.switch_company': { type: 'tenant.switched',source: 'authentication',severity: 'info' },
      'admin.switched_company': { type: 'tenant.switched',source: 'admin',severity: 'info' },
      'user.permission_changed': { type: 'user.permission_changed',source: 'admin',severity: 'warning' },
      'sync.manual_triggered': { type: 'sync.started',source: 'admin',severity: 'info' },
      'sync.ingest.success': { type: 'sync.completed',source: 'sync-engine',severity: 'info' },
      'sync.ingest.failure': { type: 'sync.failed',source: 'sync-engine',severity: 'error' },
      'sync.ingest.retry': { type: 'sync.retrying',source: 'sync-engine',severity: 'warning' },
    };
    const mapped = mapping[payload.action];
    if (!mapped || !this.dbAvailable) return;
    try {
      const metadata = { ...(payload.metadata ?? {}) };
      delete metadata.email;
      delete metadata.address;
      await this.dataSource.query(
        `INSERT INTO system_events
         (tenant_id,source,event_type,severity,status,message,actor_user_id,
          correlation_id,request_id,metadata,occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [payload.tenantId ?? null,mapped.source,mapped.type,mapped.severity,
          payload.outcome ?? 'success',payload.action,payload.actorId ?? null,
          payload.correlationId ?? payload.requestId ?? null,payload.requestId ?? null,
          JSON.stringify(sanitizeMetadata(metadata)),new Date(payload.at)],
      );
    } catch (error: unknown) {
      this.logger.warn(
        `Operational event mirror failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
