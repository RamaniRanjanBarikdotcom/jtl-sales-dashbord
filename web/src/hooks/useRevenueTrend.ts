"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

export type RevenueTrendGranularity = "year" | "month" | "day";

export interface RevenueTrendPoint {
  periodStart: string;
  periodEnd: string;
  label: string;
  revenue: number;
  priorRevenue: number;
  changePercent: number | null;
  orders: number;
  customers: number;
  averageOrderValue: number;
}

export interface RevenueTrendSummary {
  revenue: number;
  priorRevenue: number;
  changePercent: number | null;
  orders: number;
  customers: number;
  averageOrderValue: number;
}

export interface RevenueTrendResponse {
  granularity: RevenueTrendGranularity;
  range: {
    from: string;
    to: string;
  };
  summary: RevenueTrendSummary;
  points: RevenueTrendPoint[];
}

export interface RevenueTrendQuery {
  from: string;
  to: string;
  granularity: RevenueTrendGranularity;
  compare?: "prior_year" | "none";
  status?: string;
  invoice?: string;
  channel?: string;
  platform?: string;
  paymentMethod?: string;
}

function toSearchParams(query: RevenueTrendQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("from", query.from);
  params.set("to", query.to);
  params.set("granularity", query.granularity);
  params.set("compare", query.compare || "prior_year");
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

function normalize(raw: unknown): RevenueTrendResponse {
  const data = (raw || {}) as Record<string, unknown>;
  const summary = (data.summary || {}) as Record<string, unknown>;
  const pointsRaw = Array.isArray(data.points) ? data.points : [];

  return {
    granularity: (data.granularity as RevenueTrendGranularity) || "year",
    range: {
      from: String((data.range as Record<string, unknown> | undefined)?.from || ""),
      to: String((data.range as Record<string, unknown> | undefined)?.to || ""),
    },
    summary: {
      revenue: safeNum(summary.revenue),
      priorRevenue: safeNum(summary.priorRevenue),
      changePercent: summary.changePercent == null ? null : safeNum(summary.changePercent),
      orders: safeNum(summary.orders),
      customers: safeNum(summary.customers),
      averageOrderValue: safeNum(summary.averageOrderValue),
    },
    points: pointsRaw.map((row) => {
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
    }),
  };
}

export function useRevenueTrend(query: RevenueTrendQuery, enabled = true) {
  const queryString = toSearchParams(query).toString();
  return useQuery({
    queryKey: ["analytics", "revenue-trend", queryString],
    enabled,
    queryFn: async () => {
      const res = await api.get(`/analytics/revenue-trend?${queryString}`);
      return normalize(res.data?.data);
    },
    staleTime: 60_000,
  });
}
