"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { useAuthedQuery } from "@/lib/react-query-auth";
import { useFilterStore, useStore } from "@/lib/store";

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
  category?: string;
  country?: string;
  region?: string;
  performance?: string;
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  limit?: number;
  deadStockDays?: number;
};

function useParams(options: ComparisonOptions) {
  const filters = useFilterStore();
  const params = filters.toParams();
  params.set("compareMode", options.compareMode);
  params.set("granularity", options.granularity);
  if (options.compareFrom) params.set("compareFrom", options.compareFrom);
  if (options.compareTo) params.set("compareTo", options.compareTo);
  if (options.channels) params.set("channels", options.channels);
  if (options.category) params.set("category", options.category);
  if (options.country) params.set("country", options.country);
  if (options.region) params.set("region", options.region);
  if (options.performance && options.performance !== "all") params.set("performance", options.performance);
  if (options.search) params.set("search", options.search);
  if (options.sort) params.set("sort", options.sort);
  if (options.order) params.set("order", options.order);
  if (options.page) params.set("page", String(options.page));
  if (options.limit) params.set("limit", String(options.limit));
  if (options.deadStockDays) params.set("deadStockDays", String(options.deadStockDays));
  return params.toString();
}

function useComparisonQuery<T>(key: string, options: ComparisonOptions, enabled = true) {
  const query = useParams(options);
  const currentCompany = useStore((state) => state.currentCompany?.tenantId);
  const tenantScope = useStore((state) => state.tenantScope);
  return useAuthedQuery({
    queryKey: ["comparison", key, query, currentCompany, tenantScope],
    queryFn: async (): Promise<T> => (await api.get(`/comparison/${key}?${query}`)).data.data,
    enabled,
    staleTime: 30_000,
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

export function useComparisonProducts(options: ComparisonOptions, enabled = true) {
  return useComparisonQuery<Record<string, any>>("products", options, enabled);
}

export function useComparisonInventory(options: ComparisonOptions, enabled = true) {
  return useComparisonQuery<Record<string, any>>("inventory", options, enabled);
}

export function useComparisonCustomers(options: ComparisonOptions, enabled = true) {
  return useComparisonQuery<Record<string, any>>("customers", options, enabled);
}

export function useComparisonSegments(options: ComparisonOptions, enabled = true) {
  return useComparisonQuery<any[]>("customers/segments", options, enabled);
}

export function useComparisonMatrix(options: ComparisonOptions, enabled = true) {
  return useComparisonQuery<any[]>("product-channel-matrix", options, enabled);
}

export function useChannelDetail(channelId: string | null, options: ComparisonOptions) {
  return useComparisonQuery<Record<string, any>>(
    `channels/${encodeURIComponent(channelId || "")}`,
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
    mutationFn: async (productIds: number[]) =>
      (await api.post("/comparison/products/compare", { productIds })).data.data as any[],
  });
}

export async function exportComparisonCsv(dataset: string, options: ComparisonOptions) {
  const filters = useFilterStore.getState();
  const params = filters.toParams();
  params.set("dataset", dataset);
  params.set("compareMode", options.compareMode);
  params.set("granularity", options.granularity);
  if (options.performance && options.performance !== "all") params.set("performance", options.performance);
  if (options.search) params.set("search", options.search);
  if (options.deadStockDays) params.set("deadStockDays", String(options.deadStockDays));
  const response = await api.get(`/comparison/export?${params}`, { responseType: "blob" });
  const url = URL.createObjectURL(response.data);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `comparison-${dataset}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
