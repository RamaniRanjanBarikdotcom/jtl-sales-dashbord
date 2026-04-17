"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useFilterStore } from "@/lib/store";
import { safeFloat, safeInt } from "@/lib/utils";

export interface ProductsKpis {
    totalSkus:          number;
    activeSkus:         number;
    avgMargin:          number;
    topCategoryRev:     number;
    // period-over-period deltas (null = no prev data)
    topRevDelta:        number | null;
    avgMarginDelta:     number | null;
}

const EMPTY_PKPIS: ProductsKpis = {
    totalSkus:          0,
    activeSkus:         0,
    avgMargin:          0,
    topCategoryRev:     0,
    topRevDelta:        null,
    avgMarginDelta:     null,
};

function transformProductsKpis(d: Record<string, unknown>): ProductsKpis {
    return {
        totalSkus:      safeInt(d.total_products),
        activeSkus:     safeInt(d.active_products ?? d.total_products),
        avgMargin:      Math.round(safeFloat(d.avg_margin)),
        topCategoryRev: safeFloat(d.top_product_revenue),
        topRevDelta:    d.top_product_delta  != null ? safeFloat(d.top_product_delta)  : null,
        avgMarginDelta: d.avg_margin_delta   != null ? safeFloat(d.avg_margin_delta)   : null,
    };
}

export function useProductsKpis() {
    const { toParams } = useFilterStore();
    const params = toParams().toString();
    return useQuery({
        queryKey: ['products', 'kpis', params],
        queryFn: async (): Promise<ProductsKpis> => {
            const res = await api.get(`/products/kpis?${params}`);
            return transformProductsKpis(res.data.data);
        },
        placeholderData: EMPTY_PKPIS,
        staleTime: 0,
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

function transformProductsList(rows: Record<string, unknown>[]): ProductRow[] {
    if (!rows?.length) return [];
    return rows.map((p, i) => {
        const curRev  = safeFloat(p.total_revenue);
        const prevRev = safeFloat(p.prev_revenue);
        const trend   = prevRev > 0 ? Math.round((curRev - prevRev) / prevRev * 10) / 10 : 0;
        return {
            id:     (p.id as string | number) || i + 1,
            rank:   i + 1,
            name:   String(p.name || 'Unknown'),
            cat:    String(p.category_name || 'Uncategorized'),
            rev:    curRev,
            units:  safeInt(p.total_units),
            margin: Math.round(safeFloat(p.margin_pct)),
            trend,
            rating: 0,
            article_number: String(p.article_number || ''),
        };
    });
}

export interface ProductsListFilters {
    page?:   number;
    limit?:  number;
    search?: string;
    category?: string;
    sort?:   string;
    order?:  string;
}

export function useProductsList(filters: ProductsListFilters = {}) {
    const { toParams } = useFilterStore();
    const params = new URLSearchParams(toParams());
    if (filters.page)   params.set('page',   String(filters.page));
    if (filters.limit)  params.set('limit',  String(filters.limit));
    if (filters.search) params.set('search', filters.search);
    if (filters.category) params.set('category', filters.category);
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
        staleTime: 0,
    });
}

const CAT_COLORS = ['#38bdf8','#8b5cf6','#10b981','#f59e0b','#f43f5e','#06b6d4','#a78bfa','#fb923c'];

function transformCategories(rows: Record<string, unknown>[]) {
    if (!rows?.length) return [];
    const totalRev = rows.reduce((s, r) => s + safeFloat(r.total_revenue), 0);
    return rows.map((r, i) => ({
        name: String(r.name || 'Other'),
        v:    totalRev > 0 ? Math.round(safeFloat(r.total_revenue) / totalRev * 100) : 0,
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
        staleTime: 0,
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
        staleTime: 0,
    });
}
