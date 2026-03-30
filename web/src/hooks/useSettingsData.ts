"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";

export interface UserPreferences {
    default_range?: string;
    currency?:      string;
    timezone?:      string;
    alert_threshold?: number;
    email_alerts?:  boolean;
    critical_only?: boolean;
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
            const res = await api.post('/auth/logout');
            return res.data;
        },
    });
}
