import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../cache/cache.module';

export interface AuditLogEvent {
  action: string;
  actorId?: string | null;
  tenantId?: string | null;
  targetId?: string | null;
  requestId?: string | null;
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
             (action, actor_id, tenant_id, target_id, request_id, metadata, at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            payload.action,
            payload.actorId   ?? null,
            payload.tenantId  ?? null,
            payload.targetId  ?? null,
            payload.requestId ?? null,
            payload.metadata  ? JSON.stringify(payload.metadata) : null,
            new Date(payload.at),
          ],
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'unknown error';
        this.logger.warn(`Failed to persist audit event to DB: ${message}`);
      }
    }
  }
}
