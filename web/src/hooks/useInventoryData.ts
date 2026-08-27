"use client";

import { useMutation } from "@tanstack/react-query";
import { useAuthedQuery as useQuery } from "@/lib/react-query-auth";
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

export interface InventoryStock {
    totalStock: number;
    availableStock: number;
    reservedStock: number;
}

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
        staleTime: 60_000,
    });
}

function transformAlerts(rows: any[]) {
    if (!rows?.length) return [];
    return rows.map((r: any) => ({
        product:    r.product_name || 'Unknown',
        sku:        r.article_number || '-',
        warehouse:  r.warehouse_names || 'Not assigned',
        category:   r.category_name || 'Uncategorized',
        channels:   r.sales_channels || '',
        stock:      safeInt(r?.total_available),
        status:     r.status || (safeInt(r?.total_available) === 0 ? 'out_of_stock' : 'low_stock'),
        dsi:        r?.days_of_stock == null ? null : Math.round(safeFloat(r.days_of_stock)),
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
        placeholderData: (previous) => previous,
        staleTime: 60_000,
        refetchInterval: 5 * 60 * 1000,
        refetchIntervalInBackground: false,
    });
}

export function useEmailInventoryAlerts() {
    return useMutation({
        mutationFn: async (): Promise<{ ok: boolean; skipped?: boolean; reason?: string; recipients?: number; alerts?: number }> => {
            const res = await api.post('/inventory/alerts/email');
            return res.data?.data ?? res.data;
        },
    });
}

export interface InventoryAlertRow {
    product: string;
    sku: string;
    warehouse: string;
    category: string;
    channels: string;
    stock: number;
    status: string;
    dsi: number | null;
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
    status?: "all" | "out_of_stock" | "low_stock" | "below_reorder_point" | "high_demand_low_stock" | "stockout_risk";
    category?: string;
    warehouse?: string;
    channel?: string;
}

export function useInventoryAlertsPaged(filters: InventoryAlertsFilters = {}) {
    const { toParams } = useFilterStore();
    const params = new URLSearchParams(toParams());
    if (filters.page) params.set("page", String(filters.page));
    if (filters.limit) params.set("limit", String(filters.limit));
    if (filters.search != null) params.set("search", String(filters.search));
    if (filters.status) params.set("status", filters.status);
    if (filters.category) params.set("category", filters.category);
    if (filters.warehouse) params.set("warehouse", filters.warehouse);
    if (filters.channel) params.set("channel", filters.channel);

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
        placeholderData: (previous) => previous,
        staleTime: 60_000,
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
        placeholderData: (previous) => previous,
        staleTime: 60_000,
    });
}

export interface InventoryListRow {
    id?: number | string;
    product_name?: string;
    article_number?: string;
    category_name?: string;
    total_available?: number;
    available_stock?: number;
    stock_quantity?: number;
    total_reserved?: number;
    is_low_stock?: boolean;
    unit_cost?: number;
    list_price_net?: number;
    list_price_gross?: number;
    ean?: string;
    warehouse_names?: string;
    stock?: number;
    revenue?: number;
    units?: number;
    orders?: number;
    customers?: number;
    sales_channels?: string;
    days_since_last_sale?: number | null;
    classification?: string;
    inventoryStock: InventoryStock;
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
    status?: "all" | "available" | "out_of_stock" | "low_stock" | "in_stock" | "high_stock";
    category?: string;
    warehouse?: string;
    minStock?: number;
    maxStock?: number;
    minAvailable?: number;
    maxAvailable?: number;
    minReserved?: number;
    maxReserved?: number;
    minRevenue?: number;
    maxRevenue?: number;
    performanceClass?: string;
    channels?: string;
    sort?: "total_stock" | "available_stock" | "reserved_stock" | "product_name" | "category" | "stock_value" | "revenue" | "units" | "days_since_sale";
    order?: "ASC" | "DESC";
}

export function normalizeInventoryRow(row: any): InventoryListRow {
    const totalStock = safeFloat(
        row?.total_available ?? row?.stock_quantity ?? row?.stock,
    );
    const availableStock = safeFloat(row?.available_stock);
    const reservedStock = safeFloat(row?.total_reserved);
    return {
        ...row,
        total_available: totalStock,
        stock_quantity: totalStock,
        available_stock: availableStock,
        total_reserved: reservedStock,
        stock: totalStock,
        inventoryStock: {
            totalStock,
            availableStock,
            reservedStock,
        },
    };
}

export function useInventoryListPaged(filters: InventoryListFilters = {}) {
    const { toParams } = useFilterStore();
    const params = new URLSearchParams(toParams());
    if (filters.page) params.set("page", String(filters.page));
    if (filters.limit) params.set("limit", String(filters.limit));
    if (filters.search != null) params.set("search", String(filters.search));
    if (filters.status) params.set("status", filters.status);
    if (filters.category) params.set("category", filters.category);
    if (filters.warehouse) params.set("warehouse", filters.warehouse);
    if (filters.minStock != null) params.set("minStock", String(filters.minStock));
    if (filters.maxStock != null) params.set("maxStock", String(filters.maxStock));
    if (filters.minAvailable != null) params.set("minAvailable", String(filters.minAvailable));
    if (filters.maxAvailable != null) params.set("maxAvailable", String(filters.maxAvailable));
    if (filters.minReserved != null) params.set("minReserved", String(filters.minReserved));
    if (filters.maxReserved != null) params.set("maxReserved", String(filters.maxReserved));
    if (filters.minRevenue != null) params.set("minRevenue", String(filters.minRevenue));
    if (filters.maxRevenue != null) params.set("maxRevenue", String(filters.maxRevenue));
    if (filters.performanceClass && filters.performanceClass !== "all") params.set("performanceClass", filters.performanceClass);
    if (filters.channels) params.set("channels", filters.channels);
    if (filters.sort) params.set("sort", filters.sort);
    if (filters.order) params.set("order", filters.order);

    return useQuery({
        queryKey: ["inventory", "list-paged", params.toString()],
        queryFn: async (): Promise<InventoryListPaged> => {
            const res = await api.get(`/inventory?${params}`);
            const payload = res.data?.data;
            if (Array.isArray(payload)) {
                return {
                    rows: payload.map(normalizeInventoryRow),
                    total: payload.length,
                    page: filters.page ?? 1,
                    limit: filters.limit ?? (payload.length || 50),
                };
            }
            return {
                rows: (payload?.rows ?? []).map(normalizeInventoryRow),
                total: safeInt(payload?.total),
                page: safeInt(payload?.page) || (filters.page ?? 1),
                limit: safeInt(payload?.limit) || (filters.limit ?? 50),
            };
        },
        placeholderData: { rows: [], total: 0, page: 1, limit: filters.limit ?? 50 },
        staleTime: 0,
    });
}

export interface InventoryCategoryRow {
    category_name: string;
    products: number;
    out_of_stock: number;
    total_stock: number;
    available_stock: number;
    reserved_stock: number;
    stock_value: number;
}

export function useInventoryCategories(page = 1, limit = 20, search = "") {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) params.set("search", search);
    return useQuery({
        queryKey: ["inventory", "categories", params.toString()],
        queryFn: async () => {
            const res = await api.get(`/inventory/categories?${params}`);
            const payload = res.data?.data ?? {};
            return {
                rows: (payload.rows ?? []).map((row: Record<string, unknown>) => ({
                    category_name: String(row.category_name || "Uncategorized"),
                    products: safeInt(row.products),
                    out_of_stock: safeInt(row.out_of_stock),
                    total_stock: safeFloat(row.total_stock),
                    available_stock: safeFloat(row.available_stock),
                    reserved_stock: safeFloat(row.reserved_stock),
                    stock_value: safeFloat(row.stock_value),
                })) as InventoryCategoryRow[],
                total: safeInt(payload.total),
                page: safeInt(payload.page) || page,
                limit: safeInt(payload.limit) || limit,
            };
        },
        placeholderData: { rows: [] as InventoryCategoryRow[], total: 0, page, limit },
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
            article_number: p.article_number || '',
            dsi:            p?.dsi == null ? null : safeInt(p.dsi),
            stock_quantity: safeInt(p?.stock_quantity),
            avg_daily:      safeFloat(p?.avg_daily_sales),
            category_name:  p.category_name || 'Uncategorized',
            warehouse_names: p.warehouse_names || 'Not assigned',
            classification: p.classification || 'no_demand',
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
    category?: string;
    warehouse?: string;
    channel?: string;
    performanceClass?: string;
    minDaysOfStock?: number;
    maxDaysOfStock?: number;
    enabled?: boolean;
    refetchInterval?: number;
}

export function useInventoryMovementsPaged(filters: InventoryMovementsFilters = {}) {
    const { toParams } = useFilterStore();
    const params = new URLSearchParams(toParams());
    if (filters.page) params.set("page", String(filters.page));
    if (filters.limit) params.set("limit", String(filters.limit));
    if (filters.search != null) params.set("search", String(filters.search));
    if (filters.category) params.set("category", filters.category);
    if (filters.warehouse) params.set("warehouse", filters.warehouse);
    if (filters.channel) params.set("channel", filters.channel);
    if (filters.performanceClass && filters.performanceClass !== "all") params.set("performanceClass", filters.performanceClass);
    if (filters.minDaysOfStock != null) params.set("minDaysOfStock", String(filters.minDaysOfStock));
    if (filters.maxDaysOfStock != null) params.set("maxDaysOfStock", String(filters.maxDaysOfStock));
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
