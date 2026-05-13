"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

export type ActiveProductsTrendGranularity = "year" | "month" | "day";

export interface ActiveProductsTrendPoint {
  periodStart: string;
  periodEnd: string;
  label: string;
  activeProducts: number;
  priorActiveProducts: number;
  changePercent: number | null;
  unitsSold: number;
  revenue: number;
  orders: number;
  averageRevenuePerActiveProduct: number;
}

export interface ActiveProductsTrendSummary {
  activeProducts: number;
  priorActiveProducts: number;
  changePercent: number | null;
  unitsSold: number;
  revenue: number;
  orders: number;
  averageRevenuePerActiveProduct: number;
}

export interface ActiveProductsTrendResponse {
  granularity: ActiveProductsTrendGranularity;
  range: {
    from: string;
    to: string;
  };
  summary: ActiveProductsTrendSummary;
  points: ActiveProductsTrendPoint[];
}

export interface ActiveProductsTrendQuery {
  from: string;
  to: string;
  granularity: ActiveProductsTrendGranularity;
  compare?: "prior_year" | "none";
  status?: string;
  invoice?: string;
  channel?: string;
  platform?: string;
  paymentMethod?: string;
}

function toSearchParams(query: ActiveProductsTrendQuery): URLSearchParams {
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

function normalize(raw: unknown): ActiveProductsTrendResponse {
  const data = (raw || {}) as Record<string, unknown>;
  const summary = (data.summary || {}) as Record<string, unknown>;
  const pointsRaw = Array.isArray(data.points) ? data.points : [];

  return {
    granularity: (data.granularity as ActiveProductsTrendGranularity) || "year",
    range: {
      from: String((data.range as Record<string, unknown> | undefined)?.from || ""),
      to: String((data.range as Record<string, unknown> | undefined)?.to || ""),
    },
    summary: {
      activeProducts: safeNum(summary.activeProducts),
      priorActiveProducts: safeNum(summary.priorActiveProducts),
      changePercent: summary.changePercent == null ? null : safeNum(summary.changePercent),
      unitsSold: safeNum(summary.unitsSold),
      revenue: safeNum(summary.revenue),
      orders: safeNum(summary.orders),
      averageRevenuePerActiveProduct: safeNum(summary.averageRevenuePerActiveProduct),
    },
    points: pointsRaw.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        periodStart: String(item.periodStart || ""),
        periodEnd: String(item.periodEnd || ""),
        label: String(item.label || ""),
        activeProducts: safeNum(item.activeProducts),
        priorActiveProducts: safeNum(item.priorActiveProducts),
        changePercent: item.changePercent == null ? null : safeNum(item.changePercent),
        unitsSold: safeNum(item.unitsSold),
        revenue: safeNum(item.revenue),
        orders: safeNum(item.orders),
        averageRevenuePerActiveProduct: safeNum(item.averageRevenuePerActiveProduct),
      };
    }),
  };
}

export function useActiveProductsTrend(query: ActiveProductsTrendQuery, enabled = true) {
  const queryString = toSearchParams(query).toString();
  return useQuery({
    queryKey: ["analytics", "active-products-trend", queryString],
    enabled,
    queryFn: async () => {
      const res = await api.get(`/analytics/active-products-trend?${queryString}`);
      return normalize(res.data?.data);
    },
    staleTime: 60_000,
  });
}
