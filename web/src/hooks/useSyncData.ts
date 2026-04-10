"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";

export interface SyncLogEntry {
    id: string;
    job_name: string;
    trigger_type: string;
    status: string;
    rows_extracted: number;
    rows_inserted: number;
    rows_updated: number;
    duration_ms: number;
    error_message: string | null;
    started_at: string;
    completed_at: string;
}

export interface SyncWatermarkEntry {
    job_name: string;
    last_synced_at: string;
    last_row_count: number;
}

export interface SyncStatusResponse {
    logs: SyncLogEntry[];
    watermarks: SyncWatermarkEntry[];
    last_ingest_at: string | null;
    last_ingest_module: string | null;
    sync_key_prefix: string | null;
}

export function useSyncStatus() {
    return useQuery({
        queryKey: ["sync", "status"],
        queryFn: async (): Promise<SyncStatusResponse> => {
            const res = await api.get("/sync/status");
            return res.data.data;
        },
        placeholderData: { logs: [], watermarks: [], last_ingest_at: null, last_ingest_module: null, sync_key_prefix: null },
        staleTime: 15_000,
        refetchInterval: 15_000,
    });
}

export function useSyncLogs(page = 1, limit = 50) {
    return useQuery({
        queryKey: ["sync", "logs", page, limit],
        queryFn: async () => {
            const res = await api.get(`/sync/logs?page=${page}&limit=${limit}`);
            return res.data.data;
        },
        placeholderData: { logs: [], total: 0, page: 1, limit: 50 },
        staleTime: 15_000,
        refetchInterval: 15_000,
    });
}

export function useTriggerSync() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (module: string): Promise<any> => {
            const res = await api.post(`/sync/trigger/${module}`);
            return res.data;
        },
        onSuccess: () => {
            // Refetch sync status after triggering
            qc.invalidateQueries({ queryKey: ["sync"] });
        },
    });
}

export function useRotateSyncKey() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (): Promise<void> => {
            await api.post("/sync/rotate-key");
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["sync"] }),
    });
}
