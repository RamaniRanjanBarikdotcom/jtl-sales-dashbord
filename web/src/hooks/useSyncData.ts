/**
 * TanStack Query hooks for the Sync Status module.
 * Plan Section 9:  GET /api/sync/{status, logs}
 *                  POST /api/sync/rotate-key
 *
 * Status refetches every 60 s (matches plan Redis TTL).
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import { SYNC_JOBS, SYNC_VOLUME, DAILY } from "@/lib/mock-data";

const HAS_API = () => !!process.env.NEXT_PUBLIC_API_URL;

export interface SyncStatusResponse {
    jobs:    typeof SYNC_JOBS;
    volume:  typeof SYNC_VOLUME;
    health:  number;  // uptime %
    latency: number;  // ms
}

const MOCK_STATUS: SyncStatusResponse = {
    jobs:    SYNC_JOBS,
    volume:  SYNC_VOLUME,
    health:  99.8,
    latency: 1200,
};

export function useSyncStatus() {
    return useQuery({
        queryKey: ['sync', 'status'],
        queryFn: async (): Promise<SyncStatusResponse> => {
            if (!HAS_API()) return MOCK_STATUS;
            const res = await api.get('/sync/status');
            return res.data.data;
        },
        initialData: MOCK_STATUS,
        staleTime:       60 * 1000,     // 60 s — matches plan Redis TTL
        refetchInterval: 60 * 1000,
    });
}

export function useSyncLogs(page = 1, limit = 20) {
    return useQuery({
        queryKey: ['sync', 'logs', page, limit],
        queryFn: async () => {
            if (!HAS_API()) return { rows: DAILY, total: DAILY.length, page, limit };
            const res = await api.get(`/sync/logs?page=${page}&limit=${limit}`);
            return res.data.data;
        },
        staleTime: 60 * 1000,
    });
}

export function useRotateSyncKey() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (): Promise<void> => {
            if (!HAS_API()) return;
            await api.post('/sync/rotate-key');
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['sync'] }),
    });
}
