"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

export interface CustomerKpis {
    totalCustomers: number;
    newThisMonth:   number;
    avgLtv:         number;
    avgOrders:      number;
}

export interface CustomerSegment {
    name:      string;
    count:     number;
    avg_ltv:   number;
    total_ltv: number;
}

const SEGMENT_COLORS: Record<string, string> = {
    VIP: "#f59e0b", Regular: "#38bdf8", Casual: "#8b5cf6",
    "At-Risk": "#f43f5e", New: "#10b981", Churned: "#22d3ee", Unknown: "#64748b",
};

export function useCustomersKpis() {
    return useQuery({
        queryKey: ['customers', 'kpis'],
        queryFn: async (): Promise<CustomerKpis> => {
            const res = await api.get('/customers/kpis');
            const d = res.data.data;
            return {
                totalCustomers: parseInt(d.total_customers) || 0,
                newThisMonth:   parseInt(d.new_this_month)  || 0,
                avgLtv:         parseFloat(d.avg_ltv)        || 0,
                avgOrders:      parseFloat(d.avg_orders)     || 0,
            };
        },
        placeholderData: { totalCustomers: 0, newThisMonth: 0, avgLtv: 0, avgOrders: 0 },
        staleTime: 5 * 60 * 1000,
    });
}

export function useCustomersSegments() {
    return useQuery({
        queryKey: ['customers', 'segments'],
        queryFn: async (): Promise<CustomerSegment[]> => {
            const res = await api.get('/customers/segments');
            return (res.data.data || []).map((s: any) => ({
                name:      s.name,
                count:     parseInt(s.count) || 0,
                avg_ltv:   parseFloat(s.avg_ltv) || 0,
                total_ltv: parseFloat(s.total_ltv) || 0,
                c:         SEGMENT_COLORS[s.name] || "#64748b",
            }));
        },
        placeholderData: [],
        staleTime: 5 * 60 * 1000,
    });
}

export function useCustomersMonthly() {
    return useQuery({
        queryKey: ['customers', 'monthly'],
        queryFn: async () => {
            const res = await api.get('/customers/monthly');
            return (res.data.data || []).map((r: any) => ({
                month:   r.month,
                newCust: parseInt(r.new_customers) || 0,
                avgLtv:  parseFloat(r.avg_ltv) || 0,
            }));
        },
        placeholderData: [],
        staleTime: 10 * 60 * 1000,
    });
}

export interface CustomersListResponse {
    rows:  any[];
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
                return { rows: d.data, total: d.total ?? d.data.length, page: filters.page ?? 1, limit: filters.limit ?? 50 };
            }
            return {
                rows:  d.data?.rows  ?? d.rows  ?? [],
                total: d.data?.total ?? d.total ?? 0,
                page:  d.data?.page  ?? d.page  ?? (filters.page ?? 1),
                limit: d.data?.limit ?? d.limit ?? (filters.limit ?? 50),
            };
        },
        placeholderData: { rows: [], total: 0, page: 1, limit: 50 },
        staleTime: 5 * 60 * 1000,
    });
}
