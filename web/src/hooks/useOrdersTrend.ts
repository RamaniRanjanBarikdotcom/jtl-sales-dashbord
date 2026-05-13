"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

export type OrdersTrendGranularity = "year" | "month" | "day";

export interface OrdersTrendPoint {
  periodStart: string;
  periodEnd: string;
  label: string;
  orders: number;
  priorOrders: number;
  changePercent: number | null;
  revenue: number;
  customers: number;
  averageOrderValue: number;
}

export interface OrdersTrendSummary {
  orders: number;
  priorOrders: number;
  changePercent: number | null;
  revenue: number;
  customers: number;
  averageOrderValue: number;
}

export interface OrdersTrendResponse {
  granularity: OrdersTrendGranularity;
  range: {
    from: string;
    to: string;
  };
  summary: OrdersTrendSummary;
  points: OrdersTrendPoint[];
}

export interface OrdersTrendQuery {
  from: string;
  to: string;
  granularity: OrdersTrendGranularity;
  compare?: "prior_year" | "none";
  status?: string;
  invoice?: string;
  channel?: string;
  platform?: string;
  paymentMethod?: string;
}

function toSearchParams(query: OrdersTrendQuery): URLSearchParams {
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

function normalize(raw: unknown): OrdersTrendResponse {
  const data = (raw || {}) as Record<string, unknown>;
  const summary = (data.summary || {}) as Record<string, unknown>;
  const pointsRaw = Array.isArray(data.points) ? data.points : [];

  return {
    granularity: (data.granularity as OrdersTrendGranularity) || "year",
    range: {
      from: String((data.range as Record<string, unknown> | undefined)?.from || ""),
      to: String((data.range as Record<string, unknown> | undefined)?.to || ""),
    },
    summary: {
      orders: safeNum(summary.orders),
      priorOrders: safeNum(summary.priorOrders),
      changePercent: summary.changePercent == null ? null : safeNum(summary.changePercent),
      revenue: safeNum(summary.revenue),
      customers: safeNum(summary.customers),
      averageOrderValue: safeNum(summary.averageOrderValue),
    },
    points: pointsRaw.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        periodStart: String(item.periodStart || ""),
        periodEnd: String(item.periodEnd || ""),
        label: String(item.label || ""),
        orders: safeNum(item.orders),
        priorOrders: safeNum(item.priorOrders),
        changePercent: item.changePercent == null ? null : safeNum(item.changePercent),
        revenue: safeNum(item.revenue),
        customers: safeNum(item.customers),
        averageOrderValue: safeNum(item.averageOrderValue),
      };
    }),
  };
}

export function useOrdersTrend(query: OrdersTrendQuery, enabled = true) {
  const queryString = toSearchParams(query).toString();
  return useQuery({
    queryKey: ["analytics", "orders-trend", queryString],
    enabled,
    queryFn: async () => {
      const res = await api.get(`/analytics/orders-trend?${queryString}`);
      return normalize(res.data?.data);
    },
    staleTime: 60_000,
  });
}
