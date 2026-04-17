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
    const lowStock   = safeInt(d?.low_stock_count);
    const outOfStock = safeInt(d?.out_of_stock);
    const totalSkus  = safeInt(d?.total_skus);
    const inStock    = totalSkus - outOfStock;
    return {
        totalValue:       Math.round(safeFloat(d?.total_inventory_value)),
        lowStockCount:    lowStock,
        outOfStock,
        avgSellThrough:   totalSkus > 0 ? Math.round((inStock / totalSkus) * 100) : 0,
        warehouseFillPct: totalSkus > 0 ? Math.round((inStock / totalSkus) * 100) : 0,
        valueLabel:       d?.has_cost_data === true ? "at cost" : "at list price",
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
