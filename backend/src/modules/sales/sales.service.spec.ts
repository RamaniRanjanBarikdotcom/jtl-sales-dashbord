import { Test, TestingModule } from '@nestjs/testing';
import { SalesService } from './sales.service';
import { DataSource } from 'typeorm';
import { CacheService } from '../../cache/cache.service';

const mockQuery = jest.fn();
const mockDataSource = { query: mockQuery } as unknown as DataSource;
const mockCache = {
  getOrSet: jest.fn().mockImplementation((_key: string, _ttl: number, fn: () => any) => fn()),
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
      const result = await service.getKpis('tenant-1', {}, 'admin', 'manager');
      expect(result).toMatchObject({
        total_revenue: '120000.00',
        total_orders: '450',
      });
    });
  });

  describe('getOrders', () => {
    it('passes pagination params correctly', async () => {
      mockQuery.mockResolvedValue([]);
      await service.getOrders('tenant-1', { page: '2', limit: '10' });
      const callArgs = mockQuery.mock.calls[0];
      // offset should be (2-1)*10 = 10
      expect(callArgs[1]).toContain(10); // offset
    });

    it('caps limit at 200', async () => {
      mockQuery.mockResolvedValue([]);
      await service.getOrders('tenant-1', { page: '1', limit: '999' });
      const callArgs = mockQuery.mock.calls[0];
      expect(callArgs[1]).toContain(200); // limit capped
    });
  });
});
