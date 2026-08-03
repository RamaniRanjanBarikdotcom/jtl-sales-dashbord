"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { SectionHeader as SH } from "@/components/ui/SectionHeader";
import { DS } from "@/lib/design-system";
import {
    useCancelSyncCommand, useCancelSyncTrigger, useCreateSyncCommand,
    useSyncControlStatus, useSyncStatus, useSyncLogs, useTriggerSync,
    useAgentUpdateStatus, useRequestAgentUpdate, useCancelAgentUpdate,
    SyncControlCommand, SyncLogEntry, SyncTriggerEntry,
} from "@/hooks/useSyncData";
import { useStore } from "@/lib/store";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import {
    hasRealProgress,syncAgentStatusLabel,syncCommandStatusLabel,averageRunLatencyMs,
    healthColor,healthLabel,
} from "@/lib/sync-control";

function timeAgo(dateStr: string | null): string {
    if (!dateStr) return "Never";
    const diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 60_000) return "Just now";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    return `${Math.floor(diff / 86400_000)}d ago`;
}

function fmtDuration(ms: number | null, fallback = "—"): string {
    if (ms == null) return fallback;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

const MODULES = ["orders", "products", "customers", "inventory"] as const;

// Mirrors the backend sync_runs enum. queued and partial_failed were previously
// unmapped and rendered uncoloured.
const STATUS_COLORS: Record<string, string> = {
    queued: DS.lo,
    running: DS.amber,
    ok: DS.emerald,
    failed: DS.rose,
    partial_failed: DS.amber,
    cancelled: DS.lo,
};

const btn = {
    fontFamily: "inherit", borderRadius: 8, cursor: "pointer",
    fontSize: 11, fontWeight: 600, padding: "7px 12px",
};
const tile = {
    background: "rgba(255,255,255,0.02)", border: `1px solid ${DS.border}`,
    borderRadius: 10, padding: "12px 14px",
};

// Compact label/value pair for the engine identity strip.
function Meta({ label, value, color, mono, title }: {
    label: string; value: string; color?: string; mono?: boolean; title?: string;
}) {
    return (
        <div title={title}>
            <div style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
            <div style={{
                fontSize: 12, fontWeight: 700, color: color ?? DS.hi,
                fontFamily: mono ? DS.mono : "inherit", whiteSpace: "nowrap",
            }}>{value}</div>
        </div>
    );
}

// A connection line with its own status dot — reads faster than a bare tile.
function StatusLine({ label, value }: { label: string; value?: string | null }) {
    const color = healthColor(value);
    return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "5px 0" }}>
            <span style={{ fontSize: 11, color: DS.mid }}>{label}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, boxShadow: `0 0 5px ${color}88` }} />
                <span style={{ fontSize: 11, color, fontWeight: 700, textTransform: "capitalize" }}>
                    {value ? String(value).replace(/_/g, " ") : "Unknown"}
                </span>
            </span>
        </div>
    );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "5px 0" }}>
            <span style={{ fontSize: 11, color: DS.mid, whiteSpace: "nowrap" }}>{label}</span>
            <span style={{ fontSize: 11, color: color ?? DS.hi, fontWeight: 700, textAlign: "right", textTransform: "capitalize" }}>{value}</span>
        </div>
    );
}

export default function SyncTab() {
    const { session, currentCompany } = useStore();
    const canManageSync = session?.role === "super_admin" || session?.role === "admin";
    const selectedTenantId = session?.role === "super_admin" ? currentCompany?.tenantId ?? null : null;
    const statusQ = useSyncStatus(selectedTenantId);
    const featureFlags = useFeatureFlags();
    const controlStatus = useSyncControlStatus(
        featureFlags.data?.SYNC_CONTROL_STATUS_ENABLED === true,
    );
    const createCommand = useCreateSyncCommand();
    const cancelCommand = useCancelSyncCommand();
    const [logPage, setLogPage] = useState(1);
    const logsQ = useSyncLogs(logPage, 50, selectedTenantId);
    const triggerSync = useTriggerSync(selectedTenantId);
    const cancelSync = useCancelSyncTrigger(selectedTenantId);
    const [expandedError, setExpandedError] = useState<string | null>(null);
    const [triggeringModule, setTriggeringModule] = useState<string | null>(null);
    const [syncMode, setSyncMode] = useState<"incremental" | "full">("incremental");
    const [commandError,setCommandError] = useState<string|null>(null);
    const [logModule,setLogModule] = useState("");
    const [logStatus,setLogStatus] = useState("");

    const status = statusQ.data ?? { logs: [], runs: [], watermarks: [], triggers: [], active_triggers: [], last_ingest_at: null, last_ingest_module: null, sync_key_prefix: null };
    const recentRuns = status.runs ?? status.logs ?? [];
    const activeTriggers = status.active_triggers ?? [];
    const allTriggers = status.triggers ?? [];
    const allLogs: SyncLogEntry[] = logsQ.data?.logs ?? [];
    const logTotal = logsQ.data?.total ?? 0;
    const engineOffline = status.engine_status?.status === "offline" || status.engine_status?.status === "not_installed" || status.sync_health === "engine_offline";
    const control = controlStatus.data;
    const agent = control?.agents?.[0] ?? null;
    const activeCommand = control?.activeCommand ?? null;
    const controlCommandsEnabled = featureFlags.data?.SYNC_CONTROL_COMMANDS_ENABLED === true;
    const updatesEnabled = featureFlags.data?.SYNC_AGENT_UPDATE_ENABLED === true &&
        featureFlags.data?.SYNC_AGENT_UPDATE_REQUEST_ENABLED === true;
    const canUpdateAgent = session?.role === "super_admin" ||
        (session?.permissions ?? []).includes("sync.agent.update");
    const updateQ = useAgentUpdateStatus(agent?.agent_id,updatesEnabled);
    const requestUpdate = useRequestAgentUpdate();
    const cancelUpdate = useCancelAgentUpdate();
    const [updateError,setUpdateError] = useState<string|null>(null);
    const activeUpdate = updateQ.data?.current &&
        ["requested","approved","claimed","downloading","verifying","staged",
            "waiting_for_window","installing","restarting","verifying_health","rollback_started"]
            .includes(updateQ.data.current.status)
        ? updateQ.data.current
        : null;
    const supportsSafeCancellation = agent?.capabilities?.safeCancellation === true;
    const isModuleActive = (mod: string) =>
        activeTriggers.some((trigger: SyncTriggerEntry) => trigger.module === mod && ["pending", "picked", "running"].includes(trigger.status));

    // Every /sync/* route hard-rejects non-admin roles, but ACCESS_BY_TAB lets
    // managers reach this page. Without this they'd see a wall of failed panels.
    const roleBlocked = !canManageSync && (statusQ.error as any)?.response?.status === 403;

    // Build per-module summary from watermarks and recent logs
    const wmMap = new Map((status.watermarks ?? []).map((w: any) => [w.job_name, w]));
    const moduleSummary = MODULES.map(mod => {
        const wm = wmMap.get(mod);
        const recentLogs = recentRuns.filter((l: SyncLogEntry) => l.module === mod);
        const lastLog = recentLogs[0];
        const errorCount = recentLogs.filter((l: SyncLogEntry) => l.status === "failed").length;
        return {
            module: mod,
            lastSync: wm?.last_synced_at ?? null,
            lastRowCount: wm?.last_row_count ?? null,
            lastStatus: lastLog?.status ?? null,
            lastDuration: lastLog?.duration_ms ?? null,
            lastError: lastLog?.status === "failed" ? lastLog?.error_message : null,
            errorCount,
        };
    });

    // KPI calculations from logs
    const totalRowsSynced = recentRuns
        .filter((l: SyncLogEntry) => l.status === "ok")
        .reduce((s: number, l: SyncLogEntry) => s + l.inserted_rows + l.updated_rows + l.deleted_rows, 0);
    const failedJobs = recentRuns.filter((l: SyncLogEntry) => l.status === "failed").length;
    const timedRuns = recentRuns.filter((l: SyncLogEntry) => l.duration_ms != null);
    const avgLatency = averageRunLatencyMs(recentRuns);

    // Client-side only: GET /sync/logs accepts page and limit, nothing else.
    const logs = useMemo(() => allLogs.filter((l) =>
        (!logModule || l.module === logModule) && (!logStatus || l.status === logStatus)
    ),[allLogs,logModule,logStatus]);
    const logsFiltered = logModule !== "" || logStatus !== "";

    const handleTrigger = async (mod: string) => {
        if (syncMode === "full" && !window.confirm("Full sync may take longer and process a large amount of data. Continue?")) return;
        setTriggeringModule(mod);
        try {
            await triggerSync.mutateAsync({ module: mod, syncMode });
        } catch {
            // Error surfaces in status on next refetch
        } finally {
            setTriggeringModule(null);
        }
    };

    const handleTriggerAll = async () => {
        if (syncMode === "full" && !window.confirm("Full sync may take longer and process a large amount of data. Continue?")) return;
        setTriggeringModule("all");
        try {
            await triggerSync.mutateAsync({ module: "all", syncMode });
        } catch {
        } finally {
            setTriggeringModule(null);
        }
    };

    const queueCommand = async (commandType: string,reason?: string) => {
        if (!agent) return;
        setCommandError(null);
        try {
            await createCommand.mutateAsync({
                agentId: agent.agent_id,
                commandType,
                idempotencyKey: crypto.randomUUID(),
                reason,
            });
        } catch (error: any) {
            setCommandError(error?.response?.data?.data?.message || error?.response?.data?.message || "Command could not be queued.");
        }
    };

    const queueUpdate = async (installMode: "now"|"maintenance") => {
        if (!agent || !updateQ.data?.available) return;
        setUpdateError(null);
        try {
            await requestUpdate.mutateAsync({
                agentId: agent.agent_id,
                releaseId: updateQ.data.available.id,
                installMode,
                reason: installMode === "now"
                    ? "Administrator approved safe immediate update"
                    : "Administrator approved maintenance-window update",
            });
        } catch (error: any) {
            setUpdateError(error?.response?.data?.data?.message ||
                error?.response?.data?.message || "Update request failed.");
        }
    };

    if (roleBlocked) {
        return (
            <Card accent={DS.amber}>
                <SH title="Sync Status" sub="Insufficient role" />
                <p style={{ color: DS.hi, fontSize: 13, margin: "0 0 6px" }}>
                    Sync data is restricted to administrators.
                </p>
                <p style={{ color: DS.mid, fontSize: 11, margin: 0 }}>
                    Your role can open this page, but the sync API only serves users with the
                    admin or super admin role. Ask an administrator to review your access.
                </p>
            </Card>
        );
    }

    const health = status.sync_health;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* ── Health hero ── */}
            <Card accent={healthColor(health)}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap", marginBottom: 18 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <div style={{
                            width: 12, height: 12, borderRadius: "50%", flexShrink: 0,
                            background: healthColor(health),
                            boxShadow: `0 0 12px ${healthColor(health)}aa`,
                        }} />
                        <div>
                            <h2 style={{
                                margin: 0, fontFamily: DS.display, fontSize: 22, fontWeight: 400,
                                color: healthColor(health), textTransform: "capitalize",
                            }}>{healthLabel(health)}</h2>
                            <p style={{ margin: "3px 0 0", fontSize: 11, color: DS.lo }}>
                                {health === "ok" ? "Sync engine connected and up to date"
                                    : health === "engine_offline" ? "No heartbeat from the sync engine in over 2 minutes"
                                    : health === "stale" ? "Last successful sync was more than 24 hours ago"
                                    : health === "failed" ? "The most recent sync attempt failed"
                                    : health === "never_synced" ? "No successful sync has completed yet"
                                    : "Sync engine status unknown"}
                            </p>
                        </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{
                            width: 7, height: 7, borderRadius: "50%",
                            background: statusQ.isFetching ? DS.amber : DS.emerald,
                        }} />
                        <span style={{ fontSize: 10, color: DS.lo }}>
                            {statusQ.isFetching ? "Refreshing…" : "Live · every 15s"}
                        </span>
                    </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
                    {[
                        { label: "Engine Last Seen", value: timeAgo(status.engine_status?.last_seen_at ?? null), color: healthColor(status.engine_status?.status) },
                        { label: "Last Ingest", value: timeAgo(status.last_ingest_at), color: DS.hi, sub: `Module: ${status.last_ingest_module ?? "—"}` },
                        { label: "Last Success", value: timeAgo(status.last_success_at ?? null), color: DS.emerald },
                        { label: "Last Failure", value: timeAgo(status.last_failure_at ?? null), color: status.last_failure_at ? DS.rose : DS.lo },
                        { label: "Failed Jobs", value: String(failedJobs), color: failedJobs > 0 ? DS.rose : DS.hi, sub: "from last 20 runs" },
                        { label: "Rows Synced", value: totalRowsSynced.toLocaleString(), color: DS.hi, sub: "inserted + updated" },
                        { label: "Avg Latency", value: fmtDuration(avgLatency, "Not available"), color: avgLatency == null ? DS.lo : DS.hi,
                          sub: avgLatency == null ? "no completed runs" : `mean of ${timedRuns.length} run${timedRuns.length === 1 ? "" : "s"}` },
                        { label: "Active Syncs", value: String(activeTriggers.length), color: activeTriggers.length ? DS.amber : DS.hi },
                    ].map((item) => (
                        <div key={item.label} style={tile}>
                            <div style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{item.label}</div>
                            <div style={{ fontSize: 15, color: item.color, fontWeight: 700, textTransform: "capitalize" }}>{item.value}</div>
                            {item.sub && <div style={{ fontSize: 9, color: DS.lo, marginTop: 4 }}>{item.sub}</div>}
                        </div>
                    ))}
                </div>

                {status.last_failure_message && (
                    <div style={{
                        marginTop: 12, padding: "10px 12px", borderRadius: 8,
                        border: `1px solid ${DS.rose}30`, background: "rgba(244,63,94,0.07)",
                        color: DS.rose, fontSize: 11, wordBreak: "break-word",
                    }}>
                        <strong style={{ display: "block", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4, color: DS.lo }}>
                            Last failure
                        </strong>
                        {status.last_failure_message}
                    </div>
                )}
            </Card>

            {/* ── Manual Sync Trigger — the flow that actually works ── */}
            {canManageSync && (
                <Card accent={DS.violet}>
                    <SH title="Manual Sync" sub="Trigger data sync from JTL-Wawi"
                        right={
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <div style={{ display: "flex", gap: 2, padding: 3, background: DS.surface, border: `1px solid ${DS.border}`, borderRadius: 9 }}>
                                    {(["incremental", "full"] as const).map((mode) => (
                                        <button key={mode} onClick={() => setSyncMode(mode)}
                                            title={mode === "full" ? "Re-reads all records — slower" : "Only records changed since the last sync"}
                                            style={{
                                                ...btn, padding: "5px 12px", border: "none",
                                                color: syncMode === mode ? DS.sky : DS.mid,
                                                background: syncMode === mode ? "rgba(56,189,248,0.14)" : "transparent",
                                                textTransform: "capitalize", fontSize: 10,
                                            }}>{mode}</button>
                                    ))}
                                </div>
                                <button onClick={handleTriggerAll}
                                    disabled={triggeringModule !== null || MODULES.every(isModuleActive)}
                                    style={{
                                        ...btn, color: "#fff",
                                        background: "linear-gradient(135deg,#7c3aed,#6d28d9)",
                                        border: "1px solid rgba(139,92,246,0.4)",
                                        padding: "7px 16px",
                                        cursor: triggeringModule ? "not-allowed" : "pointer",
                                        opacity: triggeringModule ? 0.6 : 1,
                                    }}>
                                    {triggeringModule === "all" ? "Queueing…" : "Sync All"}
                                </button>
                            </div>
                        }
                    />
                    {engineOffline && (
                        <div style={{
                            marginBottom: 12, color: DS.amber, background: "rgba(251,191,36,0.08)",
                            border: `1px solid ${DS.amber}33`, borderRadius: 8, padding: "9px 11px", fontSize: 11,
                        }}>
                            Engine is offline. Sync requests will be queued and start when the company server sync engine comes online.
                        </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10 }}>
                        {moduleSummary.map(m => {
                            const isTriggering = triggeringModule === m.module;
                            const moduleActive = isModuleActive(m.module);
                            const statusColor = STATUS_COLORS[m.lastStatus ?? ""] ?? DS.lo;
                            return (
                                <div key={m.module} style={{ ...tile, padding: "14px 16px", borderRadius: 12 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                                        <div>
                                            <div style={{ fontSize: 13, color: DS.hi, fontWeight: 600, textTransform: "capitalize" }}>{m.module}</div>
                                            <div style={{ fontSize: 9, color: DS.lo, marginTop: 2 }}>Last: {timeAgo(m.lastSync)}</div>
                                        </div>
                                        <div title={m.lastStatus ?? "no runs yet"} style={{
                                            width: 8, height: 8, borderRadius: "50%",
                                            background: statusColor, boxShadow: `0 0 6px ${statusColor}88`,
                                        }} />
                                    </div>
                                    <div style={{ display: "flex", gap: 12, marginBottom: 10, fontSize: 10, color: DS.mid }}>
                                        <span>Rows: <strong style={{ color: DS.hi }}>{m.lastRowCount == null ? "—" : Number(m.lastRowCount).toLocaleString()}</strong></span>
                                        <span>Time: <strong style={{ color: DS.hi }}>{fmtDuration(m.lastDuration)}</strong></span>
                                    </div>
                                    {m.lastError && (
                                        <div style={{
                                            fontSize: 10, color: DS.rose, background: "rgba(244,63,94,0.08)",
                                            border: "1px solid rgba(244,63,94,0.2)", borderRadius: 6,
                                            padding: "6px 8px", marginBottom: 10, wordBreak: "break-word",
                                        }}>{m.lastError}</div>
                                    )}
                                    <button onClick={() => handleTrigger(m.module)}
                                        disabled={triggeringModule !== null || moduleActive}
                                        style={{
                                            ...btn, width: "100%", padding: "8px 0",
                                            color: isTriggering || moduleActive ? DS.lo : DS.sky,
                                            background: "rgba(56,189,248,0.08)",
                                            border: `1px solid ${DS.sky}30`,
                                            cursor: triggeringModule ? "not-allowed" : "pointer",
                                            opacity: triggeringModule && !isTriggering ? 0.5 : 1,
                                        }}>
                                        {moduleActive ? "Already active" : isTriggering ? "Queueing…" : `Sync ${m.module}`}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </Card>
            )}

            {/* ── Active syncs ── */}
            <Card accent={activeTriggers.length ? DS.amber : DS.emerald}>
                <SH title="Active Syncs" sub={`${activeTriggers.length} active · ${allTriggers.length} recent commands`} />
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(activeTriggers.length ? activeTriggers : allTriggers.slice(0, 6)).map((trigger: SyncTriggerEntry) => {
                        const progress = hasRealProgress(trigger.progress_percent) ? Number(trigger.progress_percent) : null;
                        const canCancel = ["pending", "picked"].includes(trigger.status);
                        return (
                            <div key={trigger.id} style={{ ...tile, padding: "11px 13px" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                                    <div>
                                        <div style={{ color: DS.hi, fontWeight: 700, textTransform: "capitalize", fontSize: 13 }}>
                                            {trigger.module} · {trigger.sync_mode ?? trigger.syncMode ?? "incremental"}
                                        </div>
                                        <div style={{ color: DS.lo, fontSize: 10, marginTop: 3 }}>
                                            {trigger.status} {trigger.current_batch && trigger.total_batches ? `· batch ${trigger.current_batch}/${trigger.total_batches}` : ""} · {trigger.rows_synced == null ? "rows not reported" : `rows ${Number(trigger.rows_synced).toLocaleString()}`}
                                        </div>
                                    </div>
                                    {canCancel && (
                                        <button onClick={() => cancelSync.mutate(trigger.id)}
                                            disabled={cancelSync.isPending}
                                            style={{ ...btn, color: DS.rose, background: "rgba(244,63,94,0.08)", border: `1px solid ${DS.rose}44`, fontSize: 10 }}>
                                            Cancel
                                        </button>
                                    )}
                                </div>
                                <div style={{ color: DS.lo, fontSize: 10, marginTop: 7 }}>
                                    {progress != null
                                        ? `${Math.round(progress)}% complete`
                                        : trigger.status === "running" || trigger.status === "picked"
                                            ? "Running — progress details unavailable"
                                            : "Progress not reported"}
                                </div>
                                {progress != null && (
                                    <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.06)", marginTop: 5, overflow: "hidden" }}>
                                        <div style={{ width: `${Math.max(0, Math.min(100, progress))}%`, height: "100%", background: trigger.status === "failed" ? DS.rose : DS.sky }} />
                                    </div>
                                )}
                                {(trigger.error_message || trigger.result_message) && (
                                    <div style={{ color: trigger.error_message ? DS.rose : DS.lo, fontSize: 10, marginTop: 6 }}>{trigger.error_message || trigger.result_message}</div>
                                )}
                            </div>
                        );
                    })}
                    {!activeTriggers.length && !allTriggers.length && (
                        <div style={{ color: DS.lo, fontSize: 12, padding: "20px 0", textAlign: "center" }}>No sync commands yet.</div>
                    )}
                </div>
            </Card>

            {/* ── Sync logs ── */}
            <Card accent={DS.cyan}>
                <SH title="Sync Logs" sub={`${logTotal} total entries`}
                    right={
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <select value={logModule} onChange={(e) => setLogModule(e.target.value)}
                                aria-label="Filter by module"
                                style={{ ...btn, background: "#090d18", border: `1px solid ${DS.border}`, color: DS.mid, fontWeight: 400 }}>
                                <option value="">All modules</option>
                                {MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                            <select value={logStatus} onChange={(e) => setLogStatus(e.target.value)}
                                aria-label="Filter by status"
                                style={{ ...btn, background: "#090d18", border: `1px solid ${DS.border}`, color: DS.mid, fontWeight: 400 }}>
                                <option value="">All statuses</option>
                                {Object.keys(STATUS_COLORS).map((s) => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                    }
                />
                {logsFiltered && (
                    <p style={{ margin: "0 0 10px", fontSize: 10, color: DS.lo }}>
                        Filtering the {allLogs.length} entries on this page only — the sync log API does not support server-side filters.
                    </p>
                )}
                {logs.length === 0 ? (
                    <div style={{ padding: "32px 0", textAlign: "center", color: DS.lo, fontSize: 12 }}>
                        {logsFiltered ? "No entries on this page match those filters"
                            : "No sync logs yet — data will appear once the sync engine runs"}
                    </div>
                ) : (
                    <>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                                <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                                    {["Module", "Status", "Trigger", "Rows", "Duration", "Time", ""].map((h, i) => (
                                        <th key={i} style={{
                                            textAlign: i > 2 ? "right" : "left", fontSize: 9, color: DS.lo,
                                            letterSpacing: "0.07em", textTransform: "uppercase",
                                            padding: "0 7px 10px", fontWeight: 600,
                                        }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map((l: SyncLogEntry, index: number) => {
                                    const c = STATUS_COLORS[l.status] ?? DS.lo;
                                    const hasError = l.status === "failed" && l.error_message;
                                    const isExpanded = expandedError === l.id;
                                    return (
                                        <tr key={l.id} style={{
                                            borderBottom: `1px solid rgba(255,255,255,0.03)`,
                                            background: index % 2 ? "rgba(255,255,255,0.014)" : "transparent",
                                        }}>
                                            <td style={{ padding: "10px 7px", fontSize: 12, color: DS.hi, fontWeight: 500, textTransform: "capitalize" }}>{l.module}</td>
                                            <td style={{ padding: "10px 7px" }}>
                                                <span style={{
                                                    fontSize: 9, padding: "3px 8px", borderRadius: 20, fontWeight: 700,
                                                    textTransform: "uppercase", letterSpacing: "0.05em",
                                                    background: `${c}1f`, color: c, border: `1px solid ${c}33`,
                                                }}>{l.status.replace(/_/g, " ")}</span>
                                            </td>
                                            <td style={{ padding: "10px 7px", fontSize: 10, color: DS.lo }}>{l.trigger_type}</td>
                                            <td style={{ padding: "10px 7px", textAlign: "right", fontSize: 11, color: DS.hi, fontFamily: DS.mono }}>
                                                {(l.inserted_rows + l.updated_rows + l.deleted_rows).toLocaleString()}
                                            </td>
                                            <td style={{ padding: "10px 7px", textAlign: "right", fontSize: 11, color: DS.lo, fontFamily: DS.mono }}>
                                                {fmtDuration(l.duration_ms)}
                                            </td>
                                            <td style={{ padding: "10px 7px", textAlign: "right", fontSize: 10, color: DS.lo, fontFamily: DS.mono }}>
                                                {timeAgo(l.started_at)}
                                            </td>
                                            <td style={{ padding: "10px 7px", textAlign: "right" }}>
                                                {hasError && (
                                                    <button onClick={() => setExpandedError(isExpanded ? null : l.id)}
                                                        style={{
                                                            ...btn, fontSize: 9, padding: "3px 8px", color: DS.rose,
                                                            background: "rgba(244,63,94,0.08)", border: `1px solid ${DS.rose}30`,
                                                        }}>
                                                        {isExpanded ? "Hide" : "Error"}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>

                        {expandedError && (() => {
                            const errLog = logs.find(l => l.id === expandedError);
                            if (!errLog?.error_message) return null;
                            return (
                                <div style={{
                                    margin: "10px 0", padding: "12px 14px",
                                    background: "rgba(244,63,94,0.06)", border: `1px solid ${DS.rose}25`,
                                    borderRadius: 8, fontSize: 11, color: DS.rose,
                                    fontFamily: DS.mono, whiteSpace: "pre-wrap", wordBreak: "break-word",
                                }}>
                                    <div style={{ fontSize: 9, color: DS.lo, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                                        Error Detail — {errLog.module} at {new Date(errLog.started_at).toLocaleString()}
                                    </div>
                                    {errLog.error_message}
                                </div>
                            );
                        })()}

                        {logTotal > 50 && (
                            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 14, alignItems: "center" }}>
                                <button onClick={() => setLogPage(p => Math.max(1, p - 1))} disabled={logPage <= 1}
                                    style={{ ...btn, fontSize: 10, color: logPage <= 1 ? DS.lo : DS.sky,
                                        background: "rgba(56,189,248,0.06)", border: `1px solid ${DS.sky}30`,
                                        cursor: logPage <= 1 ? "default" : "pointer" }}>Prev</button>
                                <span style={{ fontSize: 10, color: DS.lo, padding: "4px 8px" }}>
                                    Page {logPage} of {Math.ceil(logTotal / 50)}
                                </span>
                                <button onClick={() => setLogPage(p => p + 1)} disabled={logPage * 50 >= logTotal}
                                    style={{ ...btn, fontSize: 10, color: logPage * 50 >= logTotal ? DS.lo : DS.sky,
                                        background: "rgba(56,189,248,0.06)", border: `1px solid ${DS.sky}30`,
                                        cursor: logPage * 50 >= logTotal ? "default" : "pointer" }}>Next</button>
                            </div>
                        )}
                    </>
                )}
            </Card>

            {/* ── Watermarks ── */}
            <Card accent={DS.emerald}>
                <SH title="Sync Watermarks" sub="Current sync state per module" />
                {(status.watermarks ?? []).length === 0 ? (
                    <div style={{ padding: "24px 0", textAlign: "center", color: DS.lo, fontSize: 12 }}>
                        No watermarks yet — modules will appear after first sync
                    </div>
                ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
                        {(status.watermarks ?? []).map((w: any) => (
                            <div key={w.job_name} style={tile}>
                                <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600, textTransform: "capitalize", marginBottom: 6 }}>{w.job_name}</div>
                                <div style={{ fontSize: 10, color: DS.lo }}>
                                    Last sync: <strong style={{ color: DS.mid }}>{new Date(w.last_synced_at).toLocaleString()}</strong>
                                </div>
                                <div style={{ fontSize: 10, color: DS.lo, marginTop: 2 }}>
                                    Rows: <strong style={{ color: DS.mid }}>{w.last_row_count}</strong>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            {/* ── Sync Control Centre ── */}
            <Card accent={healthColor(agent?.connection_status)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
                    <div>
                        <h3 style={{ fontFamily: DS.display, fontWeight: 400, fontSize: 17, color: DS.hi, margin: 0 }}>
                            Sync Control Centre
                        </h3>
                        <p style={{ fontSize: 10, color: DS.lo, margin: "3px 0 0", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                            Windows service heartbeat &amp; remote command queue
                        </p>
                    </div>
                    <div style={{
                        display: "inline-flex", alignItems: "center", gap: 8,
                        padding: "6px 12px", borderRadius: 20,
                        background: `${healthColor(agent?.connection_status)}14`,
                        border: `1px solid ${healthColor(agent?.connection_status)}33`,
                    }}>
                        <span style={{
                            width: 7, height: 7, borderRadius: "50%",
                            background: healthColor(agent?.connection_status),
                            boxShadow: `0 0 7px ${healthColor(agent?.connection_status)}aa`,
                        }} />
                        <span style={{ color: healthColor(agent?.connection_status), fontSize: 11, fontWeight: 700, textTransform: "capitalize" }}>
                            {controlStatus.isError ? "Unavailable" : syncAgentStatusLabel(agent?.connection_status)}
                        </span>
                    </div>
                </div>

                <div>
                    {controlStatus.isLoading ? (
                        <div style={{ color: DS.lo, padding: 12 }}>Loading real engine status…</div>
                    ) : controlStatus.isError ? (
                        <div style={{ color: DS.rose, padding: 12 }}>Sync Control API unavailable. Existing data synchronization remains separate.</div>
                    ) : !agent ? (
                        <div style={{ color: DS.amber, padding: 12 }}>Never connected — install or start the configured Windows service.</div>
                    ) : (
                        <>
                            {/* Identity strip — the engine's fixed facts */}
                            <div style={{
                                display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap",
                                padding: "14px 16px", borderRadius: 12, marginBottom: 12,
                                background: "rgba(255,255,255,0.025)", border: `1px solid ${DS.border}`,
                            }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                                    <div style={{
                                        width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        background: `${DS.sky}14`, border: `1px solid ${DS.sky}33`,
                                        fontSize: 16,
                                    }}>🖥</div>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontSize: 14, color: DS.hi, fontWeight: 700 }}>
                                            {agent.display_name || agent.agent_id}
                                        </div>
                                        <div style={{ fontSize: 10, color: DS.lo, marginTop: 2 }}>
                                            {agent.machine_name || "Unknown machine"}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginLeft: "auto" }}>
                                    <Meta label="Version" value={agent.service_version || "—"} mono />
                                    <Meta label="Build" value={agent.git_sha ? agent.git_sha.slice(0, 7) : "—"}
                                        title={agent.git_sha || undefined} mono />
                                    <Meta label="Last heartbeat" value={timeAgo(agent.last_heartbeat_at ?? null)}
                                        color={healthColor(agent.connection_status)} />
                                </div>
                            </div>

                            {/* Connections + activity */}
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 12 }}>
                                <div style={{ ...tile, padding: "14px 16px", borderRadius: 12 }}>
                                    <div style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 11, fontWeight: 600 }}>
                                        Connections
                                    </div>
                                    <StatusLine label="JTL database" value={agent.jtl_connection_status} />
                                    <StatusLine label="Backend API" value={agent.backend_connection_status} />
                                    <StatusLine label="Scheduler" value={agent.scheduler_state} />
                                </div>

                                <div style={{ ...tile, padding: "14px 16px", borderRadius: 12 }}>
                                    <div style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 11, fontWeight: 600 }}>
                                        Activity
                                    </div>
                                    <Row label="Current job" value={agent.current_job || "Idle"}
                                        color={agent.current_job ? DS.amber : DS.emerald} />
                                    <Row label="Last successful sync" value={timeAgo(agent.last_successful_sync_at ?? null)} color={DS.emerald} />
                                    <Row label="Next scheduled" color={DS.sky}
                                        value={agent.next_scheduled_sync_at ? new Date(agent.next_scheduled_sync_at).toLocaleString() : "Not scheduled"} />
                                </div>
                            </div>

                            {["offline","never_connected"].includes(agent.connection_status) && (
                                <div style={{
                                    color: DS.amber, marginTop: 12, fontSize: 11,
                                    background: "rgba(245,158,11,0.08)", border: `1px solid ${DS.amber}33`,
                                    borderRadius: 8, padding: "9px 11px",
                                }}>
                                    {agent.connection_status === "never_connected"
                                        ? "Engine has never connected. Commands remain queued until it reports in."
                                        : "Engine is offline. Commands remain queued until it reconnects."}
                                </div>
                            )}

                            {canManageSync && (
                                <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${DS.border}` }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 11 }}>
                                        <div style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.09em", fontWeight: 600 }}>
                                            Remote commands
                                        </div>
                                        <span style={{
                                            fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
                                            padding: "3px 9px", borderRadius: 20,
                                            color: controlCommandsEnabled ? DS.emerald : DS.amber,
                                            background: `${controlCommandsEnabled ? DS.emerald : DS.amber}14`,
                                            border: `1px solid ${controlCommandsEnabled ? DS.emerald : DS.amber}33`,
                                        }}>
                                            {controlCommandsEnabled ? "Enabled" : "Read-only rollout"}
                                        </span>
                                    </div>

                                    {!controlCommandsEnabled && (
                                        <div style={{
                                            color: DS.amber, background: "rgba(245,158,11,0.08)",
                                            border: `1px solid ${DS.amber}33`, borderRadius: 8,
                                            padding: "9px 11px", fontSize: 11, marginBottom: 11, lineHeight: 1.5,
                                        }}>
                                            Remote commands are switched off on this platform
                                            (<code style={{ fontFamily: DS.mono }}>SYNC_CONTROL_COMMANDS_ENABLED</code>).
                                            They stay listed so you can see what this engine supports —
                                            ask a platform administrator to enable them.
                                        </div>
                                    )}

                                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
                                        {[
                                            ["Run Incremental","SYNC_ALL_INCREMENTAL","⟳","Queue an incremental sync of all modules"],
                                            ["Diagnostics","RUN_DIAGNOSTICS","🩺","Run the engine's self-check routine"],
                                            ["Test JTL","TEST_JTL_CONNECTION","🔌","Verify the JTL database connection"],
                                            ["Test Backend","TEST_BACKEND_CONNECTION","☁","Verify the connection back to this dashboard"],
                                            [agent.scheduler_state === "paused" ? "Resume Scheduler" : "Pause Scheduler",
                                                agent.scheduler_state === "paused" ? "RESUME_SCHEDULER" : "PAUSE_SCHEDULER",
                                                agent.scheduler_state === "paused" ? "▶" : "⏸",
                                                agent.scheduler_state === "paused" ? "Resume automatic scheduled syncs" : "Stop automatic scheduled syncs"],
                                        ].map(([label,type,icon,hint]) => (
                                            <button key={type} onClick={() => queueCommand(type)}
                                                disabled={!controlCommandsEnabled || createCommand.isPending}
                                                title={controlCommandsEnabled ? hint : "Disabled by SYNC_CONTROL_COMMANDS_ENABLED"}
                                                style={{
                                                    ...btn, fontSize: 11, padding: "10px 12px", textAlign: "left",
                                                    display: "flex", alignItems: "center", gap: 9,
                                                    border: `1px solid ${controlCommandsEnabled ? `${DS.sky}44` : DS.border}`,
                                                    background: controlCommandsEnabled ? "rgba(56,189,248,.08)" : "rgba(255,255,255,0.02)",
                                                    color: controlCommandsEnabled ? DS.sky : DS.lo,
                                                    cursor: controlCommandsEnabled ? "pointer" : "not-allowed",
                                                }}>
                                                <span style={{ fontSize: 13, opacity: controlCommandsEnabled ? 1 : 0.5 }}>{icon}</span>
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {commandError && <div style={{ color: DS.rose,fontSize: 11,marginTop: 9 }}>{commandError}</div>}

                            {activeCommand && (
                                <div style={{ marginTop: 12,border: `1px solid ${DS.amber}44`,borderRadius: 10,padding: 12 }}>
                                    <div style={{ display: "flex",justifyContent: "space-between",gap: 10 }}>
                                        <div>
                                            <div style={{ color: DS.hi,fontWeight: 700 }}>{activeCommand.command_type}</div>
                                            <div style={{ color: DS.mid,fontSize: 10,marginTop: 3 }}>
                                                {syncCommandStatusLabel(activeCommand.status)}
                                                {activeCommand.current_batch && activeCommand.total_batches
                                                    ? ` · batch ${activeCommand.current_batch}/${activeCommand.total_batches}` : ""}
                                                {activeCommand.rows_processed != null
                                                    ? ` · ${Number(activeCommand.rows_processed).toLocaleString()} rows` : ""}
                                            </div>
                                        </div>
                                        {(activeCommand.status === "queued" ||
                                            (supportsSafeCancellation && ["claimed","running"].includes(activeCommand.status))) && (
                                            <button onClick={() => cancelCommand.mutate(activeCommand.id)}
                                                disabled={cancelCommand.isPending}
                                                style={{ ...btn, color: DS.rose,border: `1px solid ${DS.rose}44`,background: "rgba(244,63,94,.08)" }}>
                                                Request cancellation
                                            </button>
                                        )}
                                    </div>
                                    {hasRealProgress(activeCommand.progress_percent) && (
                                        <div style={{ height: 6,background: "rgba(255,255,255,.06)",borderRadius: 999,marginTop: 9 }}>
                                            <div style={{ height: "100%",width: `${activeCommand.progress_percent}%`,background: DS.sky,borderRadius: 999 }} />
                                        </div>
                                    )}
                                    {activeCommand.progress_percent == null && activeCommand.status === "running" && (
                                        <div style={{ color: DS.lo,fontSize: 10,marginTop: 7 }}>Running — progress details unavailable</div>
                                    )}
                                </div>
                            )}

                            {!!control?.commands?.length && (
                                <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${DS.border}` }}>
                                    <div style={{ color: DS.lo,fontSize: 9,textTransform: "uppercase",marginBottom: 9,letterSpacing: "0.09em",fontWeight: 600 }}>
                                        Recent command history
                                    </div>
                                    <div style={{ display: "grid",gridTemplateColumns: "2fr 1fr 1fr 1fr",gap: 8,
                                        padding: "0 10px 7px",fontSize: 9,color: DS.lo,textTransform: "uppercase",letterSpacing: "0.06em" }}>
                                        <span>Command</span><span>Status</span><span>Requested by</span><span>When</span>
                                    </div>
                                    {control.commands.slice(0,6).map((command: SyncControlCommand, index: number) => (
                                        <div key={command.id} style={{ display: "grid",gridTemplateColumns: "2fr 1fr 1fr 1fr",gap: 8,
                                            padding: "9px 10px",fontSize: 10,borderRadius: 7,alignItems: "center",
                                            background: index % 2 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                                            <span style={{ color: DS.hi,fontWeight: 600 }}>{command.command_type.replace(/_/g," ").toLowerCase()}</span>
                                            <span>
                                                <span style={{
                                                    fontSize: 9,fontWeight: 700,textTransform: "uppercase",letterSpacing: "0.05em",
                                                    padding: "3px 8px",borderRadius: 20,whiteSpace: "nowrap",
                                                    color: healthColor(command.status),
                                                    background: `${healthColor(command.status)}1f`,
                                                    border: `1px solid ${healthColor(command.status)}33`,
                                                }}>{command.status}</span>
                                            </span>
                                            <span style={{ color: DS.mid }}>{command.requested_by_name || "System"}</span>
                                            <span style={{ color: DS.lo }}>{timeAgo(command.created_at)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Agent updates — nested here, also flag-gated */}
                            <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${DS.border}` }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 11, gap: 12, flexWrap: "wrap" }}>
                                    <div style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.09em", fontWeight: 600 }}>
                                        Engine updates
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                        <span style={{
                                            fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
                                            padding: "3px 9px", borderRadius: 20,
                                            color: updatesEnabled ? DS.emerald : DS.amber,
                                            background: `${updatesEnabled ? DS.emerald : DS.amber}14`,
                                            border: `1px solid ${updatesEnabled ? DS.emerald : DS.amber}33`,
                                        }}>
                                            {updatesEnabled ? "Enabled" : "Disabled"}
                                        </span>
                                        {updatesEnabled && agent.capabilities?.safeUpdate === true && (
                                            <button onClick={() => updateQ.refetch()}
                                                style={{ ...btn, color: DS.sky,border: `1px solid ${DS.sky}44`,background: "transparent" }}>
                                                Check for update
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {!updatesEnabled ? (
                                    <div style={{
                                        color: DS.amber, background: "rgba(245,158,11,0.08)",
                                        border: `1px solid ${DS.amber}33`, borderRadius: 8,
                                        padding: "9px 11px", fontSize: 11,
                                    }}>
                                        Engine updates are switched off on this platform
                                        (<code style={{ fontFamily: DS.mono }}>SYNC_AGENT_UPDATE_ENABLED</code> and
                                        {" "}<code style={{ fontFamily: DS.mono }}>SYNC_AGENT_UPDATE_REQUEST_ENABLED</code>).
                                        Update the sync engine manually on the company server until they are enabled.
                                    </div>
                                ) : agent.capabilities?.safeUpdate !== true ? (
                                    <div style={{ color: DS.lo, fontSize: 11 }}>
                                        This engine build does not advertise safe-update support.
                                    </div>
                                ) : updateQ.isError ? (
                                    <div style={{ color: DS.rose,padding: 10 }}>Update status is unavailable.</div>
                                ) : (
                                    <>
                                        <div style={{ display: "grid",gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",gap: 10 }}>
                                            {[
                                                ["Installed version",updateQ.data?.agent?.service_version || agent.service_version || "Unknown"],
                                                ["Installed Git SHA",updateQ.data?.agent?.git_sha || agent.git_sha || "Unknown"],
                                                ["Protocol",String(updateQ.data?.agent?.protocol_version ?? agent.capabilities?.updateProtocolVersion ?? "Unknown")],
                                                ["Available version",updateQ.data?.available?.version || "Up to date"],
                                                ["Channel",updateQ.data?.available?.channel || "stable"],
                                                ["Capability","Safe update"],
                                                ["Update status",updateQ.data?.current?.status?.replace(/_/g," ") || "Up to date"],
                                                ["Last attempt",timeAgo(updateQ.data?.agent?.last_update_attempt_at ?? null)],
                                            ].map(([label,value]) => (
                                                <div key={label} style={tile}>
                                                    <div style={{ color: DS.lo,fontSize: 9,textTransform: "uppercase",marginBottom: 5 }}>{label}</div>
                                                    <div style={{ color: DS.hi,fontSize: 11,fontWeight: 700,wordBreak: "break-word",textTransform: label === "Update status" ? "capitalize" : "none" }}>{value}</div>
                                                </div>
                                            ))}
                                        </div>
                                        {(updateQ.data?.available?.release_notes || updateQ.data?.current?.release_notes) && (
                                            <div style={{ color: DS.mid,fontSize: 11,marginTop: 10 }}>
                                                Release notes: {updateQ.data?.available?.release_notes || updateQ.data?.current?.release_notes}
                                            </div>
                                        )}
                                        <div style={{ display: "flex",gap: 8,flexWrap: "wrap",marginTop: 12 }}>
                                            {canUpdateAgent && updateQ.data?.available && !activeUpdate && (
                                                <>
                                                    <button onClick={() => queueUpdate("maintenance")} disabled={requestUpdate.isPending}
                                                        style={{ ...btn, color: DS.violet,border: `1px solid ${DS.violet}66`,background: `${DS.violet}14` }}>
                                                        Download &amp; install in maintenance window
                                                    </button>
                                                    <button onClick={() => window.confirm("Install the signed update as soon as the service reaches a safe boundary?") && queueUpdate("now")}
                                                        disabled={requestUpdate.isPending || !!agent.current_job}
                                                        style={{ ...btn, color: DS.amber,border: `1px solid ${DS.amber}66`,background: `${DS.amber}14` }}>
                                                        Install now, when safe
                                                    </button>
                                                </>
                                            )}
                                            {canUpdateAgent && activeUpdate &&
                                                ["requested","approved","claimed","downloading","verifying","staged","waiting_for_window"].includes(activeUpdate.status) && (
                                                <button onClick={() => cancelUpdate.mutate(activeUpdate.id)}
                                                    disabled={cancelUpdate.isPending}
                                                    style={{ ...btn, color: DS.rose,border: `1px solid ${DS.rose}66`,background: `${DS.rose}14` }}>
                                                    Cancel pending update
                                                </button>
                                            )}
                                        </div>
                                        {updateError && <div style={{ color: DS.rose,fontSize: 11,marginTop: 9 }}>{updateError}</div>}
                                        {!!updateQ.data?.history?.length && (
                                            <details style={{ marginTop: 12,color: DS.mid,fontSize: 11 }}>
                                                <summary style={{ cursor: "pointer",color: DS.sky }}>View update history</summary>
                                                {updateQ.data.history.slice(0,10).map(item => (
                                                    <div key={item.id} style={{ display: "grid",gridTemplateColumns: "1fr 1fr 1fr 2fr",gap: 8,borderTop: `1px solid ${DS.border}`,padding: "7px 0" }}>
                                                        <span>{item.target_version}</span><span>{item.status.replace(/_/g," ")}</span>
                                                        <span>{timeAgo(item.requested_at)}</span><span style={{ color: item.error_message ? DS.rose : DS.lo }}>{item.error_message || "No error"}</span>
                                                    </div>
                                                ))}
                                            </details>
                                        )}
                                    </>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </Card>

            {/* ── Sync API key ── */}
            {canManageSync && status.sync_key_prefix && (
                <Card accent={DS.amber}>
                    <SH title="Sync API Key" sub="Used by the .NET sync engine to authenticate" />
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
                        <span style={{ fontSize: 12, color: DS.lo }}>Key prefix:</span>
                        <code style={{ fontSize: 12, color: DS.amber, background: "rgba(245,158,11,0.08)", padding: "4px 10px", borderRadius: 6, fontFamily: DS.mono }}>
                            {status.sync_key_prefix}…
                        </code>
                    </div>
                </Card>
            )}
        </div>
    );
}
