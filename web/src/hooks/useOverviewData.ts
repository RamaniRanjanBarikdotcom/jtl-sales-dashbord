"use client";

import { useAuthedQuery as useQuery } from "@/lib/react-query-auth";
import api from "@/lib/api";
import { useFilterStore } from "@/lib/store";
import { safeFloat, safeInt } from "@/lib/utils";

interface RawRevenueRow {
    year_month?: string;
    total_revenue?: string | number;
    total_orders?: string | number;
    prev_year_revenue?: string | number | null;
}

interface RawCategoryRow {
    name?: string;
    total_revenue?: string | number;
}

interface RawTopProduct {
    product_id?: string | number;
    name?: string;
    article_number?: string;
    total_revenue?: string | number;
    total_units?: string | number;
}

interface RawDailyRow {
    total_revenue?: string | number;
    total_orders?: string | number;
}

interface OverviewAggregate {
    kpis?: {
        sales?: Record<string, unknown>;
        products?: Record<string, unknown>;
        customers?: Record<string, unknown>;
        inventory?: Record<string, unknown>;
    };
    revenue?: RawRevenueRow[];
    dailySales?: RawDailyRow[];
    categories?: RawCategoryRow[];
    topProducts?: RawTopProduct[];
}

export interface OverviewKpis {
    totalRevenue:   number;
    totalOrders:    number;
    totalProducts:  number;
    totalCustomers: number;
    lowStockCount:  number;
    revenueDelta:   number | null;
    ordersDelta:    number | null;
}

async function getOverviewAggregate(params: string): Promise<OverviewAggregate> {
    try {
        const suffix = params ? `?${params}` : "";
        const res = await api.get(`/dashboard/overview${suffix}`);
        const payload = res.data?.data;
        return ((payload?.data && typeof payload.data === "object") ? payload.data : payload ?? {}) as OverviewAggregate;
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        throw new Error(`Overview request failed: ${message}`);
    }
}

function overviewQuery(params: string) {
    return {
        queryKey: ["overview", "aggregate", params],
        queryFn: () => getOverviewAggregate(params),
        staleTime: 300_000,
        retry: 1,
    } as const;
}

export function useOverviewKpis() {
    const { toParams } = useFilterStore();
    const params = toParams().toString();
    return useQuery({
        ...overviewQuery(params),
        select: (data): OverviewKpis => {
            const sales = data.kpis?.sales ?? {};
            const products = data.kpis?.products ?? {};
            const customers = data.kpis?.customers ?? {};
            const inventory = data.kpis?.inventory ?? {};
            return {
                totalRevenue:   safeFloat(sales.total_revenue),
                totalOrders:    safeInt(sales.total_orders),
                totalProducts:  safeInt(products.active_products ?? products.total_products),
                totalCustomers: safeInt(customers.total_customers),
                lowStockCount:  safeInt(inventory.low_stock_count),
                revenueDelta:   sales.revenue_delta != null ? safeFloat(sales.revenue_delta) : null,
                ordersDelta:    sales.orders_delta  != null ? safeFloat(sales.orders_delta)  : null,
            };
        },
    });
}

export function useOverviewRevenue() {
    const { toParams } = useFilterStore();
    const params = toParams().toString();
    return useQuery({
        ...overviewQuery(params),
        select: (data) => {
            const rows = data.revenue || [];
            const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            return (Array.isArray(rows) ? rows : []).map((r) => {
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
    });
}

export function useOverviewDaily() {
    const { toParams } = useFilterStore();
    const params = toParams().toString();
    return useQuery({
        ...overviewQuery(params),
        select: (data) => {
            const rows = data.dailySales || [];
            return (Array.isArray(rows) ? rows : []).map((r, i) => ({
                d:   i + 1,
                rev: safeFloat(r.total_revenue),
                ord: safeInt(r.total_orders),
            }));
        },
    });
}

export function useOverviewCategories() {
    const { toParams } = useFilterStore();
    const params = toParams().toString();
    return useQuery({
        ...overviewQuery(params),
        select: (data) => {
            const rows = data.categories || [];
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

            const totalRevenue = ranked.reduce((sum, row) => sum + row.revenue, 0);
            const sourceCount = ranked.length;
            return ranked.map((row, index) => ({
                name: row.name,
                v: Math.round((row.revenue / totalRevenue) * 1000) / 10,
                c: COLORS[index % COLORS.length],
                sourceCount,
                revenue: row.revenue,
            }));
        },
    });
}

export function useOverviewTopProducts() {
    const { toParams } = useFilterStore();
    const params = toParams().toString();
    return useQuery({
        ...overviewQuery(params),
        select: (data) => {
            const rows = data.topProducts || [];
            return (Array.isArray(rows) ? rows : []).map((r, i) => ({
                rank:  i + 1,
                productId: safeInt(r.product_id),
                name:  r.name || r.article_number || "—",
                articleNumber: r.article_number || "-",
                rev:   safeFloat(r.total_revenue),
                units: safeInt(r.total_units),
            }));
        },
    });
}
