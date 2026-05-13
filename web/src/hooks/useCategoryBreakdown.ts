"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

type BreakdownQuery = {
  from: string;
  to: string;
  category?: string;
  status?: string;
  invoice?: string;
  channel?: string;
  platform?: string;
  paymentMethod?: string;
};

export type CategoryBreakdownCategory = {
  name: string;
  revenue: number;
  orders: number;
  products: number;
  averageOrderValue: number;
  sharePercent: number;
};

export type CategoryBreakdownDimRow = {
  name: string;
  revenue: number;
  orders: number;
};

export type CategoryBreakdownProduct = {
  name: string;
  articleNumber: string;
  category: string;
  revenue: number;
  units: number;
  orders: number;
};

export type CategoryBreakdownResponse = {
  range: { from: string; to: string };
  selectedCategory: string;
  summary: {
    totalCategories: number;
    totalRevenue: number;
    totalOrders: number;
    avgOrderValue: number;
  };
  categories: CategoryBreakdownCategory[];
  breakdown: {
    channels: CategoryBreakdownDimRow[];
    platforms: CategoryBreakdownDimRow[];
    paymentMethods: CategoryBreakdownDimRow[];
    shippingMethods: CategoryBreakdownDimRow[];
    countries: CategoryBreakdownDimRow[];
  };
  products: {
    top: CategoryBreakdownProduct[];
    least: CategoryBreakdownProduct[];
  };
};

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toParams(query: BreakdownQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("from", query.from);
  params.set("to", query.to);
  if (query.category && query.category !== "all") params.set("category", query.category);
  if (query.status && query.status !== "all") params.set("status", query.status);
  if (query.invoice && query.invoice !== "all") params.set("invoice", query.invoice);
  if (query.channel && query.channel !== "all") params.set("channel", query.channel);
  if (query.platform && query.platform !== "all") params.set("platform", query.platform);
  if (query.paymentMethod && query.paymentMethod !== "all") params.set("paymentMethod", query.paymentMethod);
  return params;
}

function normalize(raw: unknown): CategoryBreakdownResponse {
  const data = (raw || {}) as Record<string, unknown>;
  const summary = (data.summary || {}) as Record<string, unknown>;
  const breakdown = (data.breakdown || {}) as Record<string, unknown>;
  const products = (data.products || {}) as Record<string, unknown>;

  const mapDim = (rows: unknown): CategoryBreakdownDimRow[] =>
    (Array.isArray(rows) ? rows : []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        name: String(r.name || "Unknown"),
        revenue: safeNum(r.revenue),
        orders: safeNum(r.orders),
      };
    });

  const mapProducts = (rows: unknown): CategoryBreakdownProduct[] =>
    (Array.isArray(rows) ? rows : []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        name: String(r.name || "Unknown"),
        articleNumber: String(r.articleNumber || "-"),
        category: String(r.category || "Uncategorized"),
        revenue: safeNum(r.revenue),
        units: safeNum(r.units),
        orders: safeNum(r.orders),
      };
    });

  return {
    range: {
      from: String((data.range as Record<string, unknown> | undefined)?.from || ""),
      to: String((data.range as Record<string, unknown> | undefined)?.to || ""),
    },
    selectedCategory: String(data.selectedCategory || "all"),
    summary: {
      totalCategories: safeNum(summary.totalCategories),
      totalRevenue: safeNum(summary.totalRevenue),
      totalOrders: safeNum(summary.totalOrders),
      avgOrderValue: safeNum(summary.avgOrderValue),
    },
    categories: (Array.isArray(data.categories) ? data.categories : []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        name: String(r.name || "Uncategorized"),
        revenue: safeNum(r.revenue),
        orders: safeNum(r.orders),
        products: safeNum(r.products),
        averageOrderValue: safeNum(r.averageOrderValue),
        sharePercent: safeNum(r.sharePercent),
      };
    }),
    breakdown: {
      channels: mapDim(breakdown.channels),
      platforms: mapDim(breakdown.platforms),
      paymentMethods: mapDim(breakdown.paymentMethods),
      shippingMethods: mapDim(breakdown.shippingMethods),
      countries: mapDim(breakdown.countries),
    },
    products: {
      top: mapProducts(products.top),
      least: mapProducts(products.least),
    },
  };
}

export function useCategoryBreakdown(query: BreakdownQuery, enabled = true) {
  const queryString = toParams(query).toString();
  return useQuery({
    queryKey: ["analytics", "category-breakdown", queryString],
    enabled,
    queryFn: async () => {
      const res = await api.get(`/analytics/category-breakdown?${queryString}`);
      return normalize(res.data?.data);
    },
    staleTime: 60_000,
  });
}

