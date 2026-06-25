"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthedQuery as useQuery } from "@/lib/react-query-auth";
import api from "@/lib/api";

export interface SyncLogEntry {
    id: string;
    module: string;
    job_name?: string;
    sync_mode?: "incremental" | "full";
    trigger_type: string;
    status: "running" | "ok" | "failed" | "cancelled";
    total_rows: number;
    inserted_rows: number;
    updated_rows: number;
    deleted_rows: number;
    rows_extracted?: number;
    rows_inserted?: number;
    rows_updated?: number;
    duration_ms: number | null;
    error_message: string | null;
    started_at: string;
    completed_at: string | null;
    failed_at?: string | null;
    batch_count?: number;
    failed_batch_count?: number;
}

export interface SyncTriggerEntry {
    id: string;
    module: string;
    sync_mode?: "incremental" | "full";
    syncMode?: "incremental" | "full";
    status: "pending" | "picked" | "running" | "completed" | "failed" | "cancelled" | "expired";
    progress_percent?: number;
    current_batch?: number | null;
    total_batches?: number | null;
    rows_synced?: number;
    result_message?: string | null;
    error_message?: string | null;
    engine_id?: string | null;
    created_at?: string;
    picked_at?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    failed_at?: string | null;
    cancelled_at?: string | null;
}

export interface SyncWatermarkEntry {
    job_name: string;
    last_synced_at: string;
    last_row_count: number;
}

export interface SyncStatusResponse {
    logs: SyncLogEntry[];
    runs: SyncLogEntry[];
    triggers?: SyncTriggerEntry[];
    active_triggers?: SyncTriggerEntry[];
    watermarks: SyncWatermarkEntry[];
    engine_installations?: any[];
    engine_status?: any | null;
    sync_health?: "ok" | "stale" | "failed" | "never_synced" | "engine_offline";
    last_ingest_at: string | null;
    last_ingest_module: string | null;
    last_attempt_at?: string | null;
    last_attempt_module?: string | null;
    last_success_at?: string | null;
    last_success_module?: string | null;
    last_failure_at?: string | null;
    last_failure_message?: string | null;
    sync_key_prefix: string | null;
    sync_key_last_rotated?: string | null;
}

function normalizeRun(row: any): SyncLogEntry {
    const status = row?.status === "error" ? "failed" : (row?.status ?? "running");
    return {
        id: String(row?.id ?? `${row?.job_name ?? row?.module ?? "sync"}-${row?.started_at ?? ""}`),
        module: String(row?.module ?? row?.job_name ?? "unknown"),
        job_name: row?.job_name,
        sync_mode: row?.sync_mode ?? "incremental",
        trigger_type: row?.trigger_type ?? "scheduled",
        status,
        total_rows: Number(row?.total_rows ?? row?.rows_extracted ?? 0),
        inserted_rows: Number(row?.inserted_rows ?? row?.rows_inserted ?? 0),
        updated_rows: Number(row?.updated_rows ?? row?.rows_updated ?? 0),
        deleted_rows: Number(row?.deleted_rows ?? 0),
        rows_extracted: Number(row?.rows_extracted ?? row?.total_rows ?? 0),
        rows_inserted: Number(row?.rows_inserted ?? row?.inserted_rows ?? 0),
        rows_updated: Number(row?.rows_updated ?? row?.updated_rows ?? 0),
        duration_ms: row?.duration_ms == null ? null : Number(row.duration_ms),
        error_message: row?.error_message ?? null,
        started_at: row?.started_at,
        completed_at: row?.completed_at ?? null,
        failed_at: row?.failed_at ?? null,
        batch_count: Number(row?.batch_count ?? 0),
        failed_batch_count: Number(row?.failed_batch_count ?? 0),
    };
}

function tenantQuery(tenantId?: string | null) {
    return tenantId ? `tenantId=${encodeURIComponent(tenantId)}` : "";
}

export function useSyncStatus(tenantId?: string | null) {
    const qs = tenantQuery(tenantId);
    return useQuery({
        queryKey: ["sync", "status", tenantId ?? ""],
        queryFn: async (): Promise<SyncStatusResponse> => {
            const res = await api.get(`/sync/status${qs ? `?${qs}` : ""}`);
            const data = res.data.data ?? {};
            const runs = Array.isArray(data.runs) ? data.runs.map(normalizeRun) : [];
            return {
                ...data,
                logs: runs,
                runs,
                watermarks: Array.isArray(data.watermarks) ? data.watermarks : [],
                triggers: Array.isArray(data.triggers) ? data.triggers : [],
                active_triggers: Array.isArray(data.active_triggers) ? data.active_triggers : [],
            };
        },
        placeholderData: { logs: [], runs: [], watermarks: [], last_ingest_at: null, last_ingest_module: null, sync_key_prefix: null },
        staleTime: 15_000,
        refetchInterval: 15_000,
    });
}

export function useSyncLogs(page = 1, limit = 50, tenantId?: string | null) {
    const qs = new URLSearchParams();
    qs.set("page", String(page));
    qs.set("limit", String(limit));
    if (tenantId) qs.set("tenantId", tenantId);
    return useQuery({
        queryKey: ["sync", "logs", page, limit, tenantId ?? ""],
        queryFn: async () => {
            const res = await api.get(`/sync/logs?${qs.toString()}`);
            const data = res.data.data ?? {};
            const logs = Array.isArray(data.logs)
                ? data.logs.map(normalizeRun)
                : Array.isArray(data.rows)
                  ? data.rows.map(normalizeRun)
                  : [];
            return { ...data, logs, rows: logs };
        },
        placeholderData: { logs: [], total: 0, page: 1, limit: 50 },
        staleTime: 15_000,
        refetchInterval: 15_000,
    });
}

export function useTriggerSync(tenantId?: string | null) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ module, syncMode }: { module: string; syncMode: "incremental" | "full" }): Promise<any> => {
            const qs = tenantQuery(tenantId);
            const res = await api.post(`/sync/trigger/${module}${qs ? `?${qs}` : ""}`, { syncMode });
            return res.data.data ?? res.data;
        },
        onSuccess: () => {
            // Refetch sync status after triggering
            qc.invalidateQueries({ queryKey: ["sync"] });
        },
    });
}

export function useCancelSyncTrigger(tenantId?: string | null) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (triggerId: string): Promise<any> => {
            const qs = tenantQuery(tenantId);
            const res = await api.post(`/sync/triggers/${triggerId}/cancel${qs ? `?${qs}` : ""}`);
            return res.data.data ?? res.data;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["sync"] }),
    });
}

export function useRotateSyncKey(tenantId?: string | null) {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (): Promise<{ sync_api_key: string }> => {
            const qs = tenantQuery(tenantId);
            const res = await api.post(`/sync/rotate-key${qs ? `?${qs}` : ""}`);
            return res.data.data ?? res.data;
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["sync"] }),
    });
}
