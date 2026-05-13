"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useFilterStore } from "@/lib/store";
import { safeFloat, safeInt } from "@/lib/utils";

export interface InventoryKpis {
    totalValue:       number;
    lowStockCount:    number;
    outOfStock:       number;
    avgSellThrough:   number;
    warehouseFillPct: number;
    valueLabel:       string;   // "at cost" or "at list price"
}

const EMPTY_IKPIS: InventoryKpis = {
    totalValue:       0,
    lowStockCount:    0,
    outOfStock:       0,
    avgSellThrough:   0,
    warehouseFillPct: 0,
    valueLabel:       "at list price",
};

function transformInventoryKpis(d: any): InventoryKpis {
    const lowStock        = safeInt(d?.low_stock_count);
    const outOfStock      = safeInt(d?.out_of_stock);
    const totalSkus       = safeInt(d?.total_skus);
    const inStock         = totalSkus - outOfStock;
    const stockValue      = safeFloat(d?.total_inventory_value);
    const catalogValue    = safeFloat(d?.catalog_value);
    // When stock is all 0, fall back to showing catalog value (sum of list prices)
    const usesCatalog     = stockValue === 0 && catalogValue > 0;
    return {
        totalValue:       usesCatalog ? catalogValue : stockValue,
        lowStockCount:    lowStock,
        outOfStock,
        avgSellThrough:   totalSkus > 0 ? Math.round((inStock / totalSkus) * 100) : 0,
        warehouseFillPct: totalSkus > 0 ? Math.round((inStock / totalSkus) * 100) : 0,
        valueLabel:       usesCatalog ? "catalog (list price)" : d?.has_cost_data === true ? "at cost" : "at list price",
    };
}

export function useInventoryKpis() {
    return useQuery({
        queryKey: ['inventory', 'kpis'],
        queryFn: async (): Promise<InventoryKpis> => {
            const res = await api.get('/inventory/kpis');
            return transformInventoryKpis(res.data.data);
        },
        placeholderData: EMPTY_IKPIS,
        staleTime: 0,
    });
}

function transformAlerts(rows: any[]) {
    if (!rows?.length) return [];
    return rows.map((r: any) => ({
        product:    r.product_name || 'Unknown',
        warehouse:  r.article_number || '-',
        stock:      safeInt(r?.total_available),
        status:     safeInt(r?.total_available) === 0 ? 'out_of_stock' : 'low_stock',
        dsi:        Math.round(safeFloat(r?.days_of_stock)),
        reorderQty: Math.round(safeFloat(r?.reorder_point)),
    }));
}

export function useInventoryAlerts() {
    return useQuery({
        queryKey: ['inventory', 'alerts'],
        queryFn: async () => {
            const res = await api.get('/inventory/alerts');
            return transformAlerts(res.data.data);
        },
        placeholderData: [],
        staleTime: 0,
        refetchInterval: 5 * 60 * 1000,
    });
}

export interface InventoryAlertRow {
    product: string;
    warehouse: string;
    stock: number;
    status: string;
    dsi: number;
    reorderQty: number;
}

export interface InventoryAlertsPaged {
    rows: InventoryAlertRow[];
    total: number;
    page: number;
    limit: number;
}

export interface InventoryAlertsFilters {
    page?: number;
    limit?: number;
    search?: string;
    status?: "all" | "out_of_stock" | "low_stock";
}

export function useInventoryAlertsPaged(filters: InventoryAlertsFilters = {}) {
    const params = new URLSearchParams();
    if (filters.page) params.set("page", String(filters.page));
    if (filters.limit) params.set("limit", String(filters.limit));
    if (filters.search != null) params.set("search", String(filters.search));
    if (filters.status) params.set("status", filters.status);

    return useQuery({
        queryKey: ["inventory", "alerts-paged", params.toString()],
        queryFn: async (): Promise<InventoryAlertsPaged> => {
            const res = await api.get(`/inventory/alerts-paged?${params}`);
            const payload = res.data?.data ?? {};
            const rowsRaw = Array.isArray(payload.rows) ? payload.rows : [];
            return {
                rows: transformAlerts(rowsRaw) as InventoryAlertRow[],
                total: safeInt(payload.total),
                page: safeInt(payload.page) || (filters.page ?? 1),
                limit: safeInt(payload.limit) || (filters.limit ?? 50),
            };
        },
        placeholderData: { rows: [], total: 0, page: filters.page ?? 1, limit: filters.limit ?? 50 },
        staleTime: 0,
    });
}

export function useInventoryList() {
    const { toParams } = useFilterStore();
    return useQuery({
        queryKey: ['inventory', 'list', toParams().toString()],
        queryFn: async () => {
            const res = await api.get(`/inventory?${toParams()}`);
            const payload = res.data?.data;
            if (Array.isArray(payload)) return payload;
            return payload?.rows ?? [];
        },
        placeholderData: [],
        staleTime: 0,
    });
}

export interface InventoryListRow {
    id?: number | string;
    product_name?: string;
    article_number?: string;
    category_name?: string;
    total_available?: number;
    stock_quantity?: number;
    total_reserved?: number;
    is_low_stock?: boolean;
    unit_cost?: number;
    list_price_net?: number;
    list_price_gross?: number;
    ean?: string;
}

export interface InventoryListPaged {
    rows: InventoryListRow[];
    total: number;
    page: number;
    limit: number;
}

export interface InventoryListFilters {
    page?: number;
    limit?: number;
    search?: string;
    status?: "all" | "out_of_stock" | "low_stock" | "in_stock";
}

export function useInventoryListPaged(filters: InventoryListFilters = {}) {
    const { toParams } = useFilterStore();
    const params = new URLSearchParams(toParams());
    if (filters.page) params.set("page", String(filters.page));
    if (filters.limit) params.set("limit", String(filters.limit));
    if (filters.search != null) params.set("search", String(filters.search));
    if (filters.status) params.set("status", filters.status);

    return useQuery({
        queryKey: ["inventory", "list-paged", params.toString()],
        queryFn: async (): Promise<InventoryListPaged> => {
            const res = await api.get(`/inventory?${params}`);
            const payload = res.data?.data;
            if (Array.isArray(payload)) {
                return {
                    rows: payload as InventoryListRow[],
                    total: payload.length,
                    page: filters.page ?? 1,
                    limit: filters.limit ?? (payload.length || 50),
                };
            }
            return {
                rows: (payload?.rows ?? []) as InventoryListRow[],
                total: safeInt(payload?.total),
                page: safeInt(payload?.page) || (filters.page ?? 1),
                limit: safeInt(payload?.limit) || (filters.limit ?? 50),
            };
        },
        placeholderData: { rows: [], total: 0, page: 1, limit: filters.limit ?? 50 },
        staleTime: 0,
    });
}

function transformMovements(d: any) {
    if (!d) return { warehouses: [], dsi: [], daily: [] };
    // API returns { warehouses, dsi, daily } directly (not a plain array)
    const raw = Array.isArray(d) ? { warehouses: [], dsi: [], daily: d } : d;
    const daily = (raw.daily || []).map((r: any, i: number) => ({
        d:   r.d ?? (i + 1),
        ord: safeInt(r?.ord ?? r?.order_count),
        rev: safeFloat(r?.rev ?? r?.revenue),
    }));
    return {
        warehouses: raw.warehouses || [],
        dsi:        (raw.dsi || []).map((p: any) => ({
            name:           p.name || p.article_number || 'Unknown',
            dsi:            Math.min(safeInt(p?.dsi) || 999, 999),
            stock_quantity: safeInt(p?.stock_quantity),
            avg_daily:      safeFloat(p?.avg_daily_sales),
        })),
        dsi_page:   safeInt(raw.dsi_page) || 1,
        dsi_limit:  safeInt(raw.dsi_limit) || safeInt(raw?.dsi?.length) || 20,
        dsi_total:  safeInt(raw.dsi_total) || safeInt(raw?.dsi?.length),
        daily,
    };
}

export function useInventoryMovements() {
    const { toParams } = useFilterStore();
    return useQuery({
        queryKey: ['inventory', 'movements', toParams().toString()],
        queryFn: async () => {
            const res = await api.get(`/inventory/movements?${toParams()}`);
            return transformMovements(res.data.data);
        },
        placeholderData: { warehouses: [], dsi: [], daily: [] },
        staleTime: 0,
    });
}

export interface InventoryMovementsFilters {
    page?: number;
    limit?: number;
    search?: string;
    enabled?: boolean;
    refetchInterval?: number;
}

export function useInventoryMovementsPaged(filters: InventoryMovementsFilters = {}) {
    const { toParams } = useFilterStore();
    const params = new URLSearchParams(toParams());
    if (filters.page) params.set("page", String(filters.page));
    if (filters.limit) params.set("limit", String(filters.limit));
    if (filters.search != null) params.set("search", String(filters.search));
    return useQuery({
        queryKey: ['inventory', 'movements-paged', params.toString()],
        enabled: filters.enabled ?? true,
        queryFn: async () => {
            const res = await api.get(`/inventory/movements?${params}`);
            return transformMovements(res.data.data);
        },
        placeholderData: { warehouses: [], dsi: [], dsi_page: 1, dsi_limit: filters.limit ?? 20, dsi_total: 0, daily: [] },
        staleTime: 0,
        refetchInterval: filters.refetchInterval,
    });
}
