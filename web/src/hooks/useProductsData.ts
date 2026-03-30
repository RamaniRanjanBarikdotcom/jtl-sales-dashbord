"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useFilterStore } from "@/lib/store";

export interface ProductsKpis {
    totalSkus:      number;
    activeSkus:     number;
    avgMargin:      number;
    topCategoryRev: number;
}

const EMPTY_PKPIS: ProductsKpis = {
    totalSkus:      0,
    activeSkus:     0,
    avgMargin:      0,
    topCategoryRev: 0,
};

function transformProductsKpis(d: any): ProductsKpis {
    return {
        totalSkus:      parseInt(d.total_products) || 0,
        activeSkus:     parseInt(d.active_products ?? d.total_products) || 0,
        avgMargin:      Math.round(parseFloat(d.avg_margin) || 0),
        topCategoryRev: parseFloat(d.total_stock_value ?? d.total_revenue) || 0,
    };
}

export function useProductsKpis() {
    const { toParams } = useFilterStore();
    return useQuery({
        queryKey: ['products', 'kpis', toParams().toString()],
        queryFn: async (): Promise<ProductsKpis> => {
            const res = await api.get(`/products/kpis?${toParams()}`);
            return transformProductsKpis(res.data.data);
        },
        placeholderData: EMPTY_PKPIS,
        staleTime: 15 * 60 * 1000,
    });
}

export interface ProductRow {
    id:             number | string;
    rank:           number;
    name:           string;
    cat:            string;
    rev:            number;
    units:          number;
    margin:         number;
    trend:          number;
    rating:         number;
    article_number: string;
}

export interface ProductsListResponse {
    rows:  ProductRow[];
    total: number;
    page:  number;
    limit: number;
}

function transformProductsList(rows: any[]): ProductRow[] {
    if (!rows?.length) return [];
    return rows.map((p: any, i: number) => ({
        id:     p.id || i + 1,
        rank:   i + 1,
        name:   p.name || 'Unknown',
        cat:    p.category_name || 'Uncategorized',
        rev:    parseFloat(p.total_revenue) || 0,
        units:  parseInt(p.total_units) || 0,
        margin: Math.round(parseFloat(p.margin_pct) || 0),
        trend:  0,
        rating: 0,
        article_number: p.article_number || '',
    }));
}

export interface ProductsListFilters {
    page?:   number;
    limit?:  number;
    search?: string;
    sort?:   string;
    order?:  string;
}

export function useProductsList(filters: ProductsListFilters = {}) {
    const { toParams } = useFilterStore();
    const params = new URLSearchParams(toParams());
    if (filters.page)   params.set('page',   String(filters.page));
    if (filters.limit)  params.set('limit',  String(filters.limit));
    if (filters.search) params.set('search', filters.search);
    if (filters.sort)   params.set('sort',   filters.sort);
    if (filters.order)  params.set('order',  filters.order);

    return useQuery({
        queryKey: ['products', 'list', params.toString()],
        queryFn: async (): Promise<ProductsListResponse> => {
            const res = await api.get(`/products?${params}`);
            const d = res.data;
            // Support both paginated envelope { rows, total, page, limit } and raw array
            if (Array.isArray(d.data)) {
                return { rows: transformProductsList(d.data), total: d.total ?? d.data.length, page: filters.page ?? 1, limit: filters.limit ?? 50 };
            }
            const rows = d.data?.rows ?? d.rows ?? [];
            return {
                rows:  transformProductsList(rows),
                total: d.data?.total ?? d.total ?? rows.length,
                page:  d.data?.page  ?? d.page  ?? (filters.page ?? 1),
                limit: d.data?.limit ?? d.limit ?? (filters.limit ?? 50),
            };
        },
        placeholderData: { rows: [], total: 0, page: 1, limit: 50 },
        staleTime: 15 * 60 * 1000,
    });
}

const CAT_COLORS = ['#38bdf8','#8b5cf6','#10b981','#f59e0b','#f43f5e','#06b6d4','#a78bfa','#fb923c'];

function transformCategories(rows: any[]) {
    if (!rows?.length) return [];
    const totalRev = rows.reduce((s: number, r: any) => s + (parseFloat(r.total_revenue) || 0), 0);
    return rows.map((r: any, i: number) => ({
        name: r.name,
        v:    totalRev > 0 ? Math.round((parseFloat(r.total_revenue) || 0) / totalRev * 100) : 0,
        c:    CAT_COLORS[i % CAT_COLORS.length],
    }));
}

export function useProductsCategories() {
    const { toParams } = useFilterStore();
    return useQuery({
        queryKey: ['products', 'categories', toParams().toString()],
        queryFn: async () => {
            const res = await api.get(`/products/categories?${toParams()}`);
            return transformCategories(res.data.data);
        },
        placeholderData: [],
        staleTime: 15 * 60 * 1000,
    });
}

export function useProductsTop() {
    const { toParams } = useFilterStore();
    return useQuery({
        queryKey: ['products', 'top', toParams().toString()],
        queryFn: async () => {
            const res = await api.get(`/products/top?${toParams()}&limit=5`);
            return transformProductsList(res.data.data);
        },
        placeholderData: [],
        staleTime: 15 * 60 * 1000,
    });
}
