"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { DS } from "@/lib/design-system";
import { useStore } from "@/lib/store";
import {
  LogsFilters,
  LogsTab,
  useLogDetail,
  useLogs,
  useLogsExport,
  useLogsSummary,
  useRelatedEvents,
} from "@/hooks/useLogsData";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";

const INITIAL_FILTERS: LogsFilters = { page: 1,limit: 50,sortBy: "occurredAt",sortDirection: "desc" };
const inputStyle = { background: "#090d18",border: `1px solid ${DS.border}`,borderRadius: 8,
  padding: "8px 9px",color: DS.hi,fontSize: 11,minWidth: 120 };
const buttonStyle = { ...inputStyle,cursor: "pointer",minWidth: 0 };

export default function LogsPage() {
  const can = useStore((state) => state.can);
  const featureFlags = useFeatureFlags();
  const currentCompany = useStore((state) => state.currentCompany);
  const tenantScope = useStore((state) => state.tenantScope);
  const permitted = can("logs");
  const uiEnabled = featureFlags.data?.SYSTEM_LOGS_UI_ENABLED === true;
  const allowed = permitted && uiEnabled;
  const [tab,setTab] = useState<LogsTab>("live");
  const [draft,setDraft] = useState<LogsFilters>(INITIAL_FILTERS);
  const [filters,setFilters] = useState<LogsFilters>(INITIAL_FILTERS);
  const [selectedId,setSelectedId] = useState<string|null>(null);
  const summary = useLogsSummary(filters,allowed);
  const events = useLogs(tab,filters,allowed);
  const detail = useLogDetail(selectedId,allowed && tab !== "audit");
  const related = useRelatedEvents(selectedId,allowed && tab !== "audit");
  const exportLogs = useLogsExport();
  const payload = events.data as { data?: any[];pagination?: { page: number;total: number;totalPages?: number };
    dataFreshness?: { generatedAt: string } } | undefined;
  const rows = payload?.data ?? [];
  const totals = summary.data as Record<string,any> | undefined;
  const updated = payload?.dataFreshness?.generatedAt || totals?.dataFreshness?.generatedAt;
  const summaryCards = useMemo(() => [
    ["Errors · 24h",totals?.errorsLast24Hours ?? "—",DS.rose],
    ["Warnings · 24h",totals?.warningsLast24Hours ?? "—",DS.amber],
    ["Failed syncs",totals?.failedSyncsLast24Hours ?? "—",DS.rose],
    ["Active engines",totals?.activeAgents ?? "—",DS.emerald],
    ["Access denials",totals?.accessDenialsLast24Hours ?? "—",DS.violet],
    ["Offline engines",totals?.offlineAgents ?? "—",DS.lo],
  ],[totals]);

  if (!permitted) return <Card accent={DS.rose}><SectionHeader title="403 Access Denied"
    sub="You do not have permission to view System Logs" /></Card>;
  if (featureFlags.isLoading) return <Card><SectionHeader title="System Logs" sub="Checking feature availability…" /></Card>;
  if (!uiEnabled) return <Card accent={DS.amber}><SectionHeader title="System Logs Unavailable"
    sub="The System Logs UI feature is disabled" /></Card>;

  const setField = (field: keyof LogsFilters,value: string) =>
    setDraft((current) => ({ ...current,[field]: value || undefined,page: 1 }));
  const switchTab = (next: LogsTab) => { setTab(next);setSelectedId(null);setFilters((v) => ({ ...v,page: 1 })); };

  return <div style={{ display: "flex",flexDirection: "column",gap: 14 }}>
    <Card accent={DS.sky}>
      <SectionHeader title="System Logs"
        sub="Operational activity, audit history, sync events, and security events"
        right={<div style={{ color: DS.lo,fontSize: 10 }}>
          {updated ? `Updated ${timeAgo(updated)}` : "Waiting for real API data"}
        </div>} />
      <div style={{ display: "grid",gridTemplateColumns: "repeat(6,1fr)",gap: 10 }}>
        {summaryCards.map(([label,value,color]) => <div key={String(label)}
          style={{ border: `1px solid ${DS.border}`,borderTopColor: String(color),borderRadius: 10,padding: 12 }}>
          <div style={{ color: DS.lo,fontSize: 9,textTransform: "uppercase" }}>{label}</div>
          <div style={{ color: String(color),fontSize: 22,marginTop: 5 }}>{String(value)}</div>
        </div>)}
      </div>
      {totals?.lastCriticalEvent && <div style={{ marginTop: 10,color: DS.rose,fontSize: 11 }}>
        Last critical: {totals.lastCriticalEvent.message}
      </div>}
    </Card>

    <Card>
      <div style={{ display: "flex",gap: 8,marginBottom: 14 }}>
        {(["live","sync","audit","errors","security","infrastructure"] as LogsTab[]).map((item) =>
          <button key={item} onClick={() => switchTab(item)} style={{
            ...buttonStyle,color: tab === item ? DS.sky : DS.mid,
            borderColor: tab === item ? DS.sky : DS.border,textTransform: "capitalize",
          }}>{item === "live" ? "Live Activity" : `${item} Logs`}</button>)}
        <span style={{ marginLeft: "auto",...inputStyle,color: DS.mid }}>
          Company: {tenantScope === "all" ? "All Companies" : currentCompany?.name ?? "Selected context"}
        </span>
      </div>
      <div style={{ display: "grid",gridTemplateColumns: "repeat(5,minmax(120px,1fr))",gap: 8 }}>
        <input type="datetime-local" value={draft.from || ""} onChange={(e) => setField("from",e.target.value)}
          aria-label="From" style={inputStyle} />
        <input type="datetime-local" value={draft.to || ""} onChange={(e) => setField("to",e.target.value)}
          aria-label="To" style={inputStyle} />
        <select value={draft.source || ""} onChange={(e) => setField("source",e.target.value)} style={inputStyle}>
          <option value="">All sources</option><option value="backend">Backend</option>
          <option value="sync-engine">Sync Engine</option><option value="windows-service">Windows Service</option>
          <option value="authentication">Authentication</option><option value="admin">Admin</option>
          <option value="database">Database</option><option value="redis">Redis</option>
        </select>
        <select value={draft.severity || ""} onChange={(e) => setField("severity",e.target.value)} style={inputStyle}>
          <option value="">All severity</option><option value="debug">Debug</option><option value="info">Info</option>
          <option value="warning">Warning</option><option value="error">Error</option><option value="critical">Critical</option>
        </select>
        <input placeholder="Module" value={draft.module || ""} onChange={(e) => setField("module",e.target.value)} style={inputStyle} />
        <input placeholder="Status" value={draft.status || ""} onChange={(e) => setField("status",e.target.value)} style={inputStyle} />
        <input placeholder="Event type" value={draft.eventType || ""} onChange={(e) => setField("eventType",e.target.value)} style={inputStyle} />
        <input placeholder="Agent ID" value={draft.agentId || ""} onChange={(e) => setField("agentId",e.target.value)} style={inputStyle} />
        <input placeholder="Correlation ID" value={draft.correlationId || ""} onChange={(e) => setField("correlationId",e.target.value)} style={inputStyle} />
        <input placeholder="Search messages" value={draft.search || ""} onChange={(e) => setField("search",e.target.value)} style={inputStyle} />
        <input placeholder="User UUID" value={draft.actorUserId || ""} onChange={(e) => setField("actorUserId",e.target.value)} style={inputStyle} />
        <input placeholder="Sync Run UUID" value={draft.syncRunId || ""} onChange={(e) => setField("syncRunId",e.target.value)} style={inputStyle} />
        <input placeholder="Command UUID" value={draft.commandId || ""} onChange={(e) => setField("commandId",e.target.value)} style={inputStyle} />
      </div>
      <div style={{ display: "flex",gap: 8,marginTop: 10 }}>
        <button style={buttonStyle} onClick={() => setFilters({ ...draft,page: 1 })}>Apply</button>
        <button style={buttonStyle} onClick={() => { setDraft(INITIAL_FILTERS);setFilters(INITIAL_FILTERS); }}>Clear</button>
        <button style={buttonStyle} onClick={() => { void events.refetch();void summary.refetch(); }}>Refresh</button>
        <button style={buttonStyle} disabled={exportLogs.isPending}
          onClick={() => exportLogs.mutate({ filters,format: "csv" })}>
          {exportLogs.isPending ? "Exporting…" : "Export CSV"}
        </button>
      </div>
    </Card>

    <Card>
      {events.isLoading && <p style={{ color: DS.mid }}>Loading persisted events…</p>}
      {events.isError && <p style={{ color: DS.rose }}>
        {(events.error as any)?.response?.status === 403 ? "403 Access Denied" : "Logs unavailable or feature disabled."}
      </p>}
      {!events.isLoading && !events.isError && rows.length === 0 &&
        <p style={{ color: DS.lo }}>No matching events.</p>}
      {rows.length > 0 && <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 1100 }}>
          <div style={{ display: "grid",gridTemplateColumns: "145px 75px 130px 120px 110px 180px 1fr 90px",
            gap: 10,padding: "8px 0",color: DS.lo,fontSize: 9,textTransform: "uppercase" }}>
            {["Time","Severity","Company","Source","Module","Event","Message","Details"].map((title) => <span key={title}>{title}</span>)}
          </div>
          {rows.map((row) => <div key={row.id} style={{ display: "grid",
            gridTemplateColumns: "145px 75px 130px 120px 110px 180px 1fr 90px",gap: 10,
            padding: "10px 0",borderTop: `1px solid ${DS.border}`,fontSize: 10,alignItems: "center" }}>
            <span style={{ color: DS.lo }}>{formatTime(row.occurred_at ?? row.at)}</span>
            <span style={{ color: severityColor(row.severity),fontWeight: 700 }}>{row.severity ?? row.outcome ?? "audit"}</span>
            <span style={{ color: DS.mid }}>{row.tenant_name ?? row.tenantName ?? "Platform"}</span>
            <span style={{ color: DS.mid }}>{row.source ?? "audit"}</span>
            <span style={{ color: DS.mid }}>{row.module ?? "—"}</span>
            <span style={{ color: DS.sky }}>{row.event_type ?? row.action}</span>
            <span style={{ color: DS.hi,overflow: "hidden",textOverflow: "ellipsis",whiteSpace: "nowrap" }}>
              {row.message ?? row.reason ?? row.action}
            </span>
            <button style={buttonStyle} onClick={() => setSelectedId(tab === "audit" ? null : String(row.id))}>
              {tab === "audit" ? "Audit" : "Open"}
            </button>
          </div>)}
        </div>
      </div>}
      <div style={{ display: "flex",gap: 8,alignItems: "center",marginTop: 14 }}>
        <button style={buttonStyle} disabled={filters.page === 1}
          onClick={() => setFilters((v) => ({ ...v,page: v.page-1 }))}>Previous</button>
        <span style={{ color: DS.lo,fontSize: 10 }}>Page {filters.page} · {payload?.pagination?.total ?? 0} records</span>
        <button style={buttonStyle} disabled={filters.page >= (payload?.pagination?.totalPages ?? Math.ceil((payload?.pagination?.total ?? 0)/filters.limit))}
          onClick={() => setFilters((v) => ({ ...v,page: v.page+1 }))}>Next</button>
      </div>
    </Card>

    {selectedId && <LogDrawer data={detail.data} related={(related.data as any[]) ?? []}
      loading={detail.isLoading} onClose={() => setSelectedId(null)} />}
  </div>;
}

function LogDrawer({ data,related,loading,onClose }: { data: any;related: any[];loading: boolean;onClose: () => void }) {
  return <div style={{ position: "fixed",inset: 0,background: "rgba(0,0,0,.55)",zIndex: 1000 }}
    onClick={onClose}>
    <aside onClick={(e) => e.stopPropagation()} style={{ position: "absolute",right: 0,top: 0,bottom: 0,
      width: "min(620px,90vw)",background: "#080c16",borderLeft: `1px solid ${DS.border}`,padding: 24,overflowY: "auto" }}>
      <button onClick={onClose} style={{ ...buttonStyle,float: "right" }}>Close</button>
      <h2 style={{ color: DS.hi,fontFamily: DS.display }}>Event Details</h2>
      {loading ? <p style={{ color: DS.mid }}>Loading…</p> : <>
        {Object.entries({
          "Event ID": data?.id,"Occurred": formatTime(data?.occurred_at),"Received": formatTime(data?.created_at),
          "Severity": data?.severity,"Company": data?.tenant_name,"Source": data?.source,"Module": data?.module,
          "Event": data?.event_type,"Status": data?.status,"Actor": data?.actor_name || data?.actor_user_id,
          "Agent": data?.agent_id,"Correlation ID": data?.correlation_id,"Request ID": data?.request_id,
          "Sync Run ID": data?.sync_run_id,"Command ID": data?.command_id,"Rows": data?.rows_processed,
          "Duration ms": data?.duration_ms,"Version": data?.service_version,"Git SHA": data?.git_sha,
        }).map(([label,value]) => value != null && <div key={label} style={{ display: "grid",gridTemplateColumns: "130px 1fr",
          padding: "6px 0",borderBottom: `1px solid ${DS.border}`,fontSize: 11 }}>
          <span style={{ color: DS.lo }}>{label}</span><span style={{ color: DS.hi,wordBreak: "break-all" }}>{String(value)}</span>
        </div>)}
        <h3 style={{ color: DS.hi }}>Message</h3><p style={{ color: DS.mid }}>{data?.message}</p>
        <h3 style={{ color: DS.hi }}>Sanitised Metadata</h3>
        <pre style={{ color: DS.mid,fontSize: 10,whiteSpace: "pre-wrap",wordBreak: "break-word" }}>
          {JSON.stringify(data?.metadata ?? {},null,2)}
        </pre>
        <h3 style={{ color: DS.hi }}>Related Events</h3>
        {related.length === 0 ? <p style={{ color: DS.lo }}>No correlated events.</p> :
          related.map((event) => <div key={event.id} style={{ borderLeft: `2px solid ${severityColor(event.severity)}`,
            padding: "7px 10px",marginBottom: 6,color: DS.mid,fontSize: 10 }}>
            {formatTime(event.occurred_at)} · {event.event_type} · {event.message}
          </div>)}
      </>}
    </aside>
  </div>;
}

function formatTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}
function timeAgo(value: string) {
  const seconds = Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds/60)}m ago`;
  return `${Math.floor(seconds/3600)}h ago`;
}
function severityColor(value: string) {
  if (value === "critical" || value === "error") return DS.rose;
  if (value === "warning") return DS.amber;
  if (value === "info") return DS.sky;
  return DS.lo;
}
