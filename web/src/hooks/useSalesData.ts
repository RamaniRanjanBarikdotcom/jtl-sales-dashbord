"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useFilterStore } from "@/lib/store";

// ── KPI summary ────────────────────────────────────────────────────────────────
export interface SalesKpis {
    totalRevenue:  number;
    totalOrders:   number;
    avgOrderValue: number;
    avgMargin:     number;
    revenueTarget: number;
    targetPct:     number;
    returnRate:    number;
}

const EMPTY_KPIS: SalesKpis = {
    totalRevenue:  0,
    totalOrders:   0,
    avgOrderValue: 0,
    avgMargin:     0,
    revenueTarget: 0,
    targetPct:     0,
    returnRate:    0,
};

function transformKpis(d: any): SalesKpis {
    const revenue = parseFloat(d.total_revenue) || 0;
    const target  = revenue * 1.1 || 0;
    return {
        totalRevenue:  revenue,
        totalOrders:   parseInt(d.total_orders) || 0,
        avgOrderValue: parseFloat(d.avg_order_value) || 0,
        avgMargin:     parseFloat(d.avg_margin) || 0,
        revenueTarget: target,
        targetPct:     target > 0 ? Math.round(revenue / target * 1000) / 10 : 0,
        returnRate:    parseFloat(d.return_rate) || 0,
    };
}

export function useSalesKpis() {
    const { toParams } = useFilterStore();
    return useQuery({
        queryKey: ['sales', 'kpis', toParams().toString()],
        queryFn: async (): Promise<SalesKpis> => {
            const res = await api.get(`/sales/kpis?${toParams()}`);
            return transformKpis(res.data.data);
        },
        placeholderData: EMPTY_KPIS,
        staleTime: 0,
    });
}

// ── Monthly revenue ────────────────────────────────────────────────────────────
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function transformRevenue(rows: any[]) {
    if (!rows?.length) return [];
    return rows.map((r: any) => {
        const revenue = parseFloat(r.total_revenue) || 0;
        return {
            month:   MONTH_NAMES[new Date(r.year_month).getUTCMonth()],
            revenue,
            orders:  parseInt(r.total_orders) || 0,
            target:  Math.round(revenue * 1.1),
            margin:  parseFloat(r.avg_margin) || 0,
            returns: 0,
            newCust: 0,
        };
    });
}

export function useSalesRevenue() {
    const { toParams } = useFilterStore();
    return useQuery({
        queryKey: ['sales', 'revenue', toParams().toString()],
        queryFn: async () => {
            const res = await api.get(`/sales/revenue?${toParams()}`);
            return transformRevenue(res.data.data);
        },
        placeholderData: [],
        staleTime: 0,
    });
}

// ── Daily revenue ──────────────────────────────────────────────────────────────
function transformDaily(rows: any[]) {
    if (!rows?.length) return [];
    return rows.map((r: any, i: number) => ({
        d:   i + 1,
        rev: parseFloat(r.total_revenue) || 0,
        ord: parseInt(r.total_orders)    || 0,
    }));
}

export function useSalesDaily() {
    const { toParams } = useFilterStore();
    return useQuery({
        queryKey: ['sales', 'daily', toParams().toString()],
        queryFn: async () => {
            const res = await api.get(`/sales/daily?${toParams()}`);
            return transformDaily(res.data.data);
        },
        placeholderData: [],
        staleTime: 0,
    });
}

// ── Order heatmap ──────────────────────────────────────────────────────────────
const DAY_NAMES: Record<number, string> = { 0:'Sun', 1:'Mon', 2:'Tue', 3:'Wed', 4:'Thu', 5:'Fri', 6:'Sat' };
const DAY_ORDER = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function transformHeatmap(rows: any[]) {
    if (!rows?.length) return { days: DAY_ORDER, cells: [] };
    const lookup: Record<string, Record<number, number>> = {};
    DAY_ORDER.forEach(d => { lookup[d] = {}; });
    rows.forEach((r: any) => {
        const day = DAY_NAMES[parseInt(r.day_of_week)];
        if (day) lookup[day][parseInt(r.hour_of_day)] = parseInt(r.order_count) || 0;
    });
    const cells: Array<{ day: string; v: number }> = [];
    DAY_ORDER.forEach(day => {
        for (let h = 0; h < 24; h++) {
            cells.push({ day, v: lookup[day][h] || 0 });
        }
    });
    return { days: DAY_ORDER, cells };
}

export function useSalesHeatmap() {
    const { toParams } = useFilterStore();
    return useQuery({
        queryKey: ['sales', 'heatmap', toParams().toString()],
        queryFn: async () => {
            const res = await api.get(`/sales/heatmap?${toParams()}`);
            return transformHeatmap(res.data.data);
        },
        placeholderData: { days: DAY_ORDER, cells: [] },
        staleTime: 0,
    });
}

// ── Channel breakdown ──────────────────────────────────────────────────────────
const CHANNEL_COLOR_MAP: Record<string, string> = {
    direct:       '#38bdf8',
    marketplace:  '#8b5cf6',
    email:        '#10b981',
    referral:     '#f59e0b',
    onlineshop:   '#38bdf8',
    shop:         '#38bdf8',
    amazon:       '#8b5cf6',
    ebay:         '#06b6d4',
};
const FALLBACK_COLORS = ['#38bdf8','#8b5cf6','#10b981','#f59e0b','#f43f5e','#06b6d4'];

function transformChannels(rows: any[]) {
    if (!rows?.length) return { monthly: [], categories: [], radar: [] };
    const totalRev = rows.reduce((s: number, r: any) => s + (parseFloat(r.revenue) || 0), 0);
    const categories = rows.map((r: any, i: number) => ({
        name: r.channel || 'Other',
        v:    totalRev > 0 ? Math.round((parseFloat(r.revenue) || 0) / totalRev * 100) : 0,
        c:    CHANNEL_COLOR_MAP[r.channel?.toLowerCase()] || FALLBACK_COLORS[i % FALLBACK_COLORS.length],
    }));
    return { monthly: [], categories, radar: [] };
}

export function useSalesChannels() {
    const { toParams } = useFilterStore();
    return useQuery({
        queryKey: ['sales', 'channels', toParams().toString()],
        queryFn: async () => {
            const res = await api.get(`/sales/channels?${toParams()}`);
            return transformChannels(res.data.data);
        },
        placeholderData: { monthly: [], categories: [], radar: [] },
        staleTime: 0,
    });
}

// ── Order detail list ───────────────────────────────────────────────────────────
export interface OrderRow {
    order_number:          string;
    order_date:            string;
    gross_revenue:         number;
    net_revenue:           number;
    status:                string;
    channel:               string;
    item_count:            number;
    region:                string;
    postcode:              string | null;
    city:                  string | null;
    country:               string | null;
    gross_margin:          number;
    shipping_cost:         number | null;
    external_order_number: string | null;
    customer_number:       string | null;
    payment_method:        string | null;
    shipping_method:       string | null;
}

export interface OrdersResponse {
    rows:  OrderRow[];
    total: number;
    page:  number;
    limit: number;
}

const EMPTY_ORDERS_RESPONSE: OrdersResponse = { rows: [], total: 0, page: 1, limit: 50 };

export interface OrderFilters {
    from?:        string;
    to?:          string;
    orderNumber?: string;
    sku?:         string;
    page?:        number;
    limit?:       number;
}

// ── Regional breakdown ─────────────────────────────────────────────────────────
export interface RegionRow {
    name:       string;
    revenue:    number;
    orders:     number;
    customers:  number;
    py_revenue: number;
    py_orders:  number;
    growth_pct: number | null;
    share_pct:  number;
}

export interface CityRow {
    city:    string;
    country: string;
    orders:  number;
    revenue: number;
}

export interface RegionalData {
    regions:       RegionRow[];
    cities:        CityRow[];
    total_revenue: number;
}

const EMPTY_REGIONAL: RegionalData = { regions: [], cities: [], total_revenue: 0 };

export function useRegionalData() {
    const { toParams } = useFilterStore();
    return useQuery({
        queryKey: ['sales', 'regional', toParams().toString()],
        queryFn: async (): Promise<RegionalData> => {
            const res = await api.get(`/sales/regional?${toParams()}`);
            const d = res.data.data ?? res.data;
            return {
                regions:       d.regions       ?? [],
                cities:        d.cities        ?? [],
                total_revenue: parseFloat(d.total_revenue) || 0,
            };
        },
        placeholderData: EMPTY_REGIONAL,
        staleTime: 0,
    });
}

export function useSalesOrders(filters: OrderFilters) {
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to)   params.set('to',   filters.to);
    if (!filters.from && !filters.to) params.set('range', '12M');
    if (filters.orderNumber) params.set('orderNumber', filters.orderNumber);
    if (filters.sku)         params.set('sku',         filters.sku);
    params.set('page',  String(filters.page  ?? 1));
    params.set('limit', String(filters.limit ?? 50));

    return useQuery({
        queryKey: ['sales', 'orders', params.toString()],
        queryFn: async (): Promise<OrdersResponse> => {
            const res = await api.get(`/sales/orders?${params}`);
            const d = res.data;
            return {
                rows:  d.rows  ?? d.data?.rows  ?? [],
                total: d.total ?? d.data?.total ?? 0,
                page:  d.page  ?? 1,
                limit: d.limit ?? 50,
            };
        },
        placeholderData: EMPTY_ORDERS_RESPONSE,
        staleTime: 0,
    });
}
