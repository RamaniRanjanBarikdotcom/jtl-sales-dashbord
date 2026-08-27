import { CacheService } from './cache.service';

describe('CacheService versioned tenant keys', () => {
  it('writes legacy callers into the v3 namespace', async () => {
    const redis = {
      setex: jest.fn().mockResolvedValue('OK'),
    };
    const service = new CacheService(redis as never);

    await service.set('jtl:tenant-a:inventory:kpis', { stock: 5 }, 60);

    expect(redis.setex).toHaveBeenCalledWith(
      'jtl:v3:tenant-a:inventory:kpis',
      60,
      JSON.stringify({ stock: 5 }),
    );
  });

  it('scans only the requested versioned tenant namespace', async () => {
    const pipeline = { unlink: jest.fn(), exec: jest.fn().mockResolvedValue([]) };
    const redis = {
      scan: jest.fn().mockResolvedValue(['0', []]),
      pipeline: jest.fn(() => pipeline),
    };
    const service = new CacheService(redis as never);

    await service.del('jtl:tenant-a:inventory:*');

    expect(redis.scan).toHaveBeenCalledWith(
      '0',
      'MATCH',
      'jtl:v3:tenant-a:inventory:*',
      'COUNT',
      500,
    );
  });

  it('reports cache cardinality and memory without scanning keys', async () => {
    const redis = {
      dbsize: jest.fn().mockResolvedValue(42),
      info: jest.fn().mockResolvedValue('used_memory:1024\r\nused_memory_peak:2048\r\nmaxmemory:4096\r\n'),
    };
    const service = new CacheService(redis as never);

    await expect(service.stats()).resolves.toEqual({
      keys: 42,
      usedMemoryBytes: 1024,
      peakMemoryBytes: 2048,
      maxMemoryBytes: 4096,
    });
    expect(redis.info).toHaveBeenCalledWith('memory');
  });
});
