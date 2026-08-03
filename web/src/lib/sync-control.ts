export function syncAgentStatusLabel(status?: string | null) {
    return status ? status.replace(/_/g," ") : "Never connected";
}

// Shared by the Sync page and the sidebar health dot so the two can never
// disagree about what a given backend status means.
export const SYNC_HEALTH_COLORS = {
    ok: "#10b981",
    stale: "#f59e0b",
    never_synced: "#f59e0b",
    engine_offline: "#f43f5e",
    failed: "#f43f5e",
    unknown: "#2a4060",
} as const;

export function healthColor(status?: string | null): string {
    if (status === "ok" || status === "online" || status === "running") return SYNC_HEALTH_COLORS.ok;
    if (status === "stale" || status === "outdated" || status === "never_synced" || status === "never_connected" || status === "unknown") return SYNC_HEALTH_COLORS.stale;
    if (status === "engine_offline" || status === "offline" || status === "not_installed" || status === "failed" || status === "error") return SYNC_HEALTH_COLORS.engine_offline;
    return SYNC_HEALTH_COLORS.unknown;
}

export function healthLabel(status?: string | null): string {
    return String(status || "unknown").replace(/_/g, " ");
}

const SHORT_HEALTH_LABELS: Record<string, string> = {
    ok: "OK",
    stale: "Stale",
    never_synced: "No sync",
    engine_offline: "Offline",
    failed: "Failed",
};

export function shortHealthLabel(status?: string | null): string {
    return SHORT_HEALTH_LABELS[String(status ?? "")] ?? "Unknown";
}

export function syncCommandStatusLabel(status: string) {
    return status === "queued" ? "Queued — waiting for engine" : status.replace(/_/g," ");
}

export function hasRealProgress(progress?: number | null) {
    return progress != null && Number.isFinite(progress);
}

// Averages only runs the backend timed. Unfinished runs report no duration and
// must not be counted as 0ms, which would understate the real average.
export function averageRunLatencyMs(runs: Array<{ duration_ms?: number | null }>): number | null {
    const timed = runs.filter((run) => run.duration_ms != null && Number.isFinite(run.duration_ms));
    if (!timed.length) return null;
    return Math.round(timed.reduce((sum, run) => sum + Number(run.duration_ms), 0) / timed.length);
}
