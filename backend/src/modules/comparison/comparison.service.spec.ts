import { DataSource } from 'typeorm';
import { PlatformConfigService } from '../../config/platform-config.service';
import { TenantScope } from '../../common/types/auth-request';
import { ComparisonService } from './comparison.service';

describe('ComparisonService', () => {
  const scope: TenantScope = {
    scope: 'single',
    tenantId: '11111111-1111-4111-8111-111111111111',
    tenantIds: ['11111111-1111-4111-8111-111111111111'],
    cacheKey: 'single:11111111-1111-4111-8111-111111111111',
  };

  const query = jest.fn();
  const config = {
    enabled: jest.fn().mockReturnValue(true),
  } as unknown as PlatformConfigService;
  const service = new ComparisonService({ query } as unknown as DataSource, config);

  beforeEach(() => {
    query.mockReset();
    (config.enabled as jest.Mock).mockReturnValue(true);
  });

  it('uses only the resolved tenant scope for summary queries', async () => {
    query
      .mockResolvedValueOnce([{ revenue: 100, orders: 2, cost_of_goods: 40, units: 3 }])
      .mockResolvedValueOnce([{ revenue: 50, orders: 1, cost_of_goods: 20, units: 1 }])
      .mockResolvedValueOnce([{ last_synced_at: '2026-07-30T00:00:00Z' }]);

    const result = await service.summary(scope, {
      from: '2026-07-01',
      to: '2026-07-30',
      compareMode: 'previous_period',
    });

    expect(query).toHaveBeenCalledTimes(3);
    for (const call of query.mock.calls) {
      expect(call[1][0]).toEqual(scope.tenantIds);
    }
    expect(result.current.revenue).toBe(100);
    expect(result.change?.revenue).toBe(100);
  });

  it('keeps comparison features disabled behind flags', async () => {
    (config.enabled as jest.Mock).mockReturnValue(false);

    await expect(service.summary(scope, {})).rejects.toThrow('Comparison feature is disabled');
    expect(query).not.toHaveBeenCalled();
  });

  it('clamps server pagination to 100 rows', async () => {
    query.mockResolvedValueOnce([]);

    const result = await service.channels(scope, {
      from: '2026-07-01',
      to: '2026-07-30',
      compareMode: 'none',
      page: 2,
      limit: 500,
    });

    expect(result.limit).toBe(100);
    expect(query.mock.calls[0][1][5]).toBe(100);
    expect(query.mock.calls[0][1][6]).toBe(100);
  });

  it('rejects custom comparisons without both dates', async () => {
    await expect(service.summary(scope, {
      compareMode: 'custom',
      compareFrom: '2026-06-01',
    })).rejects.toThrow('Custom comparison requires compareFrom and compareTo');
  });
});
