"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { useFilterStore } from "@/lib/store";
import { safeFloat, safeInt } from "@/lib/utils";

// ── KPI summary ────────────────────────────────────────────────────────────────
export interface SalesKpis {
    totalRevenue:      number;
    totalOrders:       number;
    avgOrderValue:     number;
    avgMargin:         number;
    revenueTarget:     number | null;
    targetPct:         number | null;
    returnRate:        number;
    cancelledOrders:   number;
    cancelledRevenue:  number;
    returnedOrders:    number;
    returnedRevenue:   number;
    // period-over-period deltas (null = no prev data)
    revenueDelta:      number | null;
    ordersDelta:       number | null;
    aovDelta:          number | null;
    marginDelta:       number | null;
}

function transformKpis(d: Record<string, unknown>): SalesKpis {
    const revenue      = safeFloat(d.total_revenue);
    const revDeltaPct  = d.revenue_delta != null ? safeFloat(d.revenue_delta) : null;
    const prevRevenue  = revDeltaPct != null && (1 + revDeltaPct / 100) !== 0
        ? revenue / (1 + revDeltaPct / 100)
        : 0;
    const target       = prevRevenue > 0 ? prevRevenue : null;
    const targetPct    = target !== null && target > 0 ? Math.round(revenue / target * 1000) / 10 : null;
    return {
        totalRevenue:      Math.round(revenue * 100) / 100,
        totalOrders:       safeInt(d.total_orders),
        avgOrderValue:     Math.round(safeFloat(d.avg_order_value) * 100) / 100,
        avgMargin:         Math.round(safeFloat(d.avg_margin) * 100) / 100,
        revenueTarget:     target !== null ? Math.round(target * 100) / 100 : null,
        targetPct,
        returnRate:        Math.round(safeFloat(d.return_rate) * 100) / 100,
        cancelledOrders:   safeInt(d.cancelled_orders),
        cancelledRevenue:  Math.round(safeFloat(d.cancelled_revenue) * 100) / 100,
        returnedOrders:    safeInt(d.returned_orders),
        returnedRevenue:   Math.round(safeFloat(d.returned_revenue) * 100) / 100,
        revenueDelta:      revDeltaPct,
        ordersDelta:       d.orders_delta  != null ? safeFloat(d.orders_delta)  : null,
        aovDelta:          d.aov_delta     != null ? safeFloat(d.aov_delta)     : null,
        marginDelta:       d.margin_delta  != null ? safeFloat(d.margin_delta)  : null,
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
    staleTime: 0,
  });
}

export interface SalesKpiFilters {
    from?: string;
    to?: string;
}

export function useSalesKpisWithFilters(filters: SalesKpiFilters = {}) {
    const { toParams } = useFilterStore();
    const params = new URLSearchParams(toParams());

    if (filters.from) {
        params.set('from', filters.from);
    } else {
        params.delete('from');
    }
    if (filters.to) {
        params.set('to', filters.to);
    } else {
        params.delete('to');
    }
    if (filters.from || filters.to) {
        params.delete('range');
    }

  return useQuery({
    queryKey: ['sales', 'kpis', 'drawer', params.toString()],
    queryFn: async (): Promise<SalesKpis> => {
      const res = await api.get(`/sales/kpis?${params}`);
      return transformKpis(res.data.data);
    },
    staleTime: 0,
  });
}

// ── Monthly revenue ────────────────────────────────────────────────────────────
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function transformRevenue(rows: Record<string, unknown>[]) {
    if (!rows?.length) return [];
    return rows.map((r) => {
        const revenue  = safeFloat(r.total_revenue);
        const prevYear = r.prev_year_revenue != null ? safeFloat(r.prev_year_revenue) : null;
        return {
            month:   MONTH_NAMES[new Date(String(r.year_month)).getUTCMonth()],
            revenue,
            orders:  safeInt(r.total_orders),
            target:  prevYear !== null ? Math.round(prevYear) : null,
            margin:  safeFloat(r.avg_margin),
            returns: safeInt(r.total_returns),
            newCust: safeInt(r.unique_customers),
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
    staleTime: 0,
  });
}

// ── Daily revenue ──────────────────────────────────────────────────────────────
function transformDaily(rows: Record<string, unknown>[]) {
    if (!rows?.length) return [];
    return rows.map((r, i) => {
        const raw = r.summary_date ? String(r.summary_date).slice(0, 10) : null;
        const label = raw ? raw.slice(5).replace('-', '/') : `D${i + 1}`;
        return {
            d:                 i + 1,
            date:              label,
            rev:               safeFloat(r.total_revenue),
            ord:               safeInt(r.total_orders),
            returns:           safeInt(r.total_returns),
            cancelledOrders:   safeInt(r.cancelled_orders),
            cancelledRevenue:  safeFloat(r.cancelled_revenue),
        };
    });
}

export function useSalesDaily() {
    const { toParams } = useFilterStore();
    const params = toParams();
  return useQuery({
        queryKey: ['sales', 'daily', params.toString()],
        queryFn: async () => {
            const res = await api.get(`/sales/daily?${params}`);
            return transformDaily(res.data.data);
        },
    staleTime: 0,
  });
}

export interface SalesDailyFilters {
    from?: string;
    to?: string;
}

export function useSalesDailyWithFilters(filters: SalesDailyFilters = {}) {
    const { toParams } = useFilterStore();
    const params = new URLSearchParams(toParams());

    if (filters.from) {
        params.set('from', filters.from);
    } else {
        params.delete('from');
    }
    if (filters.to) {
        params.set('to', filters.to);
    } else {
        params.delete('to');
    }
    if (filters.from || filters.to) {
        params.delete('range');
    }

  return useQuery({
        queryKey: ['sales', 'daily', 'drawer', params.toString()],
        queryFn: async () => {
            const res = await api.get(`/sales/daily?${params}`);
            return transformDaily(res.data.data);
        },
    staleTime: 0,
  });
}

// ── Order heatmap ──────────────────────────────────────────────────────────────
const DAY_NAMES: Record<number, string> = { 0:'Sun', 1:'Mon', 2:'Tue', 3:'Wed', 4:'Thu', 5:'Fri', 6:'Sat' };
const DAY_ORDER = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function transformHeatmap(rows: Record<string, unknown>[]) {
  if (!rows?.length) return { days: DAY_ORDER, cells: [] };
  const lookup: Record<string, Record<number, { orders: number; revenue: number }>> = {};
  DAY_ORDER.forEach(d => { lookup[d] = {}; });
  rows.forEach((r) => {
    const day = DAY_NAMES[safeInt(r.day_of_week)];
    if (!day) return;
    const hour = safeInt(r.hour_of_day);
    if (hour < 0 || hour > 23) return;
    lookup[day][hour] = {
      orders: safeInt(r.order_count),
      revenue: safeFloat(r.total_revenue),
    };
  });
  const cells: Array<{ day: string; hour: number; orders: number; revenue: number }> = [];
  DAY_ORDER.forEach(day => {
    for (let h = 0; h < 24; h++) {
      cells.push({
        day,
        hour: h,
        orders: lookup[day][h]?.orders || 0,
        revenue: lookup[day][h]?.revenue || 0,
      });
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
    placeholderData: { days: DAY_ORDER, cells: [] as Array<{ day: string; hour: number; orders: number; revenue: number }> },
    staleTime: 0,
  });
}

// ── Channel breakdown ──────────────────────────────────────────────────────────
const CHANNEL_COLOR_MAP: Record<string, string> = {
    direct:       '#38bdf8',
    marketplace:  '#8b5cf6',
    email:        '#10b981',
    referral:     '#f59e0b',
    amazon:       '#f97316',
    ebay:         '#06b6d4',
    other:        '#94a3b8',
    unknown:      '#64748b',
    onlineshop:   '#38bdf8',
    shop:         '#38bdf8',
};
const FALLBACK_COLORS = ['#38bdf8','#8b5cf6','#10b981','#f59e0b','#f43f5e','#06b6d4'];

function transformChannels(rows: Record<string, unknown>[]) {
  if (!rows?.length) return { monthly: [], categories: [], radar: [] };
  const map = new Map<string, { revenue: number; orders: number }>();
  for (const r of rows) {
    const rawName = (String(r.channel || '').trim()) || 'Unknown';
    const key = rawName.toLowerCase();
    const prev = map.get(key) || { revenue: 0, orders: 0 };
    map.set(key, {
      revenue: prev.revenue + safeFloat(r.revenue),
      orders: prev.orders + safeInt(r.orders),
    });
  }

  const merged = Array.from(map.entries())
    .map(([name, values]) => ({
      name,
      displayName: name
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
        .replace('Ebay', 'eBay'),
      revenue: Math.round(values.revenue * 100) / 100,
      orders: values.orders,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const top = merged.slice(0, 7);
  const tail = merged.slice(7);
  if (tail.length > 0) {
    top.push({
      name: 'other',
      displayName: 'Other',
      revenue: Math.round(tail.reduce((s, r) => s + r.revenue, 0) * 100) / 100,
      orders: tail.reduce((s, r) => s + r.orders, 0),
    });
  }

  const totalRev = top.reduce((s, r) => s + r.revenue, 0);
  const categories = top.map((r, i) => ({
    name: r.displayName,
    v: totalRev > 0 ? Math.round((r.revenue / totalRev) * 1000) / 10 : 0,
    revenue: r.revenue,
    orders: r.orders,
    c: CHANNEL_COLOR_MAP[r.name.toLowerCase()] || FALLBACK_COLORS[i % FALLBACK_COLORS.length],
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
    rows:          OrderRow[];
    total:         number;
    total_revenue: number;
    avg_margin:    number;
    page:          number;
    limit:         number;
}

const EMPTY_ORDERS_RESPONSE: OrdersResponse = { rows: [], total: 0, total_revenue: 0, avg_margin: 0, page: 1, limit: 50 };

export interface OrderFilters {
    from?:        string;
    to?:          string;
    orderNumber?: string;
    sku?:         string;
    page?:        number;
    limit?:       number;
    statusOverride?: string;
    enabled?:     boolean;
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
    good_orders?: number;
    bad_orders?: number;
    good_rate_pct?: number;
    avg_order_value?: number;
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
    location_dimension: 'region' | 'city' | 'country';
    active_location: string | null;
    location_options: string[];
    location_insights: Array<{
        location: string;
        orders: number;
        good_orders: number;
        bad_orders: number;
        good_rate_pct: number;
        revenue: number;
        avg_order_value: number;
    }>;
    platform_mix: Array<{
        platform: string;
        orders: number;
        good_orders: number;
        bad_orders: number;
        good_rate_pct: number;
        revenue: number;
        avg_order_value: number;
        share_pct: number;
    }>;
    top_products: Array<{
        product_id: string;
        product_name: string;
        sku: string;
        quantity: number;
        orders: number;
        revenue: number;
    }>;
    least_products: Array<{
        product_id: string;
        product_name: string;
        sku: string;
        quantity: number;
        orders: number;
        revenue: number;
    }>;
    top_product_routes: Array<{
        platform: string;
        shipping_method: string;
        orders: number;
        quantity: number;
        revenue: number;
    }>;
    least_product_routes: Array<{
        platform: string;
        shipping_method: string;
        orders: number;
        quantity: number;
        revenue: number;
    }>;
}

const EMPTY_REGIONAL: RegionalData = {
    regions: [],
    cities: [],
    total_revenue: 0,
    location_dimension: 'region',
    active_location: null,
    location_options: [],
    location_insights: [],
    platform_mix: [],
    top_products: [],
    least_products: [],
    top_product_routes: [],
    least_product_routes: [],
};

export interface RegionalFilters {
    locationDimension?: 'region' | 'city' | 'country';
    location?: string;
}

export function useRegionalData(filters: RegionalFilters = {}, enabled = true) {
    const { toParams } = useFilterStore();
    const params = new URLSearchParams(toParams());
    if (filters.locationDimension) {
        params.set('locationDimension', filters.locationDimension);
    } else {
        params.delete('locationDimension');
    }
    if (filters.location && filters.location !== 'all') {
        params.set('location', filters.location);
    } else {
        params.delete('location');
    }
    return useQuery({
        queryKey: ['sales', 'regional', params.toString()],
        enabled,
        queryFn: async (): Promise<RegionalData> => {
            const res = await api.get(`/sales/regional?${params}`);
            const d = res.data.data ?? res.data;
            return {
                regions:       d.regions       ?? [],
                cities:        d.cities        ?? [],
                total_revenue: safeFloat(d?.total_revenue),
                location_dimension: (d.location_dimension ?? 'region') as 'region' | 'city' | 'country',
                active_location: d.active_location ?? null,
                location_options: Array.isArray(d.location_options) ? d.location_options : [],
                location_insights: Array.isArray(d.location_insights) ? d.location_insights : [],
                platform_mix: Array.isArray(d.platform_mix) ? d.platform_mix : [],
                top_products: Array.isArray(d.top_products) ? d.top_products : [],
                least_products: Array.isArray(d.least_products) ? d.least_products : [],
                top_product_routes: Array.isArray(d.top_product_routes) ? d.top_product_routes : [],
                least_product_routes: Array.isArray(d.least_product_routes) ? d.least_product_routes : [],
            };
        },
        placeholderData: EMPTY_REGIONAL,
        staleTime: 0,
    });
}

export function useSalesOrders(filters: OrderFilters) {
    const { toParams } = useFilterStore();
    const globalParams = toParams();
    const params = new URLSearchParams();

    // Drawer-specific date range overrides global; if none set, inherit global filter
    if (filters.from) {
        params.set('from', filters.from);
    } else if (globalParams.get('from')) {
        params.set('from', globalParams.get('from')!);
    }
    if (filters.to) {
        params.set('to', filters.to);
    } else if (globalParams.get('to')) {
        params.set('to', globalParams.get('to')!);
    }
    // If still no date range, fall through to global range param
    if (!params.get('from') && !params.get('to')) {
        params.set('range', globalParams.get('range') ?? 'ALL');
    }

    // Forward global status filter (can be overridden by drawer-local filters if needed)
    const statusOverride = (filters.statusOverride || '').trim();
    if (statusOverride) {
        params.set('status', statusOverride);
    } else {
        const globalStatus = globalParams.get('status');
        if (globalStatus) params.set('status', globalStatus);
    }
    const passthroughKeys = ['invoice', 'paymentMethod', 'channel', 'platform'] as const;
    for (const key of passthroughKeys) {
        const value = globalParams.get(key);
        if (value) params.set(key, value);
    }

    if (filters.orderNumber) params.set('orderNumber', filters.orderNumber);
    if (filters.sku)         params.set('sku',         filters.sku);
    params.set('page',  String(filters.page  ?? 1));
    params.set('limit', String(filters.limit ?? 50));

    return useQuery({
        queryKey: ['sales', 'orders', params.toString()],
        enabled: filters.enabled ?? true,
        queryFn: async (): Promise<OrdersResponse> => {
            const res = await api.get(`/sales/orders?${params}`);
            const envelope = res.data ?? {};
            const l1 = envelope.data ?? envelope;
            const l2 = l1.data ?? l1; // supports controllers that return { data: ... }

            const rows = (l2.rows ?? l1.rows ?? envelope.rows ?? []) as OrderRow[];
            const total = Number(l2.total ?? l1.total ?? envelope.total ?? rows.length ?? 0);

            const rawRevenue =
                l2.total_revenue ?? l2.totalRevenue ??
                l1.total_revenue ?? l1.totalRevenue ??
                envelope.total_revenue ?? envelope.totalRevenue;
            const rawAvgMargin =
                l2.avg_margin ?? l2.avgMargin ??
                l1.avg_margin ?? l1.avgMargin ??
                envelope.avg_margin ?? envelope.avgMargin;

            const revenueFromRows = rows.reduce(
                (sum, r) => sum + safeFloat((r as any).gross_revenue ?? (r as any).net_revenue),
                0,
            );
            const marginRows = rows
                .map((r) => safeFloat((r as any).gross_margin))
                .filter((v) => Number.isFinite(v));
            const avgMarginFromRows = marginRows.length
                ? marginRows.reduce((a, b) => a + b, 0) / marginRows.length
                : 0;

            return {
                rows,
                total,
                total_revenue: safeFloat(rawRevenue) || revenueFromRows,
                avg_margin:    safeFloat(rawAvgMargin) || avgMarginFromRows,
                page:          Number(l2.page ?? l1.page ?? envelope.page ?? 1),
                limit:         Number(l2.limit ?? l1.limit ?? envelope.limit ?? 50),
            };
        },
        staleTime: 0,
        placeholderData: (prev) => prev ?? EMPTY_ORDERS_RESPONSE,
    });
}

// ── Payment & Shipping breakdown ───────────────────────────────────────────────
export interface PayShipItem {
    label:    string;
    orders:   number;
    revenue:  number;
    share_pct: number;
}

export interface ShippingItem extends PayShipItem {
    avg_shipping_cost: number;
    total_shipping_cost: number;
}

export interface PaymentShippingData {
    payment_methods:  PayShipItem[];
    shipping_methods: ShippingItem[];
}

export interface PaymentMethodOption {
    label: string;
    count: number;
}

export function useSalesPaymentMethodOptions(enabled = true) {
    const { toParams } = useFilterStore();
    const params = new URLSearchParams(toParams());
    // Keep options broad for the current period/status/invoice, regardless of selected payment method.
    params.delete('paymentMethod');
    return useQuery({
        queryKey: ['sales', 'payment-method-options', params.toString()],
        queryFn: async (): Promise<PaymentMethodOption[]> => {
            const res = await api.get(`/sales/filters/payment-methods?${params}`);
            const rows = (res.data?.data ?? res.data ?? []) as Array<Record<string, unknown>>;
            return rows.map((r) => ({
                label: String(r.label ?? '').trim() || 'Unknown',
                count: safeInt(r.count),
            }));
        },
        enabled,
        placeholderData: [] as PaymentMethodOption[],
        staleTime: 300_000,
    });
}

export function useSalesPlatformOptions(enabled = true) {
    const { toParams } = useFilterStore();
    const params = new URLSearchParams(toParams());
    // Keep options broad for the current period/status/invoice/channel/payment method, regardless of selected platform.
    params.delete('platform');
    return useQuery({
        queryKey: ['sales', 'platform-options', params.toString()],
        queryFn: async (): Promise<PaymentMethodOption[]> => {
            const res = await api.get(`/sales/filters/platforms?${params}`);
            const rows = (res.data?.data ?? res.data ?? []) as Array<Record<string, unknown>>;
            return rows.map((r) => ({
                label: String(r.label ?? '').trim() || 'Unknown',
                count: safeInt(r.count),
            }));
        },
        enabled,
        placeholderData: [] as PaymentMethodOption[],
        staleTime: 300_000,
    });
}

export function useSalesChannelOptions(enabled = true) {
    const { toParams } = useFilterStore();
    const params = new URLSearchParams(toParams());
    // Keep options broad for the current period/status/invoice/payment method, regardless of selected channel.
    params.delete('channel');
    return useQuery({
        queryKey: ['sales', 'channel-options', params.toString()],
        queryFn: async (): Promise<PaymentMethodOption[]> => {
            const res = await api.get(`/sales/filters/channels?${params}`);
            const rows = (res.data?.data ?? res.data ?? []) as Array<Record<string, unknown>>;
            return rows.map((r) => ({
                label: String(r.label ?? '').trim() || 'Unknown',
                count: safeInt(r.count),
            }));
        },
        enabled,
        placeholderData: [] as PaymentMethodOption[],
        staleTime: 300_000,
    });
}

export function useSalesPaymentShipping() {
    const { toParams } = useFilterStore();
    return useQuery({
        queryKey: ['sales', 'payment-shipping', toParams().toString()],
        queryFn: async (): Promise<PaymentShippingData> => {
            const res = await api.get(`/sales/payment-shipping?${toParams()}`);
            const d = res.data?.data ?? res.data ?? {};
            return {
                payment_methods:  Array.isArray(d.payment_methods)  ? d.payment_methods  : [],
                shipping_methods: Array.isArray(d.shipping_methods) ? d.shipping_methods : [],
            };
        },
        placeholderData: { payment_methods: [], shipping_methods: [] },
        staleTime: 300_000,
    });
}
