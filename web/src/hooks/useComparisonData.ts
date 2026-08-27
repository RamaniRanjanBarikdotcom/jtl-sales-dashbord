"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { useAuthedQuery } from "@/lib/react-query-auth";
import { useFilterStore, useStore } from "@/lib/store";
import { downloadCsv } from "@/lib/export";

export type ComparisonTab =
  | "executive"
  | "sales"
  | "products"
  | "inventory"
  | "customers"
  | "saved";

export type ComparisonOptions = {
  compareMode: "none" | "previous_period" | "previous_year" | "custom";
  compareFrom?: string;
  compareTo?: string;
  granularity: "day" | "week" | "month" | "quarter" | "year";
  channels?: string;
  sourcePlatform?: string;
  category?: string;
  warehouse?: string;
  segment?: string;
  country?: string;
  region?: string;
  performance?: string;
  search?: string;
  productIds?: string;
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  limit?: number;
  deadStockDays?: number;
  minStock?: number;
  maxStock?: number;
  productState?: "all" | "active" | "inactive";
  sentiment?: "all" | "positive" | "neutral" | "negative";
  minRating?: number;
  maxRating?: number;
  reviewFrom?: string;
  reviewTo?: string;
};

function useParams(options: ComparisonOptions) {
  const range  = useFilterStore((s) => s.range);
  const from   = useFilterStore((s) => s.from);
  const to     = useFilterStore((s) => s.to);
  const status = useFilterStore((s) => s.status);
  const params = new URLSearchParams();
  if (range === "custom") {
    if (from) params.set("from", from);
    if (to)   params.set("to", to);
  } else {
    params.set("range", range);
    if (from) params.set("from", from);
    if (to)   params.set("to", to);
  }
  if (status && status !== "all") params.set("status", status);
  applyComparisonOptions(params, options, true);
  return params.toString();
}

function applyComparisonOptions(params: URLSearchParams, options: ComparisonOptions, includePaging: boolean) {
  params.set("compareMode", options.compareMode);
  params.set("granularity", options.granularity);
  if (options.compareFrom) params.set("compareFrom", options.compareFrom);
  if (options.compareTo) params.set("compareTo", options.compareTo);
  if (options.channels) params.set("channels", options.channels);
  if (options.sourcePlatform) params.set("sourcePlatform", options.sourcePlatform);
  if (options.category) params.set("category", options.category);
  if (options.warehouse) params.set("warehouse", options.warehouse);
  if (options.segment) params.set("segment", options.segment);
  if (options.country) params.set("country", options.country);
  if (options.region) params.set("region", options.region);
  if (options.performance && options.performance !== "all") params.set("performance", options.performance);
  if (options.search) params.set("search", options.search);
  if (options.productIds) params.set("productIds", options.productIds);
  if (options.sort) params.set("sort", options.sort);
  if (options.order) params.set("order", options.order);
  if (includePaging && options.page) params.set("page", String(options.page));
  if (includePaging && options.limit) params.set("limit", String(options.limit));
  if (options.deadStockDays) params.set("deadStockDays", String(options.deadStockDays));
  if (options.minStock != null) params.set("minStock", String(options.minStock));
  if (options.maxStock != null) params.set("maxStock", String(options.maxStock));
  if (options.productState && options.productState !== "all") params.set("productState", options.productState);
  if (options.sentiment && options.sentiment !== "all") params.set("sentiment", options.sentiment);
  if (options.minRating != null) params.set("minRating", String(options.minRating));
  if (options.maxRating != null) params.set("maxRating", String(options.maxRating));
  if (options.reviewFrom) params.set("reviewFrom", options.reviewFrom);
  if (options.reviewTo) params.set("reviewTo", options.reviewTo);
}

function useComparisonQuery<T>(key: string, options: ComparisonOptions, enabled = true) {
  const query = useParams(options);
  const currentCompany = useStore((state) => state.currentCompany?.tenantId);
  const tenantScope = useStore((state) => state.tenantScope);
  return useAuthedQuery({
    queryKey: ["comparison", key, query, currentCompany, tenantScope],
    queryFn: async (): Promise<T> => (await api.get(`/comparison/${key}?${query}`)).data.data,
    enabled,
    staleTime: 5 * 60_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });
}

export function useComparisonSummary(options: ComparisonOptions, enabled = true) {
  return useComparisonQuery<Record<string, any>>("summary", options, enabled);
}

export function useComparisonTrend(options: ComparisonOptions, enabled = true) {
  return useComparisonQuery<Record<string, any>>("sales/trend", options, enabled);
}

export function useComparisonChannels(options: ComparisonOptions, enabled = true) {
  return useComparisonQuery<Record<string, any>>("channels", options, enabled);
}

export function useComparisonChannelOptions(options: ComparisonOptions, enabled = true) {
  return useComparisonQuery<Record<string, any>>("channel-options", options, enabled);
}

export function useComparisonSourcePlatformOptions(options: ComparisonOptions, enabled = true) {
  return useComparisonQuery<Record<string, any>>("source-platform-options", options, enabled);
}

export function useComparisonChannelPair(options: ComparisonOptions, enabled = true) {
  return useComparisonQuery<Record<string, any>>("channels/compare-pair", options, enabled);
}

export function useComparisonProducts(options: ComparisonOptions, enabled = true) {
  return useComparisonQuery<Record<string, any>>("products", options, enabled);
}

export function useComparisonInventory(options: ComparisonOptions, enabled = true) {
  return useComparisonQuery<Record<string, any>>("inventory", options, enabled);
}

export function useComparisonCustomers(options: ComparisonOptions, enabled = true) {
  return useComparisonQuery<Record<string, any>>("customers", options, enabled);
}

export function useComparisonOrders(options: ComparisonOptions, enabled = true) {
  return useComparisonQuery<Record<string, any>>("orders", options, enabled);
}

export function useMarketplaceReviews(options: ComparisonOptions, enabled = true) {
  return useComparisonQuery<Record<string, any>>("reviews", options, enabled);
}

export function useComparisonSegments(options: ComparisonOptions, enabled = true) {
  return useComparisonQuery<any[]>("customers/segments", options, enabled);
}

export function useComparisonMatrix(options: ComparisonOptions, enabled = true) {
  return useComparisonQuery<Record<string, any>>("product-channel-matrix", options, enabled);
}

export function useChannelDetail(channelId: string | null, options: ComparisonOptions) {
  return useComparisonQuery<Record<string, any>>(
    `channels/${encodeURIComponent(channelId || "")}`,
    options,
    Boolean(channelId),
  );
}

export function useChannelProducts(channelId: string | null, options: ComparisonOptions) {
  return useComparisonQuery<Record<string, any>>(
    `channels/${encodeURIComponent(channelId || "")}/products`,
    options,
    Boolean(channelId),
  );
}

export function useProductDetail(productId: number | null, options: ComparisonOptions) {
  return useComparisonQuery<Record<string, any>>(`products/${productId || 0}`, options, Boolean(productId));
}

export function useSavedComparisonViews(enabled = true) {
  const currentCompany = useStore((state) => state.currentCompany?.tenantId);
  return useAuthedQuery({
    queryKey: ["comparison", "saved-views", currentCompany],
    queryFn: async (): Promise<any[]> => (await api.get("/comparison/saved-views")).data.data ?? [],
    enabled,
  });
}

export function useSaveComparisonView() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name: string; tab: string; config: Record<string, unknown> }) =>
      (await api.post("/comparison/saved-views", payload)).data.data,
    onSuccess: () => client.invalidateQueries({ queryKey: ["comparison", "saved-views"] }),
  });
}

export function useDeleteComparisonView() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/comparison/saved-views/${id}`)).data.data,
    onSuccess: () => client.invalidateQueries({ queryKey: ["comparison", "saved-views"] }),
  });
}

export function useCompareProducts() {
  return useMutation({
    mutationFn: async ({ productIds, channels, country, region }: { productIds: number[]; channels?: string; country?: string; region?: string }) => {
      const params = useFilterStore.getState().toParams();
      const range = params.get("range") || undefined;
      const from  = params.get("from")  || undefined;
      const to    = params.get("to")    || undefined;
      // DTO only accepts named ranges — when custom, omit range and send from/to only
      const safeRange = range && range !== "custom" ? range : undefined;
      return (await api.post("/comparison/products/compare", {
        productIds,
        channels,
        status: params.get("status") || undefined,
        country,
        region,
        range: safeRange,
        from,
        to,
      })).data.data as any[];
    },
  });
}

export async function exportComparisonCsv(dataset: string, options: ComparisonOptions) {
  const filters = useFilterStore.getState();
  const params = filters.toParams();
  params.set("dataset", dataset);
  applyComparisonOptions(params, options, false);
  return downloadCsv(
    `/comparison/export?${params}`,
    `comparison-${dataset}-${new Date().toISOString().slice(0, 10)}.csv`,
    "comparison.export",
  );
}
