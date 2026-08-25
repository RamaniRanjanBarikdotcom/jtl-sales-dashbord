import {
  MarketplaceCapabilities,
  MarketplaceAccountContext,
  MarketplaceConnectionTestResult,
  MarketplaceSyncContext,
  MarketplacePage,
  RawMarketplaceOrder,
  RawMarketplaceProduct,
  RawMarketplaceListing,
  RawMarketplaceInventory,
  RawMarketplaceReturn,
  RawMarketplaceRefund,
  RawMarketplaceFeedback,
  RawMarketplaceFinancialRecord,
  RawMarketplaceAdvertisingRecord,
  MarketplaceWebhookRequest,
  VerifiedMarketplaceEvent,
} from './marketplace.types';
import { Marketplace } from './marketplace.enum';

export interface MarketplaceConnector {
  readonly marketplace: Marketplace;

  getDeclaredCapabilities(): MarketplaceCapabilities;

  testConnection(account: MarketplaceAccountContext): Promise<MarketplaceConnectionTestResult>;

  discoverCapabilities(account: MarketplaceAccountContext): Promise<MarketplaceCapabilities>;

  refreshAuthentication?(account: MarketplaceAccountContext): Promise<void>;

  fetchOrders?(ctx: MarketplaceSyncContext): Promise<MarketplacePage<RawMarketplaceOrder>>;
  fetchProducts?(ctx: MarketplaceSyncContext): Promise<MarketplacePage<RawMarketplaceProduct>>;
  fetchListings?(ctx: MarketplaceSyncContext): Promise<MarketplacePage<RawMarketplaceListing>>;
  fetchInventory?(ctx: MarketplaceSyncContext): Promise<MarketplacePage<RawMarketplaceInventory>>;
  fetchReturns?(ctx: MarketplaceSyncContext): Promise<MarketplacePage<RawMarketplaceReturn>>;
  fetchRefunds?(ctx: MarketplaceSyncContext): Promise<MarketplacePage<RawMarketplaceRefund>>;
  fetchReviews?(ctx: MarketplaceSyncContext): Promise<MarketplacePage<RawMarketplaceFeedback>>;
  fetchSellerFeedback?(ctx: MarketplaceSyncContext): Promise<MarketplacePage<RawMarketplaceFeedback>>;
  fetchOrderEvaluations?(ctx: MarketplaceSyncContext): Promise<MarketplacePage<RawMarketplaceFeedback>>;
  fetchFinancials?(ctx: MarketplaceSyncContext): Promise<MarketplacePage<RawMarketplaceFinancialRecord>>;
  fetchAdvertising?(ctx: MarketplaceSyncContext): Promise<MarketplacePage<RawMarketplaceAdvertisingRecord>>;

  verifyWebhook?(req: MarketplaceWebhookRequest): Promise<VerifiedMarketplaceEvent>;
}
