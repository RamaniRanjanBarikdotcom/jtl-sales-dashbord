"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useFilterStore } from "@/lib/store";

export interface OverviewKpis {
    totalRevenue: number;
    totalOrders: number;
    totalProducts: number;
    totalCustomers: number;
    lowStockCount: number;
}

export function useOverviewKpis() {
    const { toParams } = useFilterStore();
    const params = toParams().toString();
    return useQuery({
        queryKey: ["overview", "kpis", params],
        queryFn: async (): Promise<OverviewKpis> => {
            const [sales, products, customers, inventory] = await Promise.all([
                api.get(`/sales/kpis?${params}`).catch(() => ({ data: { data: {} } })),
                api.get("/products/kpis").catch(() => ({ data: { data: {} } })),
                api.get("/customers/kpis").catch(() => ({ data: { data: {} } })),
                api.get("/inventory/kpis").catch(() => ({ data: { data: {} } })),
            ]);
            const s   = sales.data?.data     || {};
            const p   = products.data?.data  || {};
            const c   = customers.data?.data || {};
            const inv = inventory.data?.data || {};
            return {
                totalRevenue:  parseFloat(s.total_revenue)  || 0,
                totalOrders:   parseInt(s.total_orders)     || 0,
                totalProducts: parseInt(p.active_products ?? p.total_products) || 0,
                totalCustomers: parseInt(c.total_customers) || 0,
                lowStockCount: parseInt(inv.low_stock_count) || 0,
            };
        },
        placeholderData: { totalRevenue: 0, totalOrders: 0, totalProducts: 0, totalCustomers: 0, lowStockCount: 0 },
        staleTime: 0,
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
            return (Array.isArray(rows) ? rows : []).map((r: any) => ({
                month: r.year_month
                    ? MONTH_NAMES[new Date(r.year_month).getUTCMonth()]
                    : "",
                revenue: parseFloat(r.total_revenue) || 0,
                orders:  parseInt(r.total_orders)    || 0,
                target:  Math.round((parseFloat(r.total_revenue) || 0) * 1.1),
            }));
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
            return (Array.isArray(rows) ? rows : []).map((r: any, i: number) => ({
                d:   i + 1,
                rev: parseFloat(r.total_revenue) || 0,
                ord: parseInt(r.total_orders)    || 0,
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
            const total = (Array.isArray(rows) ? rows : [])
                .reduce((s: number, r: any) => s + (parseFloat(r.total_revenue) || 0), 0) || 1;
            return (Array.isArray(rows) ? rows : []).slice(0, 6).map((r: any, i: number) => ({
                name: r.name || "Other",
                v:    Math.round(((parseFloat(r.total_revenue) || 0) / total) * 100),
                c:    COLORS[i % COLORS.length],
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
            const res = await api.get(`/products/top?${params}&limit=5`);
            const rows = res.data?.data || [];
            return (Array.isArray(rows) ? rows : []).map((r: any, i: number) => ({
                rank:  i + 1,
                name:  r.name || r.article_number || "—",
                rev:   parseFloat(r.total_revenue) || 0,
                units: parseInt(r.total_units)     || 0,
            }));
        },
        placeholderData: [],
        staleTime: 0,
    });
}
