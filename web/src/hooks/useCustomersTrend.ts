"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

export type CustomersTrendGranularity = "year" | "month" | "day";

export interface CustomersTrendPoint {
  periodStart: string;
  periodEnd: string;
  label: string;
  customers: number;
  priorCustomers: number;
  changePercent: number | null;
  orders: number;
  revenue: number;
  averageOrderValue: number;
  averageRevenuePerCustomer: number;
}

export interface CustomersTrendSummary {
  customers: number;
  priorCustomers: number;
  changePercent: number | null;
  orders: number;
  revenue: number;
  averageOrderValue: number;
  averageRevenuePerCustomer: number;
}

export interface CustomersTrendResponse {
  granularity: CustomersTrendGranularity;
  range: {
    from: string;
    to: string;
  };
  summary: CustomersTrendSummary;
  points: CustomersTrendPoint[];
}

export interface CustomersTrendQuery {
  from: string;
  to: string;
  granularity: CustomersTrendGranularity;
  compare?: "prior_year" | "none";
  status?: string;
  invoice?: string;
  channel?: string;
  platform?: string;
  paymentMethod?: string;
}

function toSearchParams(query: CustomersTrendQuery): URLSearchParams {
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

function normalize(raw: unknown): CustomersTrendResponse {
  const data = (raw || {}) as Record<string, unknown>;
  const summary = (data.summary || {}) as Record<string, unknown>;
  const pointsRaw = Array.isArray(data.points) ? data.points : [];

  return {
    granularity: (data.granularity as CustomersTrendGranularity) || "year",
    range: {
      from: String((data.range as Record<string, unknown> | undefined)?.from || ""),
      to: String((data.range as Record<string, unknown> | undefined)?.to || ""),
    },
    summary: {
      customers: safeNum(summary.customers),
      priorCustomers: safeNum(summary.priorCustomers),
      changePercent: summary.changePercent == null ? null : safeNum(summary.changePercent),
      orders: safeNum(summary.orders),
      revenue: safeNum(summary.revenue),
      averageOrderValue: safeNum(summary.averageOrderValue),
      averageRevenuePerCustomer: safeNum(summary.averageRevenuePerCustomer),
    },
    points: pointsRaw.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        periodStart: String(item.periodStart || ""),
        periodEnd: String(item.periodEnd || ""),
        label: String(item.label || ""),
        customers: safeNum(item.customers),
        priorCustomers: safeNum(item.priorCustomers),
        changePercent: item.changePercent == null ? null : safeNum(item.changePercent),
        orders: safeNum(item.orders),
        revenue: safeNum(item.revenue),
        averageOrderValue: safeNum(item.averageOrderValue),
        averageRevenuePerCustomer: safeNum(item.averageRevenuePerCustomer),
      };
    }),
  };
}

export function useCustomersTrend(query: CustomersTrendQuery, enabled = true) {
  const queryString = toSearchParams(query).toString();
  return useQuery({
    queryKey: ["analytics", "customers-trend", queryString],
    enabled,
    queryFn: async () => {
      const res = await api.get(`/analytics/customers-trend?${queryString}`);
      return normalize(res.data?.data);
    },
    staleTime: 60_000,
  });
}
