import { Marketplace } from '../core/marketplace.enum';
import {
  FeedbackPage, FeedbackSourceConnectionResult, FeedbackSourceContext, FeedbackSyncContext,
  MarketplaceFeedbackCapabilities, MarketplaceFeedbackSourceType, RawDeletedFeedback,
  RawOrderEvaluation, RawProductReview, RawRatingAggregate, RawReviewInsight, RawReviewTrend,
  RawSellerFeedback,
} from './marketplace-feedback.types';

export interface MarketplaceFeedbackSourceConnector {
  readonly sourceKey: string;
  readonly marketplace: Marketplace;
  readonly sourceType: MarketplaceFeedbackSourceType;
  testConnection(context: FeedbackSourceContext): Promise<FeedbackSourceConnectionResult>;
  discoverCapabilities(context: FeedbackSourceContext): Promise<Partial<MarketplaceFeedbackCapabilities>>;
  fetchProductReviews?(context: FeedbackSyncContext): Promise<FeedbackPage<RawProductReview>>;
  fetchRatingAggregates?(context: FeedbackSyncContext): Promise<FeedbackPage<RawRatingAggregate>>;
  fetchReviewInsights?(context: FeedbackSyncContext): Promise<FeedbackPage<RawReviewInsight>>;
  fetchReviewTrends?(context: FeedbackSyncContext): Promise<FeedbackPage<RawReviewTrend>>;
  fetchSellerFeedback?(context: FeedbackSyncContext): Promise<FeedbackPage<RawSellerFeedback>>;
  fetchOrderEvaluations?(context: FeedbackSyncContext): Promise<FeedbackPage<RawOrderEvaluation>>;
  fetchDeletedFeedback?(context: FeedbackSyncContext): Promise<FeedbackPage<RawDeletedFeedback>>;
}
