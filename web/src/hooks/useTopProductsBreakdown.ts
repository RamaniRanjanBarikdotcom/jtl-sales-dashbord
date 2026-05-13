"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

export type TopProductsBreakdownQuery = {
  from: string;
  to: string;
  productId?: number | null;
  search?: string;
  status?: string;
  invoice?: string;
  channel?: string;
  platform?: string;
  paymentMethod?: string;
};

export type ProductBreakdownRow = {
  name: string;
  revenue: number;
  orders: number;
  units: number;
};

export type TopProductRecordOrder = {
  orderNumber: string;
  orderDate: string;
  revenue: number;
  units: number;
  country: string;
  channel: string;
  platform: string;
  paymentMethod: string;
  shippingMethod: string;
  customerName: string;
};

export type TopProductRecordCustomer = {
  customerName: string;
  email: string;
  country: string;
  orders: number;
  units: number;
  revenue: number;
  averageOrderValue: number;
  lastOrderDate: string;
};

export type TopProductListItem = {
  rank: number;
  productId: number;
  name: string;
  articleNumber: string;
  revenue: number;
  units: number;
  orders: number;
  customers: number;
};

export type TopProductsBreakdownResponse = {
  range: { from: string; to: string };
  selectedProductId: number | null;
  summary: {
    revenue: number;
    units: number;
    orders: number;
    customers: number;
    averageOrderValue: number;
    revenueSharePct: number;
  };
  selectedProduct: {
    productId: number;
    name: string;
    articleNumber: string;
    revenue: number;
    units: number;
    orders: number;
    customers: number;
    averageOrderValue: number;
  } | null;
  topProducts: TopProductListItem[];
  breakdown: {
    channels: ProductBreakdownRow[];
    platforms: ProductBreakdownRow[];
    paymentMethods: ProductBreakdownRow[];
    shippingMethods: ProductBreakdownRow[];
    countries: ProductBreakdownRow[];
  };
  records: {
    orders: TopProductRecordOrder[];
    customers: TopProductRecordCustomer[];
  };
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toParams(query: TopProductsBreakdownQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("from", query.from);
  params.set("to", query.to);
  if (query.productId && query.productId > 0) params.set("productId", String(query.productId));
  if (query.search && query.search.trim()) params.set("search", query.search.trim());
  if (query.status && query.status !== "all") params.set("status", query.status);
  if (query.invoice && query.invoice !== "all") params.set("invoice", query.invoice);
  if (query.channel && query.channel !== "all") params.set("channel", query.channel);
  if (query.platform && query.platform !== "all") params.set("platform", query.platform);
  if (query.paymentMethod && query.paymentMethod !== "all") params.set("paymentMethod", query.paymentMethod);
  return params;
}

function mapBreakdownRows(rows: unknown): ProductBreakdownRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      name: String(r.name || "Unknown"),
      revenue: num(r.revenue),
      orders: num(r.orders),
      units: num(r.units),
    };
  });
}

function normalize(raw: unknown): TopProductsBreakdownResponse {
  const data = (raw || {}) as Record<string, unknown>;
  const summary = (data.summary || {}) as Record<string, unknown>;
  const selectedProduct = data.selectedProduct as Record<string, unknown> | null | undefined;
  const breakdown = (data.breakdown || {}) as Record<string, unknown>;
  const records = (data.records || {}) as Record<string, unknown>;

  return {
    range: {
      from: String((data.range as Record<string, unknown> | undefined)?.from || ""),
      to: String((data.range as Record<string, unknown> | undefined)?.to || ""),
    },
    selectedProductId: data.selectedProductId == null ? null : num(data.selectedProductId),
    summary: {
      revenue: num(summary.revenue),
      units: num(summary.units),
      orders: num(summary.orders),
      customers: num(summary.customers),
      averageOrderValue: num(summary.averageOrderValue),
      revenueSharePct: num(summary.revenueSharePct),
    },
    selectedProduct: selectedProduct
      ? {
          productId: num(selectedProduct.productId),
          name: String(selectedProduct.name || "Unknown Product"),
          articleNumber: String(selectedProduct.articleNumber || "-"),
          revenue: num(selectedProduct.revenue),
          units: num(selectedProduct.units),
          orders: num(selectedProduct.orders),
          customers: num(selectedProduct.customers),
          averageOrderValue: num(selectedProduct.averageOrderValue),
        }
      : null,
    topProducts: (Array.isArray(data.topProducts) ? data.topProducts : []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        rank: num(r.rank),
        productId: num(r.productId),
        name: String(r.name || "Unknown Product"),
        articleNumber: String(r.articleNumber || "-"),
        revenue: num(r.revenue),
        units: num(r.units),
        orders: num(r.orders),
        customers: num(r.customers),
      };
    }),
    breakdown: {
      channels: mapBreakdownRows(breakdown.channels),
      platforms: mapBreakdownRows(breakdown.platforms),
      paymentMethods: mapBreakdownRows(breakdown.paymentMethods),
      shippingMethods: mapBreakdownRows(breakdown.shippingMethods),
      countries: mapBreakdownRows(breakdown.countries),
    },
    records: {
      orders: (Array.isArray(records.orders) ? records.orders : []).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          orderNumber: String(r.orderNumber || "-"),
          orderDate: String(r.orderDate || ""),
          revenue: num(r.revenue),
          units: num(r.units),
          country: String(r.country || "Unknown"),
          channel: String(r.channel || "Unknown"),
          platform: String(r.platform || "Unknown"),
          paymentMethod: String(r.paymentMethod || "Unknown"),
          shippingMethod: String(r.shippingMethod || "Unknown"),
          customerName: String(r.customerName || "Unknown Customer"),
        };
      }),
      customers: (Array.isArray(records.customers) ? records.customers : []).map((row) => {
        const r = row as Record<string, unknown>;
        return {
          customerName: String(r.customerName || "Unknown Customer"),
          email: String(r.email || "-"),
          country: String(r.country || "Unknown"),
          orders: num(r.orders),
          units: num(r.units),
          revenue: num(r.revenue),
          averageOrderValue: num(r.averageOrderValue),
          lastOrderDate: String(r.lastOrderDate || ""),
        };
      }),
    },
  };
}

export function useTopProductsBreakdown(query: TopProductsBreakdownQuery, enabled = true) {
  const queryString = toParams(query).toString();
  return useQuery({
    queryKey: ["analytics", "top-products-breakdown", queryString],
    enabled,
    queryFn: async () => {
      const res = await api.get(`/analytics/top-products-breakdown?${queryString}`);
      return normalize(res.data?.data);
    },
    staleTime: 60_000,
  });
}
