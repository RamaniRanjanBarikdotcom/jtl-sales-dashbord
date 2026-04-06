"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useFilterStore } from "@/lib/store";

export interface InventoryKpis {
    totalValue:       number;
    lowStockCount:    number;
    outOfStock:       number;
    avgSellThrough:   number;
    warehouseFillPct: number;
}

const EMPTY_IKPIS: InventoryKpis = {
    totalValue:       0,
    lowStockCount:    0,
    outOfStock:       0,
    avgSellThrough:   0,
    warehouseFillPct: 0,
};

function transformInventoryKpis(d: any): InventoryKpis {
    const lowStock  = parseInt(d.low_stock_count) || 0;
    const outOfStock = parseInt(d.out_of_stock)   || 0;
    const totalSkus  = parseInt(d.total_skus)     || 0;
    const inStock    = totalSkus - outOfStock;
    return {
        totalValue:       parseFloat(d.total_inventory_value) || 0,
        lowStockCount:    lowStock,
        outOfStock,
        avgSellThrough:   totalSkus > 0 ? Math.round((inStock / totalSkus) * 100) : 0,
        warehouseFillPct: totalSkus > 0 ? Math.round((inStock / totalSkus) * 100) : 0,
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
        stock:      parseInt(r.total_available) || 0,
        status:     parseInt(r.total_available) === 0 ? 'out_of_stock' : 'low_stock',
        dsi:        Math.round(parseFloat(r.days_of_stock) || 0),
        reorderQty: 50,
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
            return res.data.data ?? [];
        },
        placeholderData: [],
        staleTime: 0,
    });
}

function transformMovements(rows: any[]) {
    if (!rows?.length) return { warehouses: [], dsi: [], daily: [] };
    const daily = rows.map((r: any, i: number) => ({
        d:   i + 1,
        ord: parseInt(r.units_sold) || 0,
        rev: parseInt(r.units_sold) || 0,
    }));
    return { warehouses: [], dsi: [], daily };
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
