import { Marketplace } from './marketplace.enum';
import { MarketplaceResource } from './marketplace-resource.enum';

export type CapabilityLevel =
  | 'FULL'
  | 'PARTIAL'
  | 'AGGREGATE_ONLY'
  | 'EXTERNAL_SOURCE'
  | 'NOT_AUTHORIZED'
  | 'NOT_SUPPORTED';

export type MarketplaceSyncTrigger =
  | 'SCHEDULE'
  | 'WEBHOOK'
  | 'MANUAL'
  | 'BACKFILL'
  | 'RECONCILIATION';

export type MarketplaceFailureClass =
  | 'THROTTLED'
  | 'TRANSIENT_NETWORK'
  | 'TRANSIENT_PROVIDER'
  | 'AUTH_EXPIRED'
  | 'PERMISSION_REQUIRED'
  | 'INVALID_REQUEST'
  | 'INVALID_RESPONSE'
  | 'DATA_CONFLICT'
  | 'DATABASE_TRANSIENT'
  | 'DATABASE_PERMANENT'
  | 'CANCELLED';

export type MarketplaceFeedbackType =
  | 'PRODUCT_REVIEW'
  | 'REVIEW_INSIGHT'
  | 'REVIEW_TREND'
  | 'SELLER_FEEDBACK'
  | 'ORDER_EVALUATION'
  | 'RATING_AGGREGATE'
  | 'SUPPORT_TICKET'
  | 'RETURN_REASON'
  | 'COMPLAINT_REASON'
  | 'SYNDICATED_PRODUCT_REVIEW';

export interface MarketplaceCapabilities {
  orders:           CapabilityLevel;
  orderItems:       CapabilityLevel;
  products:         CapabilityLevel;
  listings:         CapabilityLevel;
  inventory:        CapabilityLevel;
  pricing:          CapabilityLevel;
  customers:        CapabilityLevel;
  shipping:         CapabilityLevel;
  returns:          CapabilityLevel;
  refunds:          CapabilityLevel;
  cancellations:    CapabilityLevel;
  invoices:         CapabilityLevel;
  financials:       CapabilityLevel;
  advertising:      CapabilityLevel;
  productReviews:   CapabilityLevel;
  sellerFeedback:   CapabilityLevel;
  orderEvaluations: CapabilityLevel;
  supportCases:     CapabilityLevel;
  webhooks:         CapabilityLevel;
}

export interface MarketplaceAccountContext {
  tenantId:           string;
  accountId:          string;
  marketplace:        Marketplace;
  externalMerchantId: string | null;
  regionCode:         string | null;
  currencyCode:       string | null;
}

export interface MarketplaceSyncContext {
  account:     MarketplaceAccountContext;
  resource:    MarketplaceResource;
  syncRunId:   string;
  cursorId:    string;
  windowStart?: string;
  windowEnd?:   string;
  pageToken?:   string;
}

export interface MarketplacePage<T> {
  items:          T[];
  nextPageToken?: string;
  hasMore:        boolean;
  totalCount?:    number;
}

export interface MarketplaceConnectionTestResult {
  success:            boolean;
  merchantId?:        string;
  marketplaceName?:   string;
  capabilities?:      Partial<MarketplaceCapabilities>;
  errorCode?:         string;
  errorMessage?:      string;
}

export interface QuotaDecision {
  allowed:       boolean;
  retryAfterMs:  number;
  remaining?:    number;
  resetAt?:      Date;
}

/** V1 job payload — keep < 10 KB, identifiers only */
export interface MarketplaceSyncJobV1 {
  protocolVersion:      1;
  tenantId:             string;
  marketplaceAccountId: string;
  marketplace:          Marketplace;
  resource:             MarketplaceResource;
  syncRunId:            string;
  cursorId:             string;
  trigger:              MarketplaceSyncTrigger;
  requestedAt:          string;
  windowStart?:         string;
  windowEnd?:           string;
  priorityClass?:       string;
}

// Raw marketplace source shapes (minimal — connectors extend these)
export interface RawMarketplaceOrder    { externalOrderId: string; [k: string]: unknown }
export interface RawMarketplaceProduct  { externalProductId: string; [k: string]: unknown }
export interface RawMarketplaceListing  { externalListingId: string; [k: string]: unknown }
export interface RawMarketplaceInventory { externalSkuId: string; [k: string]: unknown }
export interface RawMarketplaceReturn   { externalReturnId: string; [k: string]: unknown }
export interface RawMarketplaceRefund   { externalRefundId: string; [k: string]: unknown }
export interface RawMarketplaceFeedback { externalFeedbackId: string; [k: string]: unknown }
export interface RawMarketplaceFinancialRecord { externalTransactionId: string; [k: string]: unknown }
export interface RawMarketplaceAdvertisingRecord { externalAdId: string; [k: string]: unknown }

export interface MarketplaceWebhookRequest {
  marketplace: Marketplace;
  rawBody:     Buffer;
  headers:     Record<string, string>;
  accountId:   string;
}

export interface VerifiedMarketplaceEvent {
  eventType:   string;
  externalId:  string;
  occurredAt:  string;
  payload:     Record<string, unknown>;
}
