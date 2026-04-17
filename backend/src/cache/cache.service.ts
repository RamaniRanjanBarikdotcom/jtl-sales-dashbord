import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './cache.constants';
import { CircuitBreaker } from '../common/utils/circuit-breaker';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly redisBreaker = new CircuitBreaker({
    failureThreshold: 5,
    resetTimeoutMs: 10_000,
  });
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const val = await this.redisBreaker.execute(() => this.redis.get(key));
    return val ? JSON.parse(val) : null;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redisBreaker.execute(() =>
      this.redis.setex(key, ttlSeconds, JSON.stringify(value)),
    );
  }

  async del(pattern: string): Promise<void> {
    const isPattern = /[*?\[]/.test(pattern);
    if (!isPattern) {
      await this.redisBreaker.execute(() => this.redis.del(pattern));
      return;
    }

    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redisBreaker.execute(() =>
        this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          500,
        ),
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        const pipe = this.redis.pipeline();
        for (const key of keys) {
          pipe.unlink(key);
        }
        await this.redisBreaker.execute(() => pipe.exec());
      }
    } while (cursor !== '0');
  }

  async getOrSet<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const task = (async () => {
      const fresh = await fn();
      await this.set(key, fresh, ttl);
      return fresh;
    })();

    this.inflight.set(key, task);
    try {
      return await task;
    } finally {
      this.inflight.delete(key);
    }
  }
}
