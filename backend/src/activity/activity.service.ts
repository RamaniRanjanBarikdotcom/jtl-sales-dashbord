import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../cache/cache.module';

@Injectable()
export class ActivityService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async recordActivity(tenantId: string): Promise<void> {
    await this.redis.set(`activity:${tenantId}`, Date.now().toString());
  }

  async getLastActivity(tenantId: string): Promise<Date | null> {
    const val = await this.redis.get(`activity:${tenantId}`);
    return val ? new Date(parseInt(val, 10)) : null;
  }

  async getAllTenantActivities(): Promise<Record<string, Date>> {
    const result: Record<string, Date> = {};

    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        'activity:*',
        'COUNT',
        500,
      );
      cursor = nextCursor;

      if (keys.length === 0) continue;

      const pipe = this.redis.pipeline();
      for (const key of keys) {
        pipe.get(key);
      }
      const values = await pipe.exec();

      keys.forEach((key, idx) => {
        const entry = values?.[idx];
        const val = Array.isArray(entry) ? entry[1] : null;
        const tenantId = key.replace('activity:', '');
        if (typeof val === 'string' && val) {
          result[tenantId] = new Date(parseInt(val, 10));
        }
      });
    } while (cursor !== '0');

    return result;
  }
}
