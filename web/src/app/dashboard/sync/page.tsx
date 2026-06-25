"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { SectionHeader as SH } from "@/components/ui/SectionHeader";
import { DS } from "@/lib/design-system";
import { useCancelSyncTrigger, useSyncStatus, useSyncLogs, useTriggerSync, SyncLogEntry, SyncTriggerEntry } from "@/hooks/useSyncData";
import { useStore } from "@/lib/store";

function timeAgo(dateStr: string | null): string {
    if (!dateStr) return "Never";
    const diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 60_000) return "Just now";
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
    return `${Math.floor(diff / 86400_000)}d ago`;
}

function fmtDuration(ms: number | null): string {
    if (!ms) return "-";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

const MODULES = ["orders", "products", "customers", "inventory"] as const;
const STATUS_COLORS: Record<SyncLogEntry["status"], string> = {
    running: DS.amber,
    ok: DS.emerald,
    failed: DS.rose,
    cancelled: DS.lo,
};

function healthColor(status?: string | null): string {
    if (status === "ok" || status === "online") return DS.emerald;
    if (status === "stale" || status === "outdated" || status === "unknown") return DS.amber;
    if (status === "engine_offline" || status === "offline" || status === "failed" || status === "error") return DS.rose;
    return DS.lo;
}

function healthLabel(status?: string | null): string {
    return String(status || "unknown").replace(/_/g, " ");
}

export default function SyncTab() {
    const { session, currentCompany } = useStore();
    const canManageSync = session?.role === "super_admin" || session?.role === "admin";
    const selectedTenantId = session?.role === "super_admin" ? currentCompany?.tenantId ?? null : null;
    const statusQ = useSyncStatus(selectedTenantId);
    const [logPage, setLogPage] = useState(1);
    const logsQ = useSyncLogs(logPage, 50, selectedTenantId);
    const triggerSync = useTriggerSync(selectedTenantId);
    const cancelSync = useCancelSyncTrigger(selectedTenantId);
    const [expandedError, setExpandedError] = useState<string | null>(null);
    const [triggeringModule, setTriggeringModule] = useState<string | null>(null);
    const [syncMode, setSyncMode] = useState<"incremental" | "full">("incremental");

    const status = statusQ.data ?? { logs: [], runs: [], watermarks: [], triggers: [], active_triggers: [], last_ingest_at: null, last_ingest_module: null, sync_key_prefix: null };
    const recentRuns = status.runs ?? status.logs ?? [];
    const activeTriggers = status.active_triggers ?? [];
    const allTriggers = status.triggers ?? [];
    const logs: SyncLogEntry[] = logsQ.data?.logs ?? [];
    const logTotal = logsQ.data?.total ?? 0;
    const engineOffline = status.engine_status?.status === "offline" || status.engine_status?.status === "not_installed" || status.sync_health === "engine_offline";
    const isModuleActive = (mod: string) =>
        activeTriggers.some((trigger: SyncTriggerEntry) => trigger.module === mod && ["pending", "picked", "running"].includes(trigger.status));

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
            lastRowCount: wm?.last_row_count ?? 0,
            lastStatus: lastLog?.status ?? "pending",
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
    const avgLatency = recentRuns.length > 0
        ? Math.round(recentRuns.reduce((s: number, l: SyncLogEntry) => s + (l.duration_ms ?? 0), 0) / recentRuns.length)
        : 0;

    const handleTrigger = async (mod: string) => {
        if (syncMode === "full" && !window.confirm("Full sync may take longer and process a large amount of data. Continue?")) return;
        setTriggeringModule(mod);
        try {
            await triggerSync.mutateAsync({ module: mod, syncMode });
        } catch (err: any) {
            // Error will show in status on next refetch
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

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* KPI row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                <Card accent={DS.emerald}>
                    <div style={{ padding: "16px 18px" }}>
                        <div style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Last Ingest</div>
                        <div style={{ fontSize: 22, color: DS.hi, fontFamily: DS.display }}>{timeAgo(status.last_ingest_at)}</div>
                        <div style={{ fontSize: 10, color: DS.lo, marginTop: 4 }}>Module: {status.last_ingest_module ?? "—"}</div>
                    </div>
                </Card>
                <Card accent={failedJobs > 0 ? DS.rose : DS.emerald}>
                    <div style={{ padding: "16px 18px" }}>
                        <div style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Failed Jobs (Recent)</div>
                        <div style={{ fontSize: 22, color: failedJobs > 0 ? DS.rose : DS.hi, fontFamily: DS.display }}>{failedJobs}</div>
                        <div style={{ fontSize: 10, color: DS.lo, marginTop: 4 }}>from last 20 logs</div>
                    </div>
                </Card>
                <Card accent={DS.sky}>
                    <div style={{ padding: "16px 18px" }}>
                        <div style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Rows Synced (Recent)</div>
                        <div style={{ fontSize: 22, color: DS.hi, fontFamily: DS.display }}>{totalRowsSynced.toLocaleString()}</div>
                        <div style={{ fontSize: 10, color: DS.lo, marginTop: 4 }}>inserted + updated</div>
                    </div>
                </Card>
                <Card accent={DS.amber}>
                    <div style={{ padding: "16px 18px" }}>
                        <div style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Avg Latency</div>
                        <div style={{ fontSize: 22, color: DS.hi, fontFamily: DS.display }}>{fmtDuration(avgLatency)}</div>
                        <div style={{ fontSize: 10, color: DS.lo, marginTop: 4 }}>per ingest batch</div>
                    </div>
                </Card>
            </div>

            <Card accent={healthColor(status.sync_health)}>
                <SH title="Sync Engine Health" sub="Connector heartbeat, sync lifecycle, and latest failure state" />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
                    {[
                        { label: "Health", value: healthLabel(status.sync_health), color: healthColor(status.sync_health) },
                        { label: "Engine Last Seen", value: timeAgo(status.engine_status?.last_seen_at ?? null), color: healthColor(status.engine_status?.status) },
                        { label: "Last Success", value: timeAgo(status.last_success_at ?? null), color: DS.emerald },
                        { label: "Last Failure", value: timeAgo(status.last_failure_at ?? null), color: status.last_failure_at ? DS.rose : DS.lo },
                    ].map((item) => (
                        <div key={item.label} style={{
                            background: "rgba(255,255,255,0.02)",
                            border: `1px solid ${DS.border}`,
                            borderRadius: 10,
                            padding: "12px 14px",
                        }}>
                            <div style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{item.label}</div>
                            <div style={{ fontSize: 14, color: item.color, fontWeight: 700, textTransform: "capitalize" }}>{item.value}</div>
                        </div>
                    ))}
                </div>
                {status.last_failure_message && (
                    <div style={{
                        marginTop: 10,
                        padding: "9px 11px",
                        borderRadius: 8,
                        border: `1px solid ${DS.rose}30`,
                        background: "rgba(244,63,94,0.07)",
                        color: DS.rose,
                        fontSize: 11,
                        wordBreak: "break-word",
                    }}>
                        {status.last_failure_message}
                    </div>
                )}
            </Card>

            {/* Manual Sync Trigger — super_admin / admin only */}
            {canManageSync && (
                <Card accent={DS.violet}>
                    <SH title="Manual Sync Trigger" sub="Trigger data sync from JTL-Wawi"
                        right={
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                {(["incremental", "full"] as const).map((mode) => (
                                    <button
                                        key={mode}
                                        onClick={() => setSyncMode(mode)}
                                        style={{
                                            fontSize: 10,
                                            fontWeight: 700,
                                            color: syncMode === mode ? DS.hi : DS.mid,
                                            background: syncMode === mode ? "rgba(56,189,248,0.18)" : "rgba(255,255,255,0.04)",
                                            border: `1px solid ${syncMode === mode ? DS.sky : DS.border}`,
                                            borderRadius: 8,
                                            padding: "6px 10px",
                                            cursor: "pointer",
                                            textTransform: "capitalize",
                                        }}
                                    >
                                        {mode}
                                    </button>
                                ))}
                                <button
                                    onClick={handleTriggerAll}
                                    disabled={triggeringModule !== null || MODULES.every(isModuleActive)}
                                    style={{
                                        fontSize: 11, fontWeight: 600, color: DS.hi,
                                        background: "linear-gradient(135deg,#7c3aed,#6d28d9)",
                                        border: "1px solid rgba(139,92,246,0.4)",
                                        borderRadius: 8, padding: "6px 14px", cursor: triggeringModule ? "not-allowed" : "pointer",
                                        opacity: triggeringModule ? 0.6 : 1,
                                    }}
                                >
                                    {triggeringModule === "all" ? "Queueing..." : "Sync All"}
                                </button>
                            </div>
                        }
                    />
                    {engineOffline && (
                        <div style={{
                            marginTop: 10,
                            color: DS.amber,
                            background: "rgba(251,191,36,0.08)",
                            border: `1px solid ${DS.amber}33`,
                            borderRadius: 8,
                            padding: "8px 10px",
                            fontSize: 11,
                        }}>
                            Engine is offline. Sync requests will be queued and start when the company server sync engine comes online.
                        </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginTop: 10 }}>
                        {moduleSummary.map(m => {
                            const isTriggering = triggeringModule === m.module;
                            const moduleActive = isModuleActive(m.module);
                            const statusColor = m.lastStatus === "ok" ? DS.emerald
                                : m.lastStatus === "failed" ? DS.rose
                                : m.lastStatus === "running" ? DS.amber
                                : DS.lo;
                            return (
                                <div key={m.module} style={{
                                    background: "rgba(255,255,255,0.02)", border: `1px solid ${DS.border}`,
                                    borderRadius: 12, padding: "14px 16px",
                                }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                                        <div>
                                            <div style={{ fontSize: 13, color: DS.hi, fontWeight: 600, textTransform: "capitalize" }}>{m.module}</div>
                                            <div style={{ fontSize: 9, color: DS.lo, marginTop: 2 }}>Last: {timeAgo(m.lastSync)}</div>
                                        </div>
                                        <div style={{
                                            width: 8, height: 8, borderRadius: "50%",
                                            background: statusColor,
                                            boxShadow: `0 0 6px ${statusColor}88`,
                                        }} />
                                    </div>
                                    <div style={{ display: "flex", gap: 12, marginBottom: 10, fontSize: 10, color: DS.mid }}>
                                        <span>Rows: <strong style={{ color: DS.hi }}>{m.lastRowCount}</strong></span>
                                        <span>Time: <strong style={{ color: DS.hi }}>{fmtDuration(m.lastDuration)}</strong></span>
                                    </div>
                                    {m.lastError && (
                                        <div style={{
                                            fontSize: 10, color: DS.rose, background: "rgba(244,63,94,0.08)",
                                            border: "1px solid rgba(244,63,94,0.2)", borderRadius: 6,
                                            padding: "6px 8px", marginBottom: 10, wordBreak: "break-word",
                                        }}>
                                            {m.lastError}
                                        </div>
                                    )}
                                    <button
                                        onClick={() => handleTrigger(m.module)}
                                        disabled={triggeringModule !== null || moduleActive}
                                        style={{
                                            width: "100%", fontSize: 11, fontWeight: 600,
                                            color: isTriggering || moduleActive ? DS.lo : DS.sky,
                                            background: isTriggering ? "rgba(56,189,248,0.06)" : "rgba(56,189,248,0.08)",
                                            border: `1px solid ${DS.sky}30`,
                                            borderRadius: 7, padding: "7px 0", cursor: triggeringModule ? "not-allowed" : "pointer",
                                            opacity: triggeringModule && !isTriggering ? 0.5 : 1,
                                        }}
                                    >
                                        {moduleActive ? "Already active" : isTriggering ? "Queueing..." : `Sync ${m.module}`}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </Card>
            )}

            <Card accent={activeTriggers.length ? DS.amber : DS.emerald}>
                <SH title="Active Syncs" sub={`${activeTriggers.length} active · ${allTriggers.length} recent commands`} />
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(activeTriggers.length ? activeTriggers : allTriggers.slice(0, 6)).map((trigger: SyncTriggerEntry) => {
                        const progress = Number(trigger.progress_percent ?? (trigger.status === "completed" ? 100 : 0));
                        const canCancel = ["pending", "picked"].includes(trigger.status);
                        return (
                            <div key={trigger.id} style={{ border: `1px solid ${DS.border}`, borderRadius: 10, padding: "10px 12px", background: "rgba(255,255,255,0.025)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                                    <div>
                                        <div style={{ color: DS.hi, fontWeight: 700, textTransform: "capitalize", fontSize: 13 }}>{trigger.module} · {trigger.sync_mode ?? trigger.syncMode ?? "incremental"}</div>
                                        <div style={{ color: DS.lo, fontSize: 10, marginTop: 3 }}>
                                            {trigger.status} {trigger.current_batch && trigger.total_batches ? `· batch ${trigger.current_batch}/${trigger.total_batches}` : ""} · rows {Number(trigger.rows_synced ?? 0).toLocaleString()}
                                        </div>
                                    </div>
                                    {canCancel && (
                                        <button
                                            onClick={() => cancelSync.mutate(trigger.id)}
                                            disabled={cancelSync.isPending}
                                            style={{ color: DS.rose, background: "rgba(244,63,94,0.08)", border: `1px solid ${DS.rose}44`, borderRadius: 7, padding: "6px 9px", fontSize: 10, fontWeight: 700 }}
                                        >
                                            Cancel
                                        </button>
                                    )}
                                </div>
                                <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.06)", marginTop: 9, overflow: "hidden" }}>
                                    <div style={{ width: `${Math.max(0, Math.min(100, progress))}%`, height: "100%", background: trigger.status === "failed" ? DS.rose : DS.sky }} />
                                </div>
                                {(trigger.error_message || trigger.result_message) && (
                                    <div style={{ color: trigger.error_message ? DS.rose : DS.lo, fontSize: 10, marginTop: 6 }}>{trigger.error_message || trigger.result_message}</div>
                                )}
                            </div>
                        );
                    })}
                    {!activeTriggers.length && !allTriggers.length && (
                        <div style={{ color: DS.lo, fontSize: 12 }}>No sync commands yet.</div>
                    )}
                </div>
            </Card>

            {/* Sync Logs Table */}
            <Card accent={DS.cyan}>
                <SH title="Sync Logs" sub={`${logTotal} total entries`}
                    right={
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{
                                width: 7, height: 7, borderRadius: "50%",
                                background: statusQ.isFetching ? DS.amber : DS.emerald,
                                boxShadow: `0 0 6px ${statusQ.isFetching ? DS.amber : DS.emerald}88`,
                            }} />
                            <span style={{ fontSize: 10, color: DS.lo }}>{statusQ.isFetching ? "Refreshing..." : "Live (15s)"}</span>
                        </div>
                    }
                />
                {logs.length === 0 ? (
                    <div style={{ padding: "32px 0", textAlign: "center", color: DS.lo, fontSize: 12 }}>
                        No sync logs yet — data will appear once the sync engine runs
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
                                            padding: "0 7px 10px", fontWeight: 500,
                                        }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map((l: SyncLogEntry) => {
                                    const c = STATUS_COLORS[l.status] ?? DS.lo;
                                    const hasError = l.status === "failed" && l.error_message;
                                    const isExpanded = expandedError === l.id;
                                    return (
                                        <tr key={l.id} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                                            <td style={{ padding: "10px 7px", fontSize: 12, color: DS.hi, fontWeight: 500, textTransform: "capitalize" }}>{l.module}</td>
                                            <td style={{ padding: "10px 7px" }}>
                                                <span style={{
                                                    fontSize: 10, padding: "2px 7px", borderRadius: 20, fontWeight: 600,
                                                    background: l.status === "ok" ? "rgba(16,185,129,0.12)"
                                                        : l.status === "failed" ? "rgba(244,63,94,0.12)"
                                                        : l.status === "running" ? "rgba(245,158,11,0.12)"
                                                        : "rgba(148,163,184,0.12)",
                                                    color: c,
                                                }}>{l.status.toUpperCase()}</span>
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
                                                    <button
                                                        onClick={() => setExpandedError(isExpanded ? null : l.id)}
                                                        style={{
                                                            fontSize: 9, color: DS.rose, background: "rgba(244,63,94,0.08)",
                                                            border: `1px solid ${DS.rose}30`, borderRadius: 4,
                                                            padding: "2px 6px", cursor: "pointer",
                                                        }}
                                                    >
                                                        {isExpanded ? "Hide" : "Error"}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>

                        {/* Expanded error detail */}
                        {expandedError && (() => {
                            const errLog = logs.find(l => l.id === expandedError);
                            if (!errLog?.error_message) return null;
                            return (
                                <div style={{
                                    margin: "8px 0", padding: "12px 14px",
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

                        {/* Pagination */}
                        {logTotal > 50 && (
                            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12 }}>
                                <button
                                    onClick={() => setLogPage(p => Math.max(1, p - 1))}
                                    disabled={logPage <= 1}
                                    style={{
                                        fontSize: 10, color: logPage <= 1 ? DS.lo : DS.sky,
                                        background: "rgba(56,189,248,0.06)", border: `1px solid ${DS.sky}30`,
                                        borderRadius: 6, padding: "4px 12px", cursor: logPage <= 1 ? "default" : "pointer",
                                    }}
                                >Prev</button>
                                <span style={{ fontSize: 10, color: DS.lo, padding: "4px 8px" }}>
                                    Page {logPage} of {Math.ceil(logTotal / 50)}
                                </span>
                                <button
                                    onClick={() => setLogPage(p => p + 1)}
                                    disabled={logPage * 50 >= logTotal}
                                    style={{
                                        fontSize: 10, color: logPage * 50 >= logTotal ? DS.lo : DS.sky,
                                        background: "rgba(56,189,248,0.06)", border: `1px solid ${DS.sky}30`,
                                        borderRadius: 6, padding: "4px 12px", cursor: logPage * 50 >= logTotal ? "default" : "pointer",
                                    }}
                                >Next</button>
                            </div>
                        )}
                    </>
                )}
            </Card>

            {/* Watermarks — current sync state per module */}
            <Card accent={DS.emerald}>
                <SH title="Sync Watermarks" sub="Current sync state per module" />
                {(status.watermarks ?? []).length === 0 ? (
                    <div style={{ padding: "24px 0", textAlign: "center", color: DS.lo, fontSize: 12 }}>
                        No watermarks yet — modules will appear after first sync
                    </div>
                ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
                        {(status.watermarks ?? []).map((w: any) => (
                            <div key={w.job_name} style={{
                                background: "rgba(255,255,255,0.02)", border: `1px solid ${DS.border}`,
                                borderRadius: 10, padding: "12px 14px",
                            }}>
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

            {/* Sync Key Info */}
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
