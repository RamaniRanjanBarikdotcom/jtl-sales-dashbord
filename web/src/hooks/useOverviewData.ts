"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

const HAS_API = () => !!process.env.NEXT_PUBLIC_API_URL;

export interface OverviewKpis {
    totalRevenue: number;
    totalOrders: number;
    totalProducts: number;
    totalCustomers: number;
    lowStockCount: number;
}

export function useOverviewKpis() {
    return useQuery({
        queryKey: ["overview", "kpis"],
        queryFn: async (): Promise<OverviewKpis> => {
            if (!HAS_API()) return { totalRevenue: 0, totalOrders: 0, totalProducts: 0, totalCustomers: 0, lowStockCount: 0 };
            const [sales, products, customers, inventory] = await Promise.all([
                api.get("/sales/kpis").catch(() => ({ data: { data: {} } })),
                api.get("/products/kpis").catch(() => ({ data: { data: {} } })),
                api.get("/customers/kpis").catch(() => ({ data: { data: {} } })),
                api.get("/inventory/kpis").catch(() => ({ data: { data: {} } })),
            ]);
            const s = sales.data?.data || {};
            const p = products.data?.data || {};
            const c = customers.data?.data || {};
            const inv = inventory.data?.data || {};
            return {
                totalRevenue: parseFloat(s.total_revenue) || 0,
                totalOrders: parseInt(s.total_orders) || 0,
                totalProducts: parseInt(p.total_products) || 0,
                totalCustomers: parseInt(c.total_customers) || 0,
                lowStockCount: parseInt(inv.low_stock_count) || 0,
            };
        },
        placeholderData: { totalRevenue: 0, totalOrders: 0, totalProducts: 0, totalCustomers: 0, lowStockCount: 0 },
        staleTime: 0,
    });
}

export function useOverviewRevenue() {
    return useQuery({
        queryKey: ["overview", "revenue"],
        queryFn: async () => {
            if (!HAS_API()) return [];
            const res = await api.get("/sales/revenue?range=12M");
            const rows = res.data?.data || [];
            return (Array.isArray(rows) ? rows : []).map((r: any) => ({
                month: r.year_month
                    ? new Date(r.year_month).toLocaleString('en', { month: 'short' })
                    : "",
                revenue: parseFloat(r.total_revenue) || 0,
                orders: parseInt(r.total_orders) || 0,
            }));
        },
        placeholderData: [],
        staleTime: 0,
    });
}

export function useOverviewDaily() {
    return useQuery({
        queryKey: ["overview", "daily"],
        queryFn: async () => {
            if (!HAS_API()) return [];
            const res = await api.get("/sales/daily?range=30D");
            const rows = res.data?.data || [];
            return (Array.isArray(rows) ? rows : []).map((r: any) => ({
                d: new Date(r.summary_date).getDate(),
                rev: parseFloat(r.total_revenue) || 0,
                ord: parseInt(r.total_orders) || 0,
            }));
        },
        placeholderData: [],
        staleTime: 0,
    });
}

export function useOverviewCategories() {
    return useQuery({
        queryKey: ["overview", "categories"],
        queryFn: async () => {
            if (!HAS_API()) return [];
            const res = await api.get("/products/categories");
            const rows = res.data?.data || [];
            const COLORS = ["#38bdf8", "#8b5cf6", "#10b981", "#f59e0b", "#f43f5e", "#22d3ee", "#a78bfa", "#fb923c"];
            const total = (Array.isArray(rows) ? rows : []).reduce((s: number, r: any) => s + (parseFloat(r.total_revenue) || 0), 0) || 1;
            return (Array.isArray(rows) ? rows : []).slice(0, 6).map((r: any, i: number) => ({
                name: r.name || "Other",
                v: Math.round(((parseFloat(r.total_revenue) || 0) / total) * 100),
                c: COLORS[i % COLORS.length],
            }));
        },
        placeholderData: [],
        staleTime: 0,
    });
}

export function useOverviewTopProducts() {
    return useQuery({
        queryKey: ["overview", "topProducts"],
        queryFn: async () => {
            if (!HAS_API()) return [];
            const res = await api.get("/products/top?limit=5");
            const rows = res.data?.data || [];
            return (Array.isArray(rows) ? rows : []).map((r: any, i: number) => ({
                rank: i + 1,
                name: r.name || r.article_number || "—",
                rev: parseFloat(r.total_revenue) || 0,
                units: parseInt(r.total_units) || 0,
            }));
        },
        placeholderData: [],
        staleTime: 0,
    });
}
