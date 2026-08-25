import { Marketplace } from '../core/marketplace.enum';
import { MarketplacePage } from '../core/marketplace.types';

export type FeedbackAvailability =
  | 'UNKNOWN' | 'DISCOVERING' | 'AVAILABLE' | 'NOT_AUTHORIZED'
  | 'NOT_SUPPORTED' | 'EXTERNAL_SOURCE_REQUIRED' | 'ERROR';

export type FeedbackCoverage =
  | 'FULL' | 'PARTIAL' | 'AGGREGATE_ONLY' | 'INSIGHTS_ONLY'
  | 'SELLER_FEEDBACK_ONLY' | 'ORDER_EVALUATION_ONLY'
  | 'OPERATIONAL_SIGNALS_ONLY' | 'NONE' | 'UNKNOWN';

export type FeedbackFreshness = 'FRESH' | 'DELAYED' | 'STALE' | 'NOT_SYNCED' | 'NOT_APPLICABLE';

export enum MarketplaceFeedbackSourceType {
  OFFICIAL_API = 'OFFICIAL_API',
  PRIVATE_MARKETPLACE_FEED = 'PRIVATE_MARKETPLACE_FEED',
  PORTAL_EXPORT = 'PORTAL_EXPORT',
  AUTHORIZED_SYNDICATION = 'AUTHORIZED_SYNDICATION',
  LICENSED_PROVIDER = 'LICENSED_PROVIDER',
  OPERATIONAL_PROXY = 'OPERATIONAL_PROXY',
}

export enum MarketplaceFeedbackResourceType {
  INDIVIDUAL_PRODUCT_REVIEWS = 'INDIVIDUAL_PRODUCT_REVIEWS',
  PRODUCT_RATING_AGGREGATE = 'PRODUCT_RATING_AGGREGATE',
  REVIEW_INSIGHTS = 'REVIEW_INSIGHTS',
  REVIEW_TRENDS = 'REVIEW_TRENDS',
  REVIEW_SNIPPETS = 'REVIEW_SNIPPETS',
  SELLER_FEEDBACK = 'SELLER_FEEDBACK',
  ORDER_EVALUATIONS = 'ORDER_EVALUATIONS',
  SUPPORT_CASES = 'SUPPORT_CASES',
  RETURN_REASONS = 'RETURN_REASONS',
}

export interface FeedbackCapabilityState {
  availability: FeedbackAvailability;
  coverage: FeedbackCoverage;
  sourceType?: MarketplaceFeedbackSourceType;
  lastVerifiedAt?: string | null;
  reasonCode?: string | null;
  message?: string | null;
}

export type MarketplaceFeedbackCapabilities = Record<MarketplaceFeedbackResourceType, FeedbackCapabilityState>;

export interface FeedbackSourceContext {
  tenantId: string;
  accountId: string;
  marketplace: Marketplace;
  sourceId?: string;
}

export interface FeedbackSyncContext extends FeedbackSourceContext {
  pageToken?: string;
  windowStart?: string;
  windowEnd?: string;
}

export interface FeedbackSourceConnectionResult {
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface RawProductReview { externalReviewId: string; [key: string]: unknown }
export interface RawRatingAggregate { marketplaceProductId: string; [key: string]: unknown }
export interface RawReviewInsight { topic: string; [key: string]: unknown }
export interface RawReviewTrend { topic: string; periodStart: string; [key: string]: unknown }
export interface RawSellerFeedback { externalFeedbackId: string; [key: string]: unknown }
export interface RawOrderEvaluation { externalEvaluationId: string; [key: string]: unknown }
export interface RawDeletedFeedback { externalFeedbackId: string; deletedAt: string; [key: string]: unknown }

export type FeedbackPage<T> = MarketplacePage<T>;
