"use client";

import { useState } from "react";
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

    const status = statusQ.data ?? { logs: [], runs: [], watermarks: [], triggers: [], active_triggers: [], last_ingest_at: null, last_ingest_module: null, sync_key_prefix: null };
    const recentRuns = status.runs ?? status.logs ?? [];
    const activeTriggers = status.active_triggers ?? [];
    const allTriggers = status.triggers ?? [];
    const logs: SyncLogEntry[] = logsQ.data?.logs ?? [];
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
    // Average only over runs that actually reported a duration; unfinished runs
    // would otherwise be counted as 0ms and drag the average down.
    const timedRuns = recentRuns.filter((l: SyncLogEntry) => l.duration_ms != null);
    const avgLatency = averageRunLatencyMs(recentRuns);

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
                        <div style={{ fontSize: avgLatency == null ? 13 : 22, color: avgLatency == null ? DS.lo : DS.hi, fontFamily: DS.display }}>{fmtDuration(avgLatency, "Not available")}</div>
                        <div style={{ fontSize: 10, color: DS.lo, marginTop: 4 }}>{avgLatency == null ? "no completed runs yet" : `mean of ${timedRuns.length} completed run${timedRuns.length === 1 ? "" : "s"}`}</div>
                    </div>
                </Card>
            </div>

            <Card accent={healthColor(agent?.connection_status)}>
                <SH title="Sync Control Centre" sub="Real Windows service heartbeat and persisted remote command queue"
                    right={<span style={{ color: healthColor(agent?.connection_status),fontSize: 11,fontWeight: 700,textTransform: "capitalize" }}>
                        {controlStatus.isError ? "Unavailable" : syncAgentStatusLabel(agent?.connection_status)}
                    </span>} />
                {controlStatus.isLoading ? (
                    <div style={{ color: DS.lo,padding: 12 }}>Loading real engine status…</div>
                ) : controlStatus.isError ? (
                    <div style={{ color: DS.rose,padding: 12 }}>Sync Control API unavailable. Existing data synchronization remains separate.</div>
                ) : !agent ? (
                    <div style={{ color: DS.amber,padding: 12 }}>Never connected — install or start the configured Windows service.</div>
                ) : (
                    <>
                        <div style={{ display: "grid",gridTemplateColumns: "repeat(4,1fr)",gap: 10 }}>
                            {[
                                ["Agent",agent.display_name || agent.agent_id,DS.hi],
                                ["Last heartbeat",timeAgo(agent.last_heartbeat_at ?? null),healthColor(agent.connection_status)],
                                ["Machine",agent.machine_name || "Not available",DS.hi],
                                ["Version",agent.service_version || "Not available",DS.hi],
                                ["Build",agent.git_sha || "Not available",DS.mid],
                                ["Scheduler",agent.scheduler_state || "Not available",healthColor(agent.scheduler_state)],
                                ["JTL",agent.jtl_connection_status || "Not available",healthColor(agent.jtl_connection_status)],
                                ["Backend",agent.backend_connection_status || "Not available",healthColor(agent.backend_connection_status)],
                                ["Current job",agent.current_job || "Idle",agent.current_job ? DS.amber : DS.emerald],
                                ["Last successful sync",timeAgo(agent.last_successful_sync_at ?? null),DS.emerald],
                                ["Next scheduled sync",agent.next_scheduled_sync_at ? new Date(agent.next_scheduled_sync_at).toLocaleString() : "Not available",DS.sky],
                                ["Control state",controlCommandsEnabled ? "Enabled" : "Read-only rollout",controlCommandsEnabled ? DS.emerald : DS.amber],
                            ].map(([label,value,color]) => (
                                <div key={String(label)} style={{ border: `1px solid ${DS.border}`,borderRadius: 9,padding: "10px 12px",background: "rgba(255,255,255,.02)" }}>
                                    <div style={{ color: DS.lo,fontSize: 9,textTransform: "uppercase",marginBottom: 5 }}>{label}</div>
                                    <div style={{ color,fontSize: 12,fontWeight: 700,wordBreak: "break-word" }}>{value}</div>
                                </div>
                            ))}
                        </div>
                        {["offline","degraded"].includes(agent.connection_status) && (
                            <div style={{ color: DS.amber,marginTop: 10,fontSize: 11 }}>
                                Engine is {agent.connection_status}. Commands remain queued until it reconnects.
                            </div>
                        )}
                        {canManageSync && (
                            <div style={{ display: "flex",gap: 8,flexWrap: "wrap",marginTop: 12 }}>
                                {[
                                    ["Run Incremental","SYNC_ALL_INCREMENTAL"],
                                    ["Diagnostics","RUN_DIAGNOSTICS"],
                                    ["Test JTL","TEST_JTL_CONNECTION"],
                                    ["Test Backend","TEST_BACKEND_CONNECTION"],
                                    [agent.scheduler_state === "paused" ? "Resume Scheduler" : "Pause Scheduler",
                                        agent.scheduler_state === "paused" ? "RESUME_SCHEDULER" : "PAUSE_SCHEDULER"],
                                ].map(([label,type]) => (
                                    <button key={type} onClick={() => queueCommand(type)}
                                        disabled={!controlCommandsEnabled || createCommand.isPending}
                                        style={{ padding: "7px 10px",borderRadius: 7,border: `1px solid ${DS.sky}44`,
                                            background: "rgba(56,189,248,.08)",color: controlCommandsEnabled ? DS.sky : DS.lo,
                                            cursor: controlCommandsEnabled ? "pointer" : "not-allowed",fontSize: 10,fontWeight: 700 }}>
                                        {label}
                                    </button>
                                ))}
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
                                            style={{ color: DS.rose,border: `1px solid ${DS.rose}44`,background: "rgba(244,63,94,.08)",borderRadius: 7,padding: "6px 9px" }}>
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
                            <div style={{ marginTop: 12 }}>
                                <div style={{ color: DS.lo,fontSize: 9,textTransform: "uppercase",marginBottom: 6 }}>Recent command history</div>
                                {control.commands.slice(0,6).map((command: SyncControlCommand) => (
                                    <div key={command.id} style={{ display: "grid",gridTemplateColumns: "2fr 1fr 1fr 1fr",gap: 8,
                                        borderTop: `1px solid ${DS.border}`,padding: "7px 0",fontSize: 10 }}>
                                        <span style={{ color: DS.hi }}>{command.command_type}</span>
                                        <span style={{ color: healthColor(command.status) }}>{command.status}</span>
                                        <span style={{ color: DS.mid }}>{command.requested_by_name || "System"}</span>
                                        <span style={{ color: DS.lo }}>{timeAgo(command.created_at)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </Card>

            {updatesEnabled && agent && agent.capabilities?.safeUpdate === true && (
                <Card accent={DS.violet}>
                    <SH title="Sync Engine Updates"
                        sub="Signed, tenant-scoped in-place updates with automatic health verification and rollback"
                        right={<button onClick={() => updateQ.refetch()}
                            style={{ color: DS.sky,border: `1px solid ${DS.sky}44`,background: "transparent",borderRadius: 7,padding: "6px 9px" }}>
                            Check for update
                        </button>} />
                    {updateQ.isError ? (
                        <div style={{ color: DS.rose,padding: 10 }}>Update status is unavailable.</div>
                    ) : (
                        <>
                            <div style={{ display: "grid",gridTemplateColumns: "repeat(4,1fr)",gap: 10 }}>
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
                                    <div key={label} style={{ border: `1px solid ${DS.border}`,borderRadius: 9,padding: "10px 12px" }}>
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
                                            style={{ color: DS.violet,border: `1px solid ${DS.violet}66`,background: `${DS.violet}14`,borderRadius: 7,padding: "7px 10px" }}>
                                            Download & install in maintenance window
                                        </button>
                                        <button onClick={() => window.confirm("Install the signed update as soon as the service reaches a safe boundary?") && queueUpdate("now")}
                                            disabled={requestUpdate.isPending || !!agent.current_job}
                                            style={{ color: DS.amber,border: `1px solid ${DS.amber}66`,background: `${DS.amber}14`,borderRadius: 7,padding: "7px 10px" }}>
                                            Install now, when safe
                                        </button>
                                    </>
                                )}
                                {canUpdateAgent && activeUpdate &&
                                    ["requested","approved","claimed","downloading","verifying","staged","waiting_for_window"].includes(activeUpdate.status) && (
                                    <button onClick={() => cancelUpdate.mutate(activeUpdate.id)}
                                        disabled={cancelUpdate.isPending}
                                        style={{ color: DS.rose,border: `1px solid ${DS.rose}66`,background: `${DS.rose}14`,borderRadius: 7,padding: "7px 10px" }}>
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
                </Card>
            )}

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
                                        <span>Rows: <strong style={{ color: DS.hi }}>{m.lastRowCount == null ? "—" : Number(m.lastRowCount).toLocaleString()}</strong></span>
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
                        const progress = hasRealProgress(trigger.progress_percent) ? Number(trigger.progress_percent) : null;
                        const canCancel = ["pending", "picked"].includes(trigger.status);
                        return (
                            <div key={trigger.id} style={{ border: `1px solid ${DS.border}`, borderRadius: 10, padding: "10px 12px", background: "rgba(255,255,255,0.025)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                                    <div>
                                        <div style={{ color: DS.hi, fontWeight: 700, textTransform: "capitalize", fontSize: 13 }}>{trigger.module} · {trigger.sync_mode ?? trigger.syncMode ?? "incremental"}</div>
                                        <div style={{ color: DS.lo, fontSize: 10, marginTop: 3 }}>
                                            {trigger.status} {trigger.current_batch && trigger.total_batches ? `· batch ${trigger.current_batch}/${trigger.total_batches}` : ""} · {trigger.rows_synced == null ? "rows not reported" : `rows ${Number(trigger.rows_synced).toLocaleString()}`}
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
