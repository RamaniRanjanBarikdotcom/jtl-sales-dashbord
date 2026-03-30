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
    return val ? new Date(parseInt(val)) : null;
  }

  async getAllTenantActivities(): Promise<Record<string, Date>> {
    const keys = await this.redis.keys('activity:*');
    const result: Record<string, Date> = {};
    for (const key of keys) {
      const val = await this.redis.get(key);
      const tenantId = key.replace('activity:', '');
      if (val) result[tenantId] = new Date(parseInt(val));
    }
    return result;
  }
}
