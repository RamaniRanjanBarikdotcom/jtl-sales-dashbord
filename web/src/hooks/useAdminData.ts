/**
 * TanStack Query hooks for the Admin module.
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface AdminUser {
    id:           string;
    email:        string;
    full_name:    string;
    role:         "admin" | "user";
    user_level:   "viewer" | "analyst" | "manager" | null;
    dept:         string;
    is_active:    boolean;
    must_change_pwd: boolean;
    last_login_at: string | null;
    created_at:   string;
}

export interface AdminTenant {
    id:              string;
    name:            string;
    slug:            string;
    is_active:       boolean;
    timezone:        string;
    currency:        string;
    vat_rate:        number;
    user_count:      number;
    last_sync:       string | null;
    created_at:      string;
    sync_key_prefix: string | null;
}

export interface PlatformOverview {
    totalTenants:   number;
    activeTenants:  number;
    totalUsers:     number;
    syncsToday:     number;
}

// ── User hooks ────────────────────────────────────────────────────────────────
export function useAdminUsers() {
    return useQuery({
        queryKey: ['admin', 'users'],
        queryFn: async (): Promise<AdminUser[]> => {
            const res = await api.get('/admin/users');
            return res.data.data ?? [];
        },
        placeholderData: [],
    });
}

export interface CreateUserDto {
    email:      string;
    full_name:  string;
    role:       "user";
    user_level: "viewer" | "analyst" | "manager";
    dept:       string;
}

export function useCreateUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (dto: CreateUserDto): Promise<void> => {
            await api.post('/admin/users', dto);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
    });
}

export interface UpdateUserDto {
    full_name?:  string;
    user_level?: "viewer" | "analyst" | "manager";
    dept?:       string;
    is_active?:  boolean;
}

export function useUpdateUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, dto }: { id: string; dto: UpdateUserDto }): Promise<void> => {
            await api.patch(`/admin/users/${id}`, dto);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
    });
}

export function useDeactivateUser() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string): Promise<void> => {
            await api.patch(`/admin/users/${id}/deactivate`);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
    });
}

export function useResetUserPwd() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string): Promise<void> => {
            await api.post(`/admin/users/${id}/reset-pwd`);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
    });
}

// ── Tenant hooks (super_admin only) ──────────────────────────────────────────
export function useAdminTenants() {
    return useQuery({
        queryKey: ['admin', 'tenants'],
        queryFn: async (): Promise<AdminTenant[]> => {
            const res = await api.get('/admin/tenants');
            return res.data.data ?? [];
        },
        placeholderData: [],
    });
}

export interface CreateTenantDto {
    name:      string;
    slug:      string;
    timezone:  string;
    currency:  string;
    vat_rate:  number;
    admin_email?: string;
    admin_name?: string;
    admin_password?: string;
}

export function useCreateTenant() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (dto: CreateTenantDto): Promise<void> => {
            await api.post('/admin/tenants', dto);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tenants'] }),
    });
}

export interface UpdateTenantDto {
    name?:      string;
    timezone?:  string;
    currency?:  string;
    vat_rate?:  number;
    is_active?: boolean;
}

export function useUpdateTenant() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, dto }: { id: string; dto: UpdateTenantDto }): Promise<void> => {
            await api.patch(`/admin/tenants/${id}`, dto);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tenants'] }),
    });
}

export function useDeactivateTenant() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string): Promise<void> => {
            await api.patch(`/admin/tenants/${id}/deactivate`);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tenants'] }),
    });
}

export function useRotateSyncKey() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (tenantId: string): Promise<{ sync_api_key: string }> => {
            const res = await api.post(`/admin/tenants/${tenantId}/rotate-sync-key`);
            return res.data.data ?? res.data;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'tenants'] }),
    });
}

// ── Platform overview (super_admin) ──────────────────────────────────────────
export function usePlatformOverview() {
    return useQuery({
        queryKey: ['admin', 'platform', 'overview'],
        queryFn: async (): Promise<PlatformOverview> => {
            const res = await api.get('/admin/platform/overview');
            const data = res.data.data ?? {};
            const recentSyncLogs = Array.isArray(data.recent_sync_logs)
                ? data.recent_sync_logs
                : [];
            const today = new Date().toISOString().slice(0, 10);
            const inferredSyncsToday = recentSyncLogs.filter((log: any) =>
                String(log?.started_at ?? '').startsWith(today),
            ).length;

            return {
                totalTenants: Number(data.totalTenants ?? data.tenant_count ?? 0),
                activeTenants: Number(data.activeTenants ?? data.active_tenant_count ?? 0),
                totalUsers: Number(data.totalUsers ?? data.user_count ?? 0),
                syncsToday: Number(data.syncsToday ?? inferredSyncsToday),
            };
        },
        placeholderData: { totalTenants: 0, activeTenants: 0, totalUsers: 0, syncsToday: 0 },
        staleTime: 5 * 60 * 1000,
    });
}
