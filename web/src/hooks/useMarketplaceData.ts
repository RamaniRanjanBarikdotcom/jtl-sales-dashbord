"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthedQuery } from "@/lib/react-query-auth";
import api from "@/lib/api";

export type MarketplaceName = "AMAZON" | "EBAY" | "KAUFLAND" | "OTTO" | "MEDIAMARKT";

export interface MarketplaceStatus {
  platformEnabled: boolean;
  accountApiEnabled: boolean;
  queueEnabled: boolean;
  schedulerEnabled: boolean;
  mockConnectorEnabled: boolean;
  canonicalReadsEnabled: boolean;
  writeActionsEnabled: boolean;
  reviewsEnabled: boolean;
  mode: "SHADOW";
}

export type FeedbackAvailability = "UNKNOWN" | "DISCOVERING" | "AVAILABLE" | "NOT_AUTHORIZED" |
  "NOT_SUPPORTED" | "EXTERNAL_SOURCE_REQUIRED" | "ERROR";
export type FeedbackCoverage = "FULL" | "PARTIAL" | "AGGREGATE_ONLY" | "INSIGHTS_ONLY" |
  "SELLER_FEEDBACK_ONLY" | "ORDER_EVALUATION_ONLY" | "OPERATIONAL_SIGNALS_ONLY" | "NONE" | "UNKNOWN";

export interface FeedbackMetricState {
  availability: FeedbackAvailability;
  coverage: FeedbackCoverage;
  reasonCode?: string | null;
  message?: string | null;
  [key: string]: unknown;
}

export interface MarketplaceFeedbackSummary {
  marketplace: MarketplaceName;
  individualReviews: FeedbackMetricState & { count: number | null; averageRating: number | null; positive: number | null; neutral: number | null; negative: number | null };
  reviewInsights: FeedbackMetricState & { productsAnalyzed: number | null; positiveTopicCount: number | null; negativeTopicCount: number | null };
  ratingAggregates: FeedbackMetricState & { products: number | null; reviewCount: number | null };
  freshness: { lastAttemptAt: string | null; lastSuccessfulSyncAt: string | null; freshnessState: string };
  sources: Array<Record<string, unknown>>;
}

export interface MarketplaceAccount {
  id: string;
  marketplace: MarketplaceName;
  displayName: string;
  externalMerchantId: string | null;
  regionCode: string | null;
  currencyCode: string | null;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "AUTH_EXPIRED" | "DISABLED";
  shadowMode: boolean;
  lastConnectionTestAt: string | null;
  lastConnectionStatus: string | null;
  lastSafeError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMarketplaceAccount {
  marketplace: MarketplaceName;
  displayName: string;
  externalMerchantId?: string;
  regionCode?: string;
  currencyCode?: string;
  credentials: { clientId: string; clientSecret: string };
}

const payload = <T,>(response: { data: { data?: T } | T }): T =>
  ((response.data as { data?: T }).data ?? response.data) as T;

export function useMarketplaceStatus(enabled: boolean) {
  return useAuthedQuery({
    queryKey: ["marketplaces", "status"],
    queryFn: async () => payload<MarketplaceStatus>(await api.get("/marketplaces/status")),
    enabled,
    staleTime: 30_000,
  });
}

export function useMarketplaceAccounts(enabled: boolean) {
  return useAuthedQuery({
    queryKey: ["marketplaces", "accounts"],
    queryFn: async () => payload<MarketplaceAccount[]>(await api.get("/marketplaces/accounts")),
    enabled,
    placeholderData: [],
  });
}

export function useMarketplaceFeedbackSummary(accountId: string | null, enabled: boolean) {
  return useAuthedQuery({
    queryKey: ["marketplaces", "feedback", "summary", accountId],
    queryFn: async () => payload<MarketplaceFeedbackSummary>(await api.get(`/marketplaces/accounts/${accountId}/feedback/summary`)),
    enabled: enabled && Boolean(accountId),
    staleTime: 60_000,
  });
}

function useMarketplaceFeedbackRows(resource: "review-insights" | "review-trends" | "rating-aggregates",
  accountId: string | null, enabled: boolean) {
  return useAuthedQuery({
    queryKey: ["marketplaces", "feedback", resource, accountId],
    queryFn: async () => payload<Record<string, any>>(await api.get(`/marketplaces/${resource}?accountId=${accountId}&page=1&limit=100`)),
    enabled: enabled && Boolean(accountId),
    staleTime: 60_000,
  });
}

export function useMarketplaceReviewInsights(accountId: string | null, enabled: boolean) {
  return useMarketplaceFeedbackRows("review-insights", accountId, enabled);
}

export function useMarketplaceReviewTrends(accountId: string | null, enabled: boolean) {
  return useMarketplaceFeedbackRows("review-trends", accountId, enabled);
}

export function useMarketplaceRatingAggregates(accountId: string | null, enabled: boolean) {
  return useMarketplaceFeedbackRows("rating-aggregates", accountId, enabled);
}

export function useCreateMarketplaceAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateMarketplaceAccount) =>
      payload<MarketplaceAccount>(await api.post("/marketplaces/accounts", input)),
    onSuccess: () => client.invalidateQueries({ queryKey: ["marketplaces", "accounts"] }),
  });
}

export function useTestMarketplaceConnection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) =>
      payload<{ success: boolean; errorMessage?: string }>(await api.post(`/marketplaces/accounts/${accountId}/test`)),
    onSuccess: () => client.invalidateQueries({ queryKey: ["marketplaces", "accounts"] }),
  });
}

export function usePauseMarketplaceAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, paused }: { accountId: string; paused: boolean }) =>
      payload<MarketplaceAccount>(await api.patch(`/marketplaces/accounts/${accountId}`, { paused })),
    onSuccess: () => client.invalidateQueries({ queryKey: ["marketplaces", "accounts"] }),
  });
}
