import { Injectable, Inject, Logger } from '@nestjs/common';
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
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async getRecentLogs(limit = 100): Promise<AuditLogEvent[]> {
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

    try {
      await this.redis
        .multi()
        .lpush('audit:events', JSON.stringify(payload))
        .ltrim('audit:events', 0, 4999)
        .exec();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown audit redis error';
      this.logger.warn(`Failed to persist audit event: ${message}`);
    }
  }
}
