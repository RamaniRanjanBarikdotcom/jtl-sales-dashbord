"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { safeFloat, safeInt } from "@/lib/utils";
import { useFilterStore } from "@/lib/store";

export interface CustomerKpis {
    totalCustomers: number;
    newThisPeriod:  number;
    avgLtv:         number;
    avgOrders:      number;
    deltaNew:       number | null;
}

export interface CustomerSegment {
    name:      string;
    count:     number;
    avg_ltv:   number;
    total_ltv: number;
}

interface RawCustomerSegment {
    name?: string;
    count?: string | number;
    avg_ltv?: string | number;
    total_ltv?: string | number;
}

interface RawCustomerMonthly {
    month?: string;
    new_customers?: string | number;
    avg_ltv?: string | number;
}

export interface CustomerMonthly {
    month: string;
    newCust: number;
    avgLtv: number;
}

export interface CustomerRow {
    id?: number | string;
    first_name?: string;
    last_name?: string;
    email?: string;
    company?: string;
    region?: string;
    country_code?: string;
    total_orders?: number;
    ltv?: number;
    segment?: string;
    last_order_date?: string;
}

export function useCustomersKpis() {
    const toParams = useFilterStore(s => s.toParams);
    const params = toParams().toString();
    return useQuery({
        queryKey: ['customers', 'kpis', params],
        queryFn: async (): Promise<CustomerKpis> => {
            const res = await api.get(`/customers/kpis?${params}`);
            const d = res.data.data;
            return {
                totalCustomers: safeInt(d?.total_customers),
                newThisPeriod:  safeInt(d?.new_this_period),
                avgLtv:         safeFloat(d?.avg_ltv),
                avgOrders:      safeFloat(d?.avg_orders),
                deltaNew:       d?.delta_new != null ? Number(d.delta_new) : null,
            };
        },
        placeholderData: { totalCustomers: 0, newThisPeriod: 0, avgLtv: 0, avgOrders: 0, deltaNew: null },
        staleTime: 0,
    });
}

export function useCustomersSegments() {
    return useQuery({
        queryKey: ['customers', 'segments'],
        queryFn: async (): Promise<CustomerSegment[]> => {
            const res = await api.get('/customers/segments');
            const rows = (res.data.data || []) as RawCustomerSegment[];
            return rows.map((s) => ({
                name:      s.name || "Unknown",
                count:     safeInt(s?.count),
                avg_ltv:   safeFloat(s?.avg_ltv),
                total_ltv: safeFloat(s?.total_ltv),
            }));
        },
        placeholderData: [],
        staleTime: 0,
    });
}

export function useCustomersMonthly() {
    const toParams = useFilterStore(s => s.toParams);
    const params = toParams().toString();
    return useQuery({
        queryKey: ['customers', 'monthly', params],
        queryFn: async (): Promise<CustomerMonthly[]> => {
            const res = await api.get(`/customers/monthly?${params}`);
            const rows = (res.data.data || []) as RawCustomerMonthly[];
            return rows.map((r) => ({
                month:   r.month || "",
                newCust: safeInt(r?.new_customers),
                avgLtv:  safeFloat(r?.avg_ltv),
            }));
        },
        placeholderData: [],
        staleTime: 0,
    });
}

export interface CustomersListResponse {
    rows:  CustomerRow[];
    total: number;
    page:  number;
    limit: number;
}

export function useCustomersList(filters: { page?: number; limit?: number; search?: string; segment?: string }) {
    return useQuery({
        queryKey: ['customers', 'list', filters],
        queryFn: async (): Promise<CustomersListResponse> => {
            const params = new URLSearchParams();
            if (filters.page)    params.set('page',    String(filters.page));
            if (filters.limit)   params.set('limit',   String(filters.limit ?? 50));
            if (filters.search)  params.set('search',  filters.search);
            if (filters.segment) params.set('segment', filters.segment);
            const res = await api.get(`/customers?${params}`);
            const d = res.data;
            // Support both paginated envelope and raw array
            if (Array.isArray(d.data)) {
                return { rows: d.data as CustomerRow[], total: d.total ?? d.data.length, page: filters.page ?? 1, limit: filters.limit ?? 50 };
            }
            return {
                rows:  (d.data?.rows  ?? d.rows  ?? []) as CustomerRow[],
                total: d.data?.total ?? d.total ?? 0,
                page:  d.data?.page  ?? d.page  ?? (filters.page ?? 1),
                limit: d.data?.limit ?? d.limit ?? (filters.limit ?? 50),
            };
        },
        placeholderData: { rows: [], total: 0, page: 1, limit: 50 },
        staleTime: 0,
    });
}
