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

// The backend validates with whitelist + forbidNonWhitelisted, and @IsOptional()
// only skips undefined/null — an empty string reaches @IsDateString()/@IsIn()
// and comes back as a 400. Drop blanks before they ever hit the wire.
//
// `datetime-local` also yields a naive local wall-clock string ("2026-08-02T14:30"),
// which Postgres would read in *server* time. Send a real instant instead.
function cleanParams(filters: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === "" || value === null || value === undefined) continue;
    if ((key === "from" || key === "to") && typeof value === "string") {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) continue;
      out[key] = parsed.toISOString();
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function useLogsSummary(filters: LogsFilters, enabled: boolean) {
  return useAuthedQuery({
    // Deliberately not keyed on from/to: the backend's summary counts are a
    // fixed 24h window and ignore the date range, so re-keying would refetch
    // identical numbers on every date change.
    queryKey: ["logs","summary"],
    queryFn: async () => (await api.get("/admin/logs/summary")).data.data,
    enabled,
    refetchInterval: LOGS_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useLogs(tab: LogsTab, filters: LogsFilters, enabled: boolean) {
  const endpoint = tab === "audit" ? "audit" : tab === "security" ? "security" : "events";
  const params = cleanParams(tab === "audit" ? filters : { ...filters,category: tab });
  return useAuthedQuery({
    queryKey: ["logs",tab,params],
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
      const response = await api.post("/admin/logs/export", { ...cleanParams(filters),format }, { responseType: "blob" });
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
