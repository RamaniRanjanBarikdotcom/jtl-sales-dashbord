import { MarketplaceConnector } from '../../core/marketplace-connector.interface';
import { Marketplace } from '../../core/marketplace.enum';
import {
  MarketplaceAccountContext, MarketplaceCapabilities, MarketplaceConnectionTestResult,
  MarketplacePage, MarketplaceSyncContext, RawMarketplaceOrder,
} from '../../core/marketplace.types';

export class MockMarketplaceConnector implements MarketplaceConnector {
  readonly marketplace = Marketplace.AMAZON;
  private readonly pages = new Map<string, RawMarketplaceOrder[]>([
    ['first', [{ externalOrderId: 'fixture-order-1', orderedAt: '2026-01-01T00:00:00Z' }]],
    ['second', [{ externalOrderId: 'fixture-order-2', orderedAt: '2026-01-02T00:00:00Z' }]],
  ]);

  getDeclaredCapabilities(): MarketplaceCapabilities {
    return {
      orders: 'FULL', orderItems: 'FULL', products: 'PARTIAL', listings: 'PARTIAL', inventory: 'PARTIAL',
      pricing: 'NOT_SUPPORTED', customers: 'NOT_AUTHORIZED', shipping: 'PARTIAL', returns: 'PARTIAL',
      refunds: 'PARTIAL', cancellations: 'PARTIAL', invoices: 'NOT_SUPPORTED', financials: 'NOT_SUPPORTED',
      advertising: 'NOT_SUPPORTED', productReviews: 'NOT_SUPPORTED', sellerFeedback: 'NOT_SUPPORTED',
      orderEvaluations: 'NOT_SUPPORTED', supportCases: 'NOT_SUPPORTED', webhooks: 'PARTIAL',
    };
  }

  async testConnection(account: MarketplaceAccountContext): Promise<MarketplaceConnectionTestResult> {
    return { success: true, merchantId: account.externalMerchantId ?? 'mock-merchant', capabilities: this.getDeclaredCapabilities() };
  }

  async discoverCapabilities(): Promise<MarketplaceCapabilities> {
    return this.getDeclaredCapabilities();
  }

  async fetchOrders(context: MarketplaceSyncContext): Promise<MarketplacePage<RawMarketplaceOrder>> {
    const page = context.pageToken === 'second' ? 'second' : 'first';
    return { items: this.pages.get(page) ?? [], nextPageToken: page === 'first' ? 'second' : undefined, hasMore: page === 'first' };
  }
}
