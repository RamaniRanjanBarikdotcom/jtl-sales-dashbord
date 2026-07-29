"use client";

import { useMutation } from "@tanstack/react-query";
import { useAuthedQuery } from "@/lib/react-query-auth";
import api from "@/lib/api";

const LOGS_POLL_MS = Math.max(
  10,
  Number(process.env.NEXT_PUBLIC_SYSTEM_LOGS_LIVE_POLL_SECONDS || 15),
) * 1000;

export type LogsTab = "live" | "sync" | "audit" | "errors" | "security" | "infrastructure";
export interface LogsFilters {
  from?: string;
  to?: string;
  source?: string;
  module?: string;
  severity?: string;
  status?: string;
  eventType?: string;
  actorUserId?: string;
  agentId?: string;
  syncRunId?: string;
  commandId?: string;
  correlationId?: string;
  search?: string;
  sortBy?: string;
  sortDirection?: string;
  page: number;
  limit: number;
}

export function useLogsSummary(filters: LogsFilters, enabled: boolean) {
  return useAuthedQuery({
    queryKey: ["logs","summary",filters.from,filters.to],
    queryFn: async () => (await api.get("/admin/logs/summary", { params: filters })).data.data,
    enabled,
    refetchInterval: LOGS_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useLogs(tab: LogsTab, filters: LogsFilters, enabled: boolean) {
  const endpoint = tab === "audit" ? "audit" : tab === "security" ? "security" : "events";
  const params = tab === "audit" ? filters : { ...filters,category: tab };
  return useAuthedQuery({
    queryKey: ["logs",tab,filters],
    queryFn: async () => (await api.get(`/admin/logs/${endpoint}`, { params })).data.data,
    enabled,
    placeholderData: (previous) => previous,
    refetchInterval: filters.from || filters.to ? false : LOGS_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useLogDetail(id: string | null, enabled: boolean) {
  return useAuthedQuery({
    queryKey: ["logs","detail",id],
    queryFn: async () => (await api.get(`/admin/logs/events/${id}`)).data.data,
    enabled: enabled && Boolean(id),
  });
}

export function useRelatedEvents(id: string | null, enabled: boolean) {
  return useAuthedQuery({
    queryKey: ["logs","related",id],
    queryFn: async () => (await api.get(`/admin/logs/events/${id}/related`)).data.data,
    enabled: enabled && Boolean(id),
  });
}

export function useLogsExport() {
  return useMutation({
    mutationFn: async ({ filters,format }: { filters: LogsFilters; format: "csv"|"json" }) => {
      const response = await api.post("/admin/logs/export", { ...filters,format }, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `system-logs-${new Date().toISOString().slice(0,10)}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    },
  });
}
