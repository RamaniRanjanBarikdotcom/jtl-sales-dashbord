import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Marketplace } from '../core/marketplace.enum';
import { MarketplaceResource } from '../core/marketplace-resource.enum';
import { MarketplaceJobService } from './marketplace-job.service';

describe('MarketplaceJobService', () => {
  const job = {
    protocolVersion: 1,
    tenantId: '11111111-1111-4111-8111-111111111111',
    marketplaceAccountId: '22222222-2222-4222-8222-222222222222',
    marketplace: Marketplace.AMAZON,
    resource: MarketplaceResource.ORDERS,
    syncRunId: '33333333-3333-4333-8333-333333333333',
    cursorId: '44444444-4444-4444-8444-444444444444',
    trigger: 'SCHEDULE',
    requestedAt: '2026-08-27T00:00:00.000Z',
  } as const;

  it('rejects new work when the configured waiting-job limit is reached', async () => {
    const config = { get: jest.fn((_key: string, fallback: unknown) => fallback) } as unknown as ConfigService;
    const service = new MarketplaceJobService(config);
    const queue = {
      getWaitingCount: jest.fn().mockResolvedValue(10_000),
      add: jest.fn(),
    };
    jest.spyOn(service as never, 'queue' as never).mockReturnValue(queue as never);

    await expect(service.enqueue(job)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('enqueues work below the backpressure threshold', async () => {
    const config = { get: jest.fn((_key: string, fallback: unknown) => fallback) } as unknown as ConfigService;
    const service = new MarketplaceJobService(config);
    const queue = {
      getWaitingCount: jest.fn().mockResolvedValue(9_999),
      add: jest.fn().mockResolvedValue(undefined),
    };
    jest.spyOn(service as never, 'queue' as never).mockReturnValue(queue as never);

    await expect(service.enqueue(job)).resolves.toMatchObject({ queue: 'mp.amazon.realtime' });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
});
