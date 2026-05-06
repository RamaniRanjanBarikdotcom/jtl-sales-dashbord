"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import type { RevenueTrendGranularity, RevenueTrendPoint, RevenueTrendResponse, RevenueTrendSummary } from "@/hooks/useRevenueTrend";

export interface CategoryRevenueTrendQuery {
  from: string;
  to: string;
  granularity: RevenueTrendGranularity;
  compare?: "prior_year" | "none";
  category?: string;
  status?: string;
  invoice?: string;
  channel?: string;
  platform?: string;
  paymentMethod?: string;
}

function toSearchParams(query: CategoryRevenueTrendQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("from", query.from);
  params.set("to", query.to);
  params.set("granularity", query.granularity);
  params.set("compare", query.compare || "prior_year");
  if (query.category && query.category !== "all") params.set("category", query.category);
  if (query.status && query.status !== "all") params.set("status", query.status);
  if (query.invoice && query.invoice !== "all") params.set("invoice", query.invoice);
  if (query.channel && query.channel !== "all") params.set("channel", query.channel);
  if (query.platform && query.platform !== "all") params.set("platform", query.platform);
  if (query.paymentMethod && query.paymentMethod !== "all") params.set("paymentMethod", query.paymentMethod);
  return params;
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalize(raw: unknown): RevenueTrendResponse & { category?: string } {
  const data = (raw || {}) as Record<string, unknown>;
  const summary = (data.summary || {}) as Record<string, unknown>;
  const pointsRaw = Array.isArray(data.points) ? data.points : [];

  const normalizedSummary: RevenueTrendSummary = {
    revenue: safeNum(summary.revenue),
    priorRevenue: safeNum(summary.priorRevenue),
    changePercent: summary.changePercent == null ? null : safeNum(summary.changePercent),
    orders: safeNum(summary.orders),
    customers: safeNum(summary.customers),
    averageOrderValue: safeNum(summary.averageOrderValue),
  };

  const points: RevenueTrendPoint[] = pointsRaw.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      periodStart: String(item.periodStart || ""),
      periodEnd: String(item.periodEnd || ""),
      label: String(item.label || ""),
      revenue: safeNum(item.revenue),
      priorRevenue: safeNum(item.priorRevenue),
      changePercent: item.changePercent == null ? null : safeNum(item.changePercent),
      orders: safeNum(item.orders),
      customers: safeNum(item.customers),
      averageOrderValue: safeNum(item.averageOrderValue),
    };
  });

  return {
    granularity: (data.granularity as RevenueTrendGranularity) || "year",
    range: {
      from: String((data.range as Record<string, unknown> | undefined)?.from || ""),
      to: String((data.range as Record<string, unknown> | undefined)?.to || ""),
    },
    summary: normalizedSummary,
    points,
    category: String(data.category || "all"),
  };
}

export function useCategoryRevenueTrend(query: CategoryRevenueTrendQuery, enabled = true) {
  const queryString = toSearchParams(query).toString();
  return useQuery({
    queryKey: ["analytics", "category-revenue-trend", queryString],
    enabled,
    queryFn: async () => {
      const res = await api.get(`/analytics/category-revenue-trend?${queryString}`);
      return normalize(res.data?.data);
    },
    staleTime: 60_000,
  });
}
