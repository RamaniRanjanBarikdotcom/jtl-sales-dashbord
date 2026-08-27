"use client";

import { useAuthedQuery as useQuery } from "@/lib/react-query-auth";
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
    marginAvailable:    boolean;
    marginCoveragePct:  number;
    noSalesProducts:    number;
}

function transformProductsKpis(d: Record<string, unknown>): ProductsKpis {
    return {
        totalSkus:      safeInt(d.total_products),
        activeSkus:     safeInt(d.active_products ?? d.total_products),
        avgMargin:      Math.round(safeFloat(d.avg_margin)),
        topCategoryRev: safeFloat(d.top_product_revenue),
        topRevDelta:    d.top_product_delta  != null ? safeFloat(d.top_product_delta)  : null,
        avgMarginDelta: d.avg_margin_delta   != null ? safeFloat(d.avg_margin_delta)   : null,
        marginAvailable: Boolean(d.margin_available),
        marginCoveragePct: safeFloat(d.margin_cost_coverage_pct),
        noSalesProducts: safeInt(d.no_sales_products),
    };
}

export function useProductsKpis(paramsOverride?: URLSearchParams | string) {
    const { toParams } = useFilterStore();
    const params = new URLSearchParams(toParams());
    if (paramsOverride) {
        const override = new URLSearchParams(paramsOverride.toString());
        override.forEach((v, k) => params.set(k, v));
    }
    return useQuery({
        queryKey: ['products', 'kpis', params.toString()],
        queryFn: async (): Promise<ProductsKpis> => {
            const res = await api.get(`/products/kpis?${params}`);
            return transformProductsKpis(res.data.data);
        },
        staleTime: 60_000,
    });
}

export interface ProductRow {
    id:             number | string;
    jtl_product_id: number;
    rank:           number;
    name:           string;
    cat:            string;
    rev:            number;
    units:          number;
    margin:         number;
    trend:          number;
    article_number: string;
    stock:          number;
    marginAvailable: boolean;
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
            jtl_product_id: safeInt(p.jtl_product_id),
            rank:   i + 1,
            name:   String(p.name || 'Unknown'),
            cat:    String(p.category_name || 'Uncategorized'),
            rev:    curRev,
            units:  safeInt(p.total_units),
            margin: Math.round(safeFloat(p.margin_pct)),
            trend,
            article_number: String(p.article_number || ''),
            stock: safeFloat(p.stock_quantity ?? p.total_stock),
            marginAvailable: Number(p.list_price_net || 0) > 0 && Number(p.unit_cost || 0) > 0,
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
    sku?: string;
    model?: string;
    catalogStatus?: "all" | "active" | "inactive";
    salesStatus?: "all" | "with_sales" | "no_sales" | "with_stock" | "without_stock" | "stock_no_sales";
    minRevenue?: number;
    maxRevenue?: number;
    minStock?: number;
    maxStock?: number;
    productIds?: string;
    channels?: string;
    params?: URLSearchParams | string;
}

export function useProductsList(filters: ProductsListFilters = {}) {
    const { toParams } = useFilterStore();
    const params = new URLSearchParams(toParams());
    if (filters.params) {
        const override = new URLSearchParams(filters.params.toString());
        override.forEach((v, k) => params.set(k, v));
    }
    if (filters.page)   params.set('page',   String(filters.page));
    if (filters.limit)  params.set('limit',  String(filters.limit));
    if (filters.search) params.set('search', filters.search);
    if (filters.category) params.set('category', filters.category);
    if (filters.sort)   params.set('sort',   filters.sort);
    if (filters.order)  params.set('order',  filters.order);
    if (filters.sku) params.set('sku', filters.sku);
    if (filters.model) params.set('model', filters.model);
    if (filters.catalogStatus && filters.catalogStatus !== 'all') params.set('catalogStatus', filters.catalogStatus);
    if (filters.salesStatus && filters.salesStatus !== 'all') params.set('salesStatus', filters.salesStatus);
    if (filters.minRevenue != null) params.set('minRevenue', String(filters.minRevenue));
    if (filters.maxRevenue != null) params.set('maxRevenue', String(filters.maxRevenue));
    if (filters.minStock != null) params.set('minStock', String(filters.minStock));
    if (filters.maxStock != null) params.set('maxStock', String(filters.maxStock));
    if (filters.productIds) params.set('productIds', filters.productIds);
    if (filters.channels) params.set('channels', filters.channels);

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
        placeholderData: (previous) => previous,
        staleTime: 60_000,
    });
}

const CAT_COLORS = ['#38bdf8','#8b5cf6','#10b981','#f59e0b','#f43f5e','#06b6d4','#a78bfa','#fb923c'];

function transformCategories(rows: Record<string, unknown>[]) {
    if (!rows?.length) return [];
    const totalRev = rows.reduce((s, r) => s + safeFloat(r.total_revenue), 0);
    return rows.map((r, i) => ({
        name:         String(r.name || 'Other'),
        v:            totalRev > 0 ? Math.round(safeFloat(r.total_revenue) / totalRev * 100) : 0,
        revenue:      safeFloat(r.total_revenue),
        productCount: safeInt(r.product_count),
        c:            CAT_COLORS[i % CAT_COLORS.length],
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
        placeholderData: (previous) => previous,
        staleTime: 5 * 60_000,
    });
}

export function useProductsTop(limit = 10) {
    const { toParams } = useFilterStore();
    return useQuery({
        queryKey: ['products', 'top', limit, toParams().toString()],
        queryFn: async () => {
            const res = await api.get(`/products/top?${toParams()}&limit=${limit}`);
            return transformProductsList(res.data.data);
        },
        placeholderData: (previous) => previous,
        staleTime: 60_000,
    });
}

export interface ProductTrendPoint {
    year_month: string;
    revenue: number;
    units: number;
    orders: number;
}

export function useProductTrend(productId?: number, paramsOverride?: URLSearchParams | string) {
    const { toParams } = useFilterStore();
    const params = new URLSearchParams(toParams());
    if (paramsOverride) {
        const override = new URLSearchParams(paramsOverride.toString());
        override.forEach((v, k) => params.set(k, v));
    }
    if (productId) params.set('productId', String(productId));

    return useQuery({
        queryKey: ['products', 'trend', params.toString()],
        enabled: Boolean(productId),
        queryFn: async (): Promise<ProductTrendPoint[]> => {
            const res = await api.get(`/products/trend?${params}`);
            const rows = Array.isArray(res.data?.data) ? res.data.data : [];
            return rows.map((r: Record<string, unknown>) => ({
                year_month: String(r.year_month || ''),
                revenue: safeFloat(r.revenue),
                units: safeInt(r.units),
                orders: safeInt(r.orders),
            }));
        },
        placeholderData: [],
        staleTime: 0,
    });
}

export type ProductSearchResult = {
    id: number;
    jtl_product_id: number;
    article_number: string;
    name: string;
    ean: string;
    category_name: string;
    total_stock: number;
    available_stock: number;
    reserved_stock: number;
};

export async function searchProducts(query: string): Promise<ProductSearchResult[]> {
    const params = new URLSearchParams({ search: query });
    const res = await api.get(`/products/search?${params}`);
    const rows = Array.isArray(res.data?.data) ? res.data.data : [];
    return rows.map((row: Record<string, unknown>) => ({
        id: safeInt(row.id),
        jtl_product_id: safeInt(row.jtl_product_id),
        article_number: String(row.article_number || ''),
        name: String(row.name || 'Unknown'),
        ean: String(row.ean || ''),
        category_name: String(row.category_name || 'Uncategorized'),
        total_stock: safeFloat(row.total_stock),
        available_stock: safeFloat(row.available_stock),
        reserved_stock: safeFloat(row.reserved_stock),
    }));
}

export function useProductIntelligence(productId: number) {
    const { toParams } = useFilterStore();
    const params = toParams().toString();
    return useQuery({
        queryKey: ['products', 'intelligence', productId, params],
        enabled: productId > 0,
        queryFn: async () => {
            const res = await api.get(`/products/${productId}/intelligence?${params}`);
            return res.data?.data;
        },
        staleTime: 0,
    });
}
