import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './cache.constants';

@Injectable()
export class CacheService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const val = await this.redis.get(key);
    return val ? JSON.parse(val) : null;
  }

  async set(key: string, value: any, ttlSeconds: number): Promise<void> {
    await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
  }

  async del(pattern: string): Promise<void> {
    const isPattern = /[*?\[]/.test(pattern);
    if (!isPattern) {
      await this.redis.del(pattern);
      return;
    }

    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        500,
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        const pipe = this.redis.pipeline();
        for (const key of keys) {
          pipe.unlink(key);
        }
        await pipe.exec();
      }
    } while (cursor !== '0');
  }

  async getOrSet<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const fresh = await fn();
    await this.set(key, fresh, ttl);
    return fresh;
  }
}
