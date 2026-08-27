import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './cache.constants';
import { CACHE_PREFIX } from './cache.constants';
import { CircuitBreaker } from '../common/utils/circuit-breaker';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly redisBreaker = new CircuitBreaker({
    failureThreshold: 5,
    resetTimeoutMs: 10_000,
  });
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private versionKey(key: string): string {
    if (!key.startsWith('jtl:') || key.startsWith(`${CACHE_PREFIX}:`)) {
      return key;
    }
    return `${CACHE_PREFIX}:${key.slice('jtl:'.length)}`;
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const versionedKey = this.versionKey(key);
    const val = await this.redisBreaker.execute(() => this.redis.get(versionedKey));
    if (!val) return null;
    try {
      return JSON.parse(val) as T;
    } catch {
      await this.del(key);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const versionedKey = this.versionKey(key);
    await this.redisBreaker.execute(() =>
      this.redis.setex(versionedKey, ttlSeconds, JSON.stringify(value)),
    );
  }

  async del(pattern: string): Promise<void> {
    const versionedPattern = this.versionKey(pattern);
    const isPattern = /[*?\[]/.test(versionedPattern);
    if (!isPattern) {
      await this.redisBreaker.execute(() => this.redis.del(versionedPattern));
      return;
    }

    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redisBreaker.execute(() =>
        this.redis.scan(
          cursor,
          'MATCH',
          versionedPattern,
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

  async stats(): Promise<{ keys: number; usedMemoryBytes: number; peakMemoryBytes: number; maxMemoryBytes: number }> {
    const [keys, memory] = await this.redisBreaker.execute(() => Promise.all([
      this.redis.dbsize(),
      this.redis.info('memory'),
    ]));
    const value = (name: string) => {
      const match = memory.match(new RegExp(`^${name}:(\\d+)`, 'm'));
      return match ? Number(match[1]) : 0;
    };
    return {
      keys: Number(keys),
      usedMemoryBytes: value('used_memory'),
      peakMemoryBytes: value('used_memory_peak'),
      maxMemoryBytes: value('maxmemory'),
    };
  }
}
