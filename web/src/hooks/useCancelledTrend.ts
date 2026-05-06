"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

export type CancelledTrendGranularity = "year" | "month" | "day";

export interface CancelledTrendPoint {
  periodStart: string;
  periodEnd: string;
  label: string;
  totalOrders: number;
  cancelledOrders: number;
  priorCancelledOrders: number;
  cancelledRevenue: number;
  priorCancelledRevenue: number;
  changePercent: number | null;
  cancellationRate: number;
}

export interface CancelledTrendSummary {
  totalOrders: number;
  cancelledOrders: number;
  priorCancelledOrders: number;
  cancelledRevenue: number;
  priorCancelledRevenue: number;
  changePercent: number | null;
  cancellationRate: number;
}

export interface CancelledTrendResponse {
  granularity: CancelledTrendGranularity;
  range: {
    from: string;
    to: string;
  };
  summary: CancelledTrendSummary;
  points: CancelledTrendPoint[];
  reasonBreakdown: CancelledInsightRow[];
  topRiskSegments: {
    platforms: CancelledInsightRow[];
    channels: CancelledInsightRow[];
    paymentMethods: CancelledInsightRow[];
    shippingMethods: CancelledInsightRow[];
    countries: CancelledInsightRow[];
    skus: CancelledInsightRow[];
  };
}

export interface CancelledInsightRow {
  label: string;
  cancelledOrders: number;
  cancelledRevenue: number;
  sharePct: number;
}

export interface CancelledTrendQuery {
  from: string;
  to: string;
  granularity: CancelledTrendGranularity;
  compare?: "prior_year" | "none";
  status?: string;
  invoice?: string;
  channel?: string;
  platform?: string;
  paymentMethod?: string;
}

function toSearchParams(query: CancelledTrendQuery): URLSearchParams {
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

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalize(raw: unknown): CancelledTrendResponse {
  const data = (raw || {}) as Record<string, unknown>;
  const summary = (data.summary || {}) as Record<string, unknown>;
  const pointsRaw = Array.isArray(data.points) ? data.points : [];
  const toInsightRows = (arr: unknown): CancelledInsightRow[] => {
    if (!Array.isArray(arr)) return [];
    return arr.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        label: String(item.label || "Unknown"),
        cancelledOrders: num(item.cancelledOrders),
        cancelledRevenue: num(item.cancelledRevenue),
        sharePct: num(item.sharePct),
      };
    });
  };
  const topRisk = (data.topRiskSegments || {}) as Record<string, unknown>;

  return {
    granularity: (data.granularity as CancelledTrendGranularity) || "year",
    range: {
      from: String((data.range as Record<string, unknown> | undefined)?.from || ""),
      to: String((data.range as Record<string, unknown> | undefined)?.to || ""),
    },
    summary: {
      totalOrders: num(summary.totalOrders),
      cancelledOrders: num(summary.cancelledOrders),
      priorCancelledOrders: num(summary.priorCancelledOrders),
      cancelledRevenue: num(summary.cancelledRevenue),
      priorCancelledRevenue: num(summary.priorCancelledRevenue),
      changePercent: summary.changePercent == null ? null : num(summary.changePercent),
      cancellationRate: num(summary.cancellationRate),
    },
    points: pointsRaw.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        periodStart: String(item.periodStart || ""),
        periodEnd: String(item.periodEnd || ""),
        label: String(item.label || ""),
        totalOrders: num(item.totalOrders),
        cancelledOrders: num(item.cancelledOrders),
        priorCancelledOrders: num(item.priorCancelledOrders),
        cancelledRevenue: num(item.cancelledRevenue),
        priorCancelledRevenue: num(item.priorCancelledRevenue),
        changePercent: item.changePercent == null ? null : num(item.changePercent),
        cancellationRate: num(item.cancellationRate),
      };
    }),
    reasonBreakdown: toInsightRows(data.reasonBreakdown),
    topRiskSegments: {
      platforms: toInsightRows(topRisk.platforms),
      channels: toInsightRows(topRisk.channels),
      paymentMethods: toInsightRows(topRisk.paymentMethods),
      shippingMethods: toInsightRows(topRisk.shippingMethods),
      countries: toInsightRows(topRisk.countries),
      skus: toInsightRows(topRisk.skus),
    },
  };
}

export function useCancelledTrend(query: CancelledTrendQuery, enabled = true) {
  const queryString = toSearchParams(query).toString();
  return useQuery({
    queryKey: ["analytics", "cancelled-trend", queryString],
    enabled,
    queryFn: async () => {
      const res = await api.get(`/analytics/cancelled-trend?${queryString}`);
      return normalize(res.data?.data);
    },
    staleTime: 60_000,
  });
}
