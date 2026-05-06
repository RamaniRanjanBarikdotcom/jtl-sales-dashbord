"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useFilterStore } from "@/lib/store";
import { safeFloat, safeInt } from "@/lib/utils";

/** Raw row shape from /sales/revenue endpoint */
interface RawRevenueRow {
    year_month?: string;
    total_revenue?: string | number;
    total_orders?: string | number;
    prev_year_revenue?: string | number | null;
}
/** Raw row shape from /products/categories */
interface RawCategoryRow { name?: string; total_revenue?: string | number; }
/** Raw row shape from /products/top */
interface RawTopProduct { name?: string; article_number?: string; total_revenue?: string | number; total_units?: string | number; }
/** Raw row shape from /sales/daily */
interface RawDailyRow { total_revenue?: string | number; total_orders?: string | number; }

export interface OverviewKpis {
    totalRevenue:   number;
    totalOrders:    number;
    totalProducts:  number;
    totalCustomers: number;
    lowStockCount:  number;
    revenueDelta:   number | null;
    ordersDelta:    number | null;
}

type RecordData = Record<string, unknown>;

// Do not swallow errors here: callers should surface an actionable UI state.
async function getOverviewData(url: string): Promise<RecordData> {
    try {
        const res = await api.get(url);
        return (res.data?.data ?? {}) as RecordData;
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        throw new Error(`Overview request failed for ${url}: ${message}`);
    }
}

export function useOverviewKpis() {
    const { toParams } = useFilterStore();
    const params = toParams().toString();
    return useQuery({
        queryKey: ["overview", "kpis", params],
        queryFn: async (): Promise<OverviewKpis> => {
            const [s, p, c, inv] = await Promise.all([
                getOverviewData(`/sales/kpis?${params}`),
                getOverviewData(`/products/kpis?${params}`),
                getOverviewData(`/customers/kpis?${params}`),
                getOverviewData("/inventory/kpis"),
            ]);
            return {
                totalRevenue:   safeFloat(s?.total_revenue),
                totalOrders:    safeInt(s?.total_orders),
                totalProducts:  safeInt(p?.active_products ?? p?.total_products),
                totalCustomers: safeInt(c?.total_customers),
                lowStockCount:  safeInt(inv?.low_stock_count),
                revenueDelta:   s?.revenue_delta  != null ? safeFloat(s.revenue_delta)  : null,
                ordersDelta:    s?.orders_delta   != null ? safeFloat(s.orders_delta)   : null,
            };
        },
        staleTime: 0,
        retry: 1,
    });
}

export function useOverviewRevenue() {
    const { toParams } = useFilterStore();
    const params = toParams().toString();
    return useQuery({
        queryKey: ["overview", "revenue", params],
        queryFn: async () => {
            const res = await api.get(`/sales/revenue?${params}`);
            const rows = res.data?.data || [];
            const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            return (Array.isArray(rows) ? rows : []).map((r: RawRevenueRow) => {
                const rev = safeFloat(r.total_revenue);
                const prevYear = r.prev_year_revenue == null ? null : safeFloat(r.prev_year_revenue);
                return {
                    month: r.year_month
                        ? MONTH_NAMES[new Date(r.year_month).getUTCMonth()]
                        : "",
                    revenue: rev,
                    orders:  safeInt(r.total_orders),
                    target:  prevYear !== null && prevYear > 0 ? prevYear : null,
                };
            });
        },
        placeholderData: [],
        staleTime: 0,
    });
}

export function useOverviewDaily() {
    const { toParams } = useFilterStore();
    // Daily always uses 30D window regardless of global range filter
    return useQuery({
        queryKey: ["overview", "daily"],
        queryFn: async () => {
            const res = await api.get("/sales/daily?range=30D");
            const rows = res.data?.data || [];
            return (Array.isArray(rows) ? rows : []).map((r: RawDailyRow, i: number) => ({
                d:   i + 1,
                rev: safeFloat(r.total_revenue),
                ord: safeInt(r.total_orders),
            }));
        },
        placeholderData: [],
        staleTime: 0,
    });
}

export function useOverviewCategories() {
    const { toParams } = useFilterStore();
    const params = toParams().toString();
    return useQuery({
        queryKey: ["overview", "categories", params],
        queryFn: async () => {
            const res = await api.get(`/products/categories?${params}`);
            const rows = res.data?.data || [];
            const COLORS = ["#38bdf8", "#8b5cf6", "#10b981", "#f59e0b", "#f43f5e", "#22d3ee", "#a78bfa", "#fb923c"];
            const safeRows: RawCategoryRow[] = Array.isArray(rows) ? rows : [];
            const ranked = safeRows
                .map((r) => ({
                    name: r.name || "Uncategorized",
                    revenue: safeFloat(r.total_revenue),
                }))
                .filter((r) => r.revenue > 0)
                .sort((a, b) => b.revenue - a.revenue);

            if (ranked.length === 0) return [];

            const totalRevenue = ranked.reduce((s, r) => s + r.revenue, 0);
            const sourceCount = ranked.length;
            return ranked.map((r, i) => ({
                name: r.name,
                v: Math.round((r.revenue / totalRevenue) * 1000) / 10,
                c: COLORS[i % COLORS.length],
                sourceCount,
                revenue: r.revenue,
            }));
        },
        placeholderData: [],
        staleTime: 0,
    });
}

export function useOverviewTopProducts() {
    const { toParams } = useFilterStore();
    const params = toParams().toString();
    return useQuery({
        queryKey: ["overview", "topProducts", params],
        queryFn: async () => {
            const res = await api.get(`/products/top?${params}&limit=20`);
            const rows: RawTopProduct[] = res.data?.data || [];
            return (Array.isArray(rows) ? rows : []).map((r, i) => ({
                rank:  i + 1,
                name:  r.name || r.article_number || "—",
                rev:   safeFloat(r.total_revenue),
                units: safeInt(r.total_units),
            }));
        },
        placeholderData: [],
        staleTime: 0,
    });
}
