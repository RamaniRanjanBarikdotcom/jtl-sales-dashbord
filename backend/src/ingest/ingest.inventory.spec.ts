import { BadRequestException } from '@nestjs/common';
import { IngestService } from './ingest.service';

type TestableIngestService = {
  requireInventorySourceMetadata: boolean;
  inventoryZeroStockPolicy: 'verify' | 'allow';
  bulkIdChunkSize: number;
  schemaCapabilities?: { supportsCanonicalOrderIngest(): boolean };
  assertInventoryMetadataSafe(metadata?: Record<string, unknown>): void;
  assertInventorySwapSafe(
    executor: { query: jest.Mock },
    tenantId: string,
    syncRunId: string,
  ): Promise<void>;
  upsertRows(
    module: string,
    tenantId: string,
    rows: unknown[],
    batchIndex: number,
    isLastBatch: boolean,
    syncMode: string,
    syncRunId: string,
    executor: { query: jest.Mock },
  ): Promise<{ inserted: number; updated: number }>;
};

function makeService(): TestableIngestService {
  const service = Object.create(
    IngestService.prototype,
  ) as TestableIngestService;
  service.requireInventorySourceMetadata = true;
  service.inventoryZeroStockPolicy = 'verify';
  service.bulkIdChunkSize = 5000;
  service.schemaCapabilities = { supportsCanonicalOrderIngest: () => false };
  return service;
}

describe('inventory ingest safety', () => {
  it('uses a pure legacy order upsert when schema 19 is unavailable', async () => {
    const service = makeService();
    const executor = { query: jest.fn().mockResolvedValue([]) };

    await service.upsertRows(
      'orders',
      '11111111-1111-4111-8111-111111111111',
      [{ kBestellung: 7, dErstellt: '2026-08-01', fGesamtsumme: 10 }],
      0,
      false,
      'incremental',
      '22222222-2222-4222-8222-222222222222',
      executor,
    );

    const sql = executor.query.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO orders');
    expect(sql).not.toContain('resolve_channel_payment_exact');
    expect(sql).not.toContain('canonical_marketplace');
    expect(sql).not.toContain('source_platform_raw');
  });

  it('uses canonical shadow resolution only when schema 19 is available', async () => {
    const service = makeService();
    service.schemaCapabilities = { supportsCanonicalOrderIngest: () => true };
    const executor = { query: jest.fn().mockResolvedValue([]) };

    await service.upsertRows(
      'orders',
      '11111111-1111-4111-8111-111111111111',
      [{ kBestellung: 7, dErstellt: '2026-08-01', fGesamtsumme: 10 }],
      0,
      false,
      'incremental',
      '22222222-2222-4222-8222-222222222222',
      executor,
    );

    const sql = executor.query.mock.calls[0][0] as string;
    expect(sql).toContain('resolve_channel_payment_exact');
    expect(sql).toContain('canonical_marketplace');
    expect(sql).toContain('source_platform_raw');
  });

  it('rejects unsafe all-zero source metadata', () => {
    const service = makeService();
    expect(() =>
      service.assertInventoryMetadataSafe({
        safeToSync: false,
        stockStatus: 'unverified_zero_stock',
      }),
    ).toThrow(BadRequestException);
  });

  it('blocks an all-zero snapshot from replacing positive tenant stock', async () => {
    const service = makeService();
    const executor = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          { rows: '2', sum_total: '0', sum_available: '0' },
        ])
        .mockResolvedValueOnce([
          { sum_total: '11', sum_available: '8' },
        ]),
    };

    await expect(
      service.assertInventorySwapSafe(
        executor,
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ),
    ).rejects.toThrow('all-zero snapshot');
    expect(executor.query.mock.calls[1][1]).toEqual([
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('keeps product stock when product sync sends zero', async () => {
    const service = makeService();
    const executor = { query: jest.fn().mockResolvedValue([]) };

    await service.upsertRows(
      'products',
      '11111111-1111-4111-8111-111111111111',
      [{ jtl_product_id: 7, name: 'Product', stock_quantity: 0 }],
      0,
      true,
      'incremental',
      '22222222-2222-4222-8222-222222222222',
      executor,
    );

    const upsertSql = executor.query.mock.calls[0][0] as string;
    expect(upsertSql).toContain(
      'WHEN COALESCE(EXCLUDED.stock_quantity, 0) > 0 THEN EXCLUDED.stock_quantity',
    );
    expect(upsertSql).toContain('ELSE e.stock_quantity');
    expect(upsertSql).toContain(
      'ON CONFLICT (tenant_id, jtl_product_id)',
    );
  });

  it('reconciles product stock from total on the final inventory batch', async () => {
    const service = makeService();
    const executor = {
      query: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('COUNT(*)::bigint AS rows')) {
          return Promise.resolve([
            { rows: '1', sum_total: '5', sum_available: '3' },
          ]);
        }
        return Promise.resolve([]);
      }),
    };

    await service.upsertRows(
      'inventory',
      '11111111-1111-4111-8111-111111111111',
      [{
        jtl_product_id: 7,
        jtl_warehouse_id: 1,
        available: 3,
        reserved: 2,
        total: 5,
      }],
      0,
      true,
      'full',
      '22222222-2222-4222-8222-222222222222',
      executor,
    );

    const reconciliation = executor.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE products p'),
    );
    expect(reconciliation?.[0]).toContain('WHEN COALESCE(SUM(total), 0) > 0');
    expect(reconciliation?.[0]).toContain('WHERE p.tenant_id = $1');
  });
});
