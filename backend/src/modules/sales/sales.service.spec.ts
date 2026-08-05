import { Test, TestingModule } from '@nestjs/testing';
import { SalesService } from './sales.service';
import { DataSource } from 'typeorm';
import { CacheService } from '../../cache/cache.service';
import { TenantScope } from '../../common/types/auth-request';

const SCOPE: TenantScope = {
  scope: 'single',
  tenantId: 'tenant-1',
  tenantIds: ['tenant-1'],
  cacheKey: 'single:tenant-1',
};

const mockQuery = jest.fn();
const mockDataSource = { query: mockQuery } as unknown as DataSource;
const mockCache = {
  getOrSet: jest.fn().mockImplementation((_key: string, _ttl: number, fn: () => unknown) => fn()),
} as unknown as CacheService;

describe('SalesService', () => {
  let service: SalesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();
    service = module.get<SalesService>(SalesService);
    jest.clearAllMocks();
  });

  describe('getKpis', () => {
    it('returns transformed kpi row', async () => {
      mockQuery.mockResolvedValue([{
        total_revenue: '120000.00',
        total_orders: '450',
        avg_order_value: '266.67',
        avg_margin: '38.5',
        return_rate: '3.2',
      }]);
      const result = await service.getKpis(SCOPE, {}, 'admin', 'manager');
      expect(result).toMatchObject({
        total_revenue: '120000.00',
        total_orders: '450',
      });
    });
  });

  describe('getOrders', () => {
    it('passes pagination params correctly', async () => {
      mockQuery.mockResolvedValue([]);
      await service.getOrders(SCOPE, { page: '2', limit: '10' });
      const callArgs = mockQuery.mock.calls[0];
      // offset should be (2-1)*10 = 10
      expect(callArgs[1]).toContain(10); // offset
    });

    it('caps limit at 200', async () => {
      mockQuery.mockResolvedValue([]);
      await service.getOrders(SCOPE, { page: '1', limit: '999' });
      const callArgs = mockQuery.mock.calls[0];
      expect(callArgs[1]).toContain(200); // limit capped
    });

    it('applies contextual shipping, weekday, hour, and safe sort filters', async () => {
      mockQuery.mockResolvedValue([]);
      await service.getOrders(SCOPE, {
        shippingMethod: 'DHL',
        weekday: 'Mon',
        hour: 9,
        sort: 'gross_revenue',
        order: 'ASC',
      });

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('EXTRACT(DOW FROM o.jtl_modified_at)');
      expect(sql).toContain('EXTRACT(HOUR FROM o.jtl_modified_at)');
      expect(sql).toContain('ORDER BY fo.gross_revenue ASC');
      expect(params).toEqual(expect.arrayContaining(['DHL', 1, 9]));
    });
  });

  describe('exportOrders', () => {
    it('uses one bounded export query instead of rerunning paginated aggregates', async () => {
      mockQuery.mockResolvedValue([{ order_number: '1001', total_count: 75000 }]);

      const csv = await service.exportOrders(SCOPE, { range: 'ALL' }, 'admin', 'manager');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain('COUNT(*) OVER()');
      expect(mockQuery.mock.calls[0][0]).toContain('LIMIT $15::int');
      expect(csv).toContain('1001');
      expect(csv).toContain('"# complete","false"');
    });

    it('uses the same canonical channel and payment projection as the screen', async () => {
      mockQuery.mockResolvedValue([]);
      await service.getOrders(SCOPE, {});
      const screenSql = mockQuery.mock.calls[0][0] as string;

      mockQuery.mockClear();
      mockQuery.mockResolvedValue([]);
      await service.exportOrders(SCOPE, {}, 'admin', 'manager');
      const exportSql = mockQuery.mock.calls[0][0] as string;

      for (const marker of [
        "WHEN fo.channel_resolution_status = 'ambiguous' THEN 'Ambiguous'",
        "ELSE 'Unresolved'",
      ]) {
        expect(screenSql).toContain(marker);
      }
      expect(exportSql).toContain("WHEN o.channel_resolution_status = 'ambiguous' THEN 'Ambiguous'");
      expect(exportSql).toContain("WHEN o.payment_resolution_status = 'ambiguous' THEN 'Ambiguous'");
      expect(exportSql).toContain("ELSE 'Unresolved'");
    });
  });
});
