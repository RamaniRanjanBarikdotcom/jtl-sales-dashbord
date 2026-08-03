import { DataSource } from 'typeorm';
import { CacheService } from '../../cache/cache.service';
import { TenantScope } from '../../common/types/auth-request';
import { MailService } from '../mail/mail.service';
import { InventoryService } from './inventory.service';

describe('InventoryService', () => {
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
  const service = new InventoryService(
    { query } as unknown as DataSource,
    cache,
    {} as MailService,
  );

  beforeEach(() => query.mockReset());

  it('uses warehouse, category, stock range, and whitelisted sorting in list queries', async () => {
    query.mockResolvedValueOnce([]);

    await service.getList(scope, {
      category: 'Rings',
      warehouse: 'Berlin',
      minStock: 2,
      maxStock: 50,
      sort: 'stock_value',
      order: 'DESC',
    });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('iw.warehouse_name ILIKE');
    expect(sql).toContain('c.name = $6');
    expect(sql).toContain('ORDER BY stock_value DESC');
    expect(sql).toContain('classification = $13');
    expect(sql).toContain('COUNT(*) OVER()');
    expect(params).toEqual(expect.arrayContaining(['Rings', 'Berlin', 2, 50]));
  });

  it('returns null DSI instead of fabricating 999 days when demand is missing', async () => {
    query.mockResolvedValue([]);
    await service.getAlerts(scope);
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('ELSE NULL');
    expect(sql).not.toContain('ELSE 999');
  });

  it('applies exact custom dates to movement demand queries', async () => {
    query.mockResolvedValue([]);
    await service.getMovements(scope, { from: '2026-07-01', to: '2026-07-07' });
    const dsiParams = query.mock.calls[0][1];
    const dailyParams = query.mock.calls[1][1];
    expect(dsiParams.slice(0, 4)).toEqual([scope.tenantIds, '2026-07-01', '2026-07-07', 7]);
    expect(dailyParams).toEqual([scope.tenantIds, '2026-07-01', '2026-07-07', '']);
  });

  it('keeps alert and DSI filters server-side and export-compatible', async () => {
    query.mockResolvedValue([]);

    await service.getAlertsPaged(scope, {
      category: 'Rings',
      warehouse: 'Berlin',
      channel: 'Amazon',
    });
    await service.getMovements(scope, {
      category: 'Rings',
      warehouse: 'Berlin',
      channel: 'Amazon',
      performanceClass: 'low_cover',
      minDaysOfStock: 1,
      maxDaysOfStock: 7,
    });

    expect(query.mock.calls[0][0]).toContain('c.name = $7');
    expect(query.mock.calls[0][0]).toContain('iw.warehouse_name ILIKE');
    expect(query.mock.calls[0][0]).toContain('LOWER(COALESCE(co.channel');
    expect(query.mock.calls[1][0]).toContain("classification = $13");
    expect(query.mock.calls[1][1]).toEqual(expect.arrayContaining(['Rings', 'Berlin', 'Amazon', 'low_cover', 1, 7]));
  });
});
