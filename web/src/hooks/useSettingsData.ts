"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthedQuery as useQuery } from "@/lib/react-query-auth";
import api from "@/lib/api";

export interface UserPreferences {
    default_range?: string;
    currency?:      string;
    timezone?:      string;
    alert_threshold?: number;
    email_alerts?:  boolean;
    critical_only?: boolean;
}

export interface CompanySettings {
    tenantId: string;
    name: string;
    slug: string;
    timezone: string;
    currency: string;
    vat_rate: number;
    data_freshness_threshold_minutes: number;
    default_dashboard_range: string;
    alert_recipients: string[];
    sync_config: {
        sync_schedule: string;
        modules: Record<string, boolean>;
    };
}

export interface CompanySyncConfig {
    tenantId: string;
    sync_config: {
        sync_schedule: string;
        modules: Record<string, boolean>;
    };
    sync_key_prefix: string | null;
    sync_key_last_rotated: string | null;
    engine_installations: Array<Record<string, unknown>>;
}

export interface PlatformSettings {
    feature_flags: Record<string, boolean>;
    tenant_defaults: {
        timezone: string;
        currency: string;
        vat_rate: number;
    };
    security_policy: Record<string, unknown>;
    audit_retention_days: number;
    sync_freshness_default_minutes: number;
    maintenance_mode: boolean;
}

export function useGetPreferences() {
    return useQuery({
        queryKey: ['settings', 'preferences'],
        queryFn: async (): Promise<UserPreferences> => {
            const res = await api.get('/auth/preferences');
            return res.data.data ?? {};
        },
        placeholderData: {},
        staleTime: 10 * 60 * 1000,
    });
}

export function useUpdateProfile() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: { full_name?: string; email?: string }) => {
            const res = await api.patch('/auth/profile', body);
            return res.data;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
    });
}

export function useChangePassword() {
    return useMutation({
        mutationFn: async (body: { currentPassword: string; newPassword: string }) => {
            const res = await api.patch('/auth/change-password', body);
            return res.data;
        },
    });
}

export function useUpdatePreferences() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (prefs: UserPreferences) => {
            const res = await api.patch('/auth/preferences', prefs);
            return res.data;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'preferences'] }),
    });
}

export function useSignOutAllSessions() {
    return useMutation({
        mutationFn: async () => {
            const res = await api.post('/auth/logout-all');
            return res.data;
        },
    });
}

export function useCompanySettings(tenantId?: string | null) {
    return useQuery({
        queryKey: ['settings', 'company', tenantId ?? null],
        queryFn: async (): Promise<CompanySettings> => {
            const res = await api.get(`/company/settings${tenantId ? `?tenantId=${tenantId}` : ''}`);
            return res.data.data ?? res.data;
        },
        enabled: Boolean(tenantId),
    });
}

export function useUpdateCompanySettings(tenantId?: string | null) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: Partial<CompanySettings>) => {
            const res = await api.patch(`/company/settings${tenantId ? `?tenantId=${tenantId}` : ''}`, body);
            return res.data.data ?? res.data;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'company'] }),
    });
}

export function useCompanySyncConfig(tenantId?: string | null) {
    return useQuery({
        queryKey: ['settings', 'company-sync', tenantId ?? null],
        queryFn: async (): Promise<CompanySyncConfig> => {
            const res = await api.get(`/company/sync-config${tenantId ? `?tenantId=${tenantId}` : ''}`);
            return res.data.data ?? res.data;
        },
        enabled: Boolean(tenantId),
    });
}

export function useUpdateCompanySyncConfig(tenantId?: string | null) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: { sync_schedule?: string; modules?: Record<string, boolean> }) => {
            const res = await api.patch(`/company/sync-config${tenantId ? `?tenantId=${tenantId}` : ''}`, body);
            return res.data.data ?? res.data;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'company-sync'] }),
    });
}

export function usePlatformSettings(enabled: boolean) {
    return useQuery({
        queryKey: ['settings', 'platform'],
        queryFn: async (): Promise<PlatformSettings> => {
            const res = await api.get('/platform/settings');
            return res.data.data ?? res.data;
        },
        enabled,
    });
}

export function useUpdatePlatformSettings() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (body: Partial<PlatformSettings>) => {
            const res = await api.patch('/platform/settings', body);
            return res.data.data ?? res.data;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'platform'] }),
    });
}
