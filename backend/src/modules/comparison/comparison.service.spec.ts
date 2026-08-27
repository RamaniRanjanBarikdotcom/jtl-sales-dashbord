import { DataSource } from 'typeorm';
import { PlatformConfigService } from '../../config/platform-config.service';
import { TenantScope } from '../../common/types/auth-request';
import { ComparisonService } from './comparison.service';
import { CacheService } from '../../cache/cache.service';
import {
  resetCanonicalSchemaCapabilities,
  setCanonicalSchemaCapabilities,
} from '../../common/utils/canonical-channel-payment';

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
  const cache = {
    getOrSet: jest.fn((_key: string, _ttl: number, loader: () => unknown) => loader()),
  } as unknown as CacheService;
  const service = new ComparisonService({ query } as unknown as DataSource, config, cache);

  beforeEach(() => {
    resetCanonicalSchemaCapabilities();
    query.mockReset();
    (config.enabled as jest.Mock).mockReturnValue(true);
  });

  it('uses raw source-platform evidence when canonical schema is available', async () => {
    setCanonicalSchemaCapabilities({
      schemaAvailable: true,
      orderColumnsAvailable: true,
      settingsTableAvailable: true,
      rulesTableAvailable: true,
      backfillTablesAvailable: true,
      resolverFunctionAvailable: true,
      marketplaceSchema20Available: true,
      marketplaceSchema21Available: true,
      checkedAt: new Date().toISOString(),
    });
    query
      .mockResolvedValueOnce([{ canonical_cache_namespace: 'tenant:1:0:1' }])
      .mockResolvedValueOnce([{ value: 'amazon.de', orders: 2 }]);

    await service.sourcePlatformOptions(scope);

    expect(query.mock.calls[1][0]).toContain('o.source_platform_raw');
    expect(query.mock.calls[1][0]).not.toContain('canonical_marketplace');
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

  it('paginates the product-channel matrix without a fixed row slice', async () => {
    query.mockResolvedValueOnce([{
      product_id: 1,
      product_name: 'Product A',
      channel_id: 'direct',
      channel_name: 'Direct',
      revenue: 10,
      units: 1,
      total_rows: 125,
    }]);

    const result = await service.productChannelMatrix(scope, {
      from: '2026-07-01',
      to: '2026-07-30',
      page: 2,
      limit: 100,
    });

    expect(result.total).toBe(125);
    expect(result.page).toBe(2);
    expect(query.mock.calls[0][1].slice(5, 8)).toEqual([100, 100, []]);
    expect(query.mock.calls[0][0]).not.toContain('LIMIT 500');
  });

  it('uses the Sales gross-revenue contract for channel totals', async () => {
    query.mockResolvedValueOnce([{ revenue: 100, orders: 2, products_sold: 1, total_count: 1 }]);

    await service.channels(scope, {
      from: '2026-07-01',
      to: '2026-07-30',
      compareMode: 'none',
    });

    expect(query.mock.calls[0][0]).toContain('SUM(o.gross_revenue)');
    expect(query.mock.calls[0][0]).not.toContain('SUM(COALESCE(o.net_revenue, o.gross_revenue))');
  });

  it('scopes product comparisons to selected canonical channels', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await service.compareProducts(scope, {
      productIds: [1, 2],
      channels: 'canonical-amazon',
      from: '2026-07-01',
      to: '2026-07-30',
    });

    expect(query.mock.calls[0][1][4]).toEqual(['canonical-amazon']);
    expect(query.mock.calls[1][1][4]).toEqual(['canonical-amazon']);
  });

  it('compares exactly two channels with tenant-scoped relationship counts', async () => {
    query.mockResolvedValueOnce([{
      id: 1,
      relationship: 'common',
      total_count: 4,
      common_count: 1,
      unique_a_count: 1,
      unique_b_count: 1,
      stocked_zero_sales_count: 1,
    }]);

    const result = await service.compareChannelPair(scope, {
      channels: 'amazon,direct',
      from: '2026-07-01',
      to: '2026-07-30',
    });

    expect(result.counts).toEqual({ common: 1, uniqueToA: 1, uniqueToB: 1, stockedZeroSales: 1 });
    expect(query.mock.calls[0][0]).toContain("WHEN revenue_a > 0 AND revenue_b > 0 THEN 'common'");
    expect(query.mock.calls[0][1][0]).toEqual(scope.tenantIds);
  });

  it('rejects invalid channel-pair selections', async () => {
    await expect(service.compareChannelPair(scope, { channels: 'amazon' })).rejects.toThrow('exactly two channels');
    expect(query).not.toHaveBeenCalled();
  });

  it('does not filter comparison products to id zero when no ids are selected', async () => {
    query.mockResolvedValueOnce([{ id: 9, name: 'Channel product', total_count: 1 }]);

    const result = await service.products(scope, {
      from: '2026-07-01',
      to: '2026-07-30',
    });

    expect(query.mock.calls[0][1][11]).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });

  it('filters marketplace products by active state and selected channel', async () => {
    query.mockResolvedValueOnce([]);

    await service.products(scope, {
      channels: 'canonical-amazon',
      productState: 'inactive',
      performance: 'with_sales',
      from: '2026-07-01',
      to: '2026-07-30',
    });

    expect(query.mock.calls[0][1][5]).toEqual(['canonical-amazon']);
    expect(query.mock.calls[0][1][15]).toBe('inactive');
    expect(query.mock.calls[0][0]).toContain("$16 = 'inactive' AND p.is_active = false");
  });

  it('restricts marketplace inventory demand to the selected channel', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ last_synced_at: null }]);

    await service.inventory(scope, { channels: 'canonical-amazon' });

    expect(query.mock.calls[0][1][9]).toEqual(['canonical-amazon']);
    expect(query.mock.calls[0][0]).toContain('cardinality($10::text[]) = 0 OR last_sale_date IS NOT NULL');
  });

  it('scopes source reviews by tenant, channel, dates, and sentiment', async () => {
    query.mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ reviews: 0, average_rating: null, positive: 0, neutral: 0, negative: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ topics: 0, products: 0, positive_topics: 0, negative_topics: 0 }])
      .mockResolvedValueOnce([{ products: 0, review_count: 0 }]);

    const result = await service.reviews(scope, {
      channels: 'canonical-amazon',
      sentiment: 'negative',
      reviewFrom: '2026-07-01',
      reviewTo: '2026-07-30',
    });

    expect(query.mock.calls[0][1].slice(0, 5)).toEqual([scope.tenantIds, '2026-07-01', '2026-07-30', ['canonical-amazon'], 'negative']);
    expect(result.total).toBe(0);
    expect(result.summary).toEqual({ reviews: null, average_rating: null, positive: null, neutral: null, negative: null });
    expect(result.source.state).toBe('NOT_CONFIGURED');
  });

  it('returns a verified zero only after an available source completed sync', async () => {
    query.mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ reviews: 0, average_rating: null, positive: 0, neutral: 0, negative: 0 }])
      .mockResolvedValueOnce([{ marketplace: 'AMAZON', account_status: 'ACTIVE', resource_type: 'INDIVIDUAL_PRODUCT_REVIEWS',
        availability: 'AVAILABLE', coverage: 'FULL', last_successful_sync_at: new Date('2026-08-01T00:00:00Z') }])
      .mockResolvedValueOnce([{ topics: 0, products: 0, positive_topics: 0, negative_topics: 0 }])
      .mockResolvedValueOnce([{ products: 0, review_count: 0 }]);

    const result = await service.reviews(scope, {});

    expect(result.summary.reviews).toBe(0);
    expect(result.summary.average_rating).toBeNull();
    expect(result.source.state).toBe('SYNCED');
  });
});
