import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService } from '../../cache/cache.service';
import { TenantScope } from '../../common/types/auth-request';
import { ProductsService } from './products.service';

describe('ProductsService filtered list', () => {
  const scope: TenantScope = {
    scope: 'single',
    tenantId: '11111111-1111-4111-8111-111111111111',
    tenantIds: ['11111111-1111-4111-8111-111111111111'],
    cacheKey: 'single:11111111-1111-4111-8111-111111111111',
  };
  const query = jest.fn();
  const cache = {
    getOrSet: jest.fn((_key: string, _ttl: number, loader: () => unknown) => loader()),
  } as unknown as CacheService;
  const service = new ProductsService({ query } as unknown as DataSource, cache);

  beforeEach(() => query.mockReset());

  it('uses one server-ranked query for screen count and export-compatible filters', async () => {
    query.mockResolvedValueOnce([{ id: 1, name: 'TN2420', total_count: 1 }]);

    const result = await service.getList(scope, {
      sku: 'TN2420',
      model: '2420',
      catalogStatus: 'active',
      salesStatus: 'stock_no_sales',
      minRevenue: 10,
      minStock: 1,
      sort: 'revenue_change',
      order: 'ASC',
    }, 'admin', 'manager');

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('COUNT(*) OVER()');
    expect(sql).toContain("$19 = 'stock_no_sales'");
    expect(sql).toContain("$10 = 'revenue_change'");
    expect(params).toEqual(expect.arrayContaining(['TN2420', '2420', 'active', 'stock_no_sales', 10, 1]));
    expect(result.total).toBe(1);
  });

  it('rejects unsupported manufacturer filtering instead of fabricating brand data', async () => {
    await expect(service.getList(scope, { brand: 'Example' }, 'admin', 'manager'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('does not turn an omitted product selection into product id zero', async () => {
    query.mockResolvedValueOnce([{ id: 7, name: 'Visible product', total_count: 1 }]);

    const result = await service.getList(scope, {}, 'admin', 'manager');

    expect(query.mock.calls[0][1][21]).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });
});
