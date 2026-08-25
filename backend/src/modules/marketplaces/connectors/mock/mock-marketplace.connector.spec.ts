import { MarketplaceResource } from '../../core/marketplace-resource.enum';
import { MockMarketplaceConnector } from './mock-marketplace.connector';

describe('MockMarketplaceConnector contract', () => {
  const connector = new MockMarketplaceConnector();
  const context = {
    account: { tenantId: 'tenant-a', accountId: 'account-a', marketplace: connector.marketplace,
      externalMerchantId: 'merchant-a', regionCode: 'DE', currencyCode: 'EUR' },
    resource: MarketplaceResource.ORDERS,
    syncRunId: 'run-a', cursorId: 'cursor-a',
  };

  it('paginates deterministically without duplicate IDs', async () => {
    const first = await connector.fetchOrders!(context);
    const second = await connector.fetchOrders!({ ...context, pageToken: first.nextPageToken });
    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.items, ...second.items].map((item) => item.externalOrderId)).size).toBe(2);
  });

  it('declares unavailable capability states instead of zero-like values', () => {
    expect(connector.getDeclaredCapabilities().productReviews).toBe('NOT_SUPPORTED');
    expect(connector.getDeclaredCapabilities().customers).toBe('NOT_AUTHORIZED');
  });
});
