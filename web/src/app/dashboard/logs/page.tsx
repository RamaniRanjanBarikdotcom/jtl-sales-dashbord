"use client";

import { Fragment, useMemo, useState } from "react";
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

const TABS: { id: LogsTab; label: string; hint: string }[] = [
  { id: "live",           label: "Live Activity",  hint: "All recent events, unfiltered" },
  { id: "sync",           label: "Sync",           hint: "Sync engine events" },
  { id: "audit",          label: "Audit",          hint: "Who changed what" },
  { id: "errors",         label: "Errors",         hint: "Errors and critical events" },
  { id: "security",       label: "Security",       hint: "Auth and access events" },
  { id: "infrastructure", label: "Infrastructure", hint: "Database, cache, deployment" },
];

// The audit endpoint accepts these and silently ignores them — listAudit only
// filters on from/to/actorUserId/eventType/correlationId/search. Rather than
// removing the inputs, we disable them on that tab so nobody types into a
// control that does nothing.
const AUDIT_IGNORED = new Set([
  "source","severity","module","status","agentId","syncRunId","commandId","sortBy",
]);

// Only these four are whitelisted for ORDER BY on the backend.
const SORTABLE: Record<string,{ key: string; label: string }> = {
  Time:     { key: "occurredAt",    label: "Time" },
  Severity: { key: "severity",      label: "Severity" },
  Duration: { key: "durationMs",    label: "Duration" },
  Rows:     { key: "rowsProcessed", label: "Rows" },
};

const FILTER_LABELS: Record<string,string> = {
  from: "From", to: "To", source: "Source", severity: "Severity", module: "Module",
  status: "Status", eventType: "Event type", agentId: "Agent", correlationId: "Correlation",
  search: "Search", actorUserId: "User", syncRunId: "Sync run", commandId: "Command",
};

export default function LogsPage() {
  const can = useStore((state) => state.can);
  const featureFlags = useFeatureFlags();
  const currentCompany = useStore((state) => state.currentCompany);
  const tenantScope = useStore((state) => state.tenantScope);
  const permitted = can("logs");
  const uiEnabled = featureFlags.data?.SYSTEM_LOGS_UI_ENABLED === true;
  const exportEnabled = featureFlags.data?.SYSTEM_LOGS_EXPORT_ENABLED === true;
  const securityTabEnabled = featureFlags.data?.SYSTEM_LOGS_SECURITY_TAB_ENABLED === true;
  const allowed = permitted && uiEnabled;
  const [tab,setTab] = useState<LogsTab>("live");
  const [draft,setDraft] = useState<LogsFilters>(INITIAL_FILTERS);
  const [filters,setFilters] = useState<LogsFilters>(INITIAL_FILTERS);
  const [selectedId,setSelectedId] = useState<string|null>(null);
  const [expandedAudit,setExpandedAudit] = useState<string|null>(null);
  const [filtersOpen,setFiltersOpen] = useState(false);
  const [exportFormat,setExportFormat] = useState<"csv"|"json">("csv");
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
  const isAudit = tab === "audit";

  const summaryCards = useMemo(() => [
    ["Errors",totals?.errorsLast24Hours,DS.rose],
    ["Warnings",totals?.warningsLast24Hours,DS.amber],
    ["Failed syncs",totals?.failedSyncsLast24Hours,DS.rose],
    ["Access denials",totals?.accessDenialsLast24Hours,DS.violet],
    ["Active engines",totals?.activeAgents,DS.emerald],
    ["Offline engines",totals?.offlineAgents,DS.lo],
  ] as const,[totals]);

  // Which filters are actually applied right now — drives the chips and the badge.
  const activeFilters = useMemo(() => Object.entries(filters).filter(([key,value]) =>
    !["page","limit","sortBy","sortDirection"].includes(key) && value !== undefined && value !== ""
  ) as [string,string][],[filters]);

  if (!permitted) return <Card accent={DS.rose}><SectionHeader title="403 Access Denied"
    sub="You do not have permission to view System Logs" /></Card>;
  if (featureFlags.isLoading) return <Card><SectionHeader title="System Logs" sub="Checking feature availability…" /></Card>;
  if (!uiEnabled) return <Card accent={DS.amber}><SectionHeader title="System Logs Unavailable"
    sub="The System Logs UI feature is disabled" /></Card>;

  const setField = (field: keyof LogsFilters,value: string) =>
    setDraft((current) => ({ ...current,[field]: value || undefined,page: 1 }));
  const switchTab = (next: LogsTab) => {
    setTab(next);setSelectedId(null);setExpandedAudit(null);
    setFilters((v) => ({ ...v,page: 1 }));
  };
  const applyFilters = () => { setFilters({ ...draft,page: 1 });setFiltersOpen(false); };
  const clearFilters = () => { setDraft(INITIAL_FILTERS);setFilters(INITIAL_FILTERS); };
  const removeFilter = (key: string) => {
    setDraft((v) => ({ ...v,[key]: undefined }));
    setFilters((v) => ({ ...v,[key]: undefined,page: 1 }));
  };
  const toggleSort = (column: string) => {
    const sortKey = SORTABLE[column]?.key;
    if (!sortKey || isAudit) return;
    setFilters((v) => ({
      ...v,
      sortBy: sortKey,
      sortDirection: v.sortBy === sortKey && v.sortDirection === "desc" ? "asc" : "desc",
      page: 1,
    }));
  };

  const disabledOn = (field: string) => isAudit && AUDIT_IGNORED.has(field);
  const totalPages = payload?.pagination?.totalPages
    ?? Math.max(1,Math.ceil((payload?.pagination?.total ?? 0)/filters.limit));
  const errStatus = (events.error as any)?.response?.status;

  return <div style={{ display: "flex",flexDirection: "column",gap: 16 }}>

    {/* ── Header band ── */}
    <Card accent={DS.sky}>
      <SectionHeader title="System Logs"
        sub="Operational activity, audit history, sync events, and security events"
        right={<div style={{ display: "flex",alignItems: "center",gap: 10 }}>
          <span style={{ display: "inline-flex",alignItems: "center",gap: 5,fontSize: 10,color: DS.lo }}>
            <span style={{ width: 6,height: 6,borderRadius: "50%",
              background: events.isFetching ? DS.amber : DS.emerald,
              boxShadow: `0 0 5px ${events.isFetching ? DS.amber : DS.emerald}88` }} />
            {events.isFetching ? "Refreshing" : "Live"}
          </span>
          <span style={{ color: DS.lo,fontSize: 10 }}>
            {updated ? `Updated ${timeAgo(updated)}` : "Awaiting data"}
          </span>
        </div>} />

      <div style={{ fontSize: 9,color: DS.lo,textTransform: "uppercase",letterSpacing: "0.1em",marginBottom: 9 }}>
        Last 24 hours · fixed window, not affected by the date filter
      </div>
      <div style={{ display: "grid",gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",gap: 10 }}>
        {summaryCards.map(([label,value,color]) => {
          const empty = value == null || Number(value) === 0;
          return <div key={label} style={{
            border: `1px solid ${DS.border}`,borderTop: `2px solid ${empty ? DS.border : color}`,
            borderRadius: 10,padding: "12px 14px",background: "rgba(255,255,255,0.02)",
          }}>
            <div style={{ color: DS.lo,fontSize: 9,textTransform: "uppercase",letterSpacing: "0.07em" }}>{label}</div>
            <div style={{ color: empty ? DS.lo : color,fontSize: 24,marginTop: 5,fontFamily: DS.display }}>
              {value ?? "—"}
            </div>
          </div>;
        })}
      </div>

      {totals?.lastCriticalEvent && <button
        onClick={() => { switchTab("errors");setSelectedId(String(totals.lastCriticalEvent.id)); }}
        style={{
          marginTop: 12,width: "100%",textAlign: "left",cursor: "pointer",
          border: `1px solid ${DS.rose}33`,background: "rgba(244,63,94,0.07)",
          borderRadius: 9,padding: "10px 12px",fontFamily: "inherit",
        }}>
        <div style={{ color: DS.lo,fontSize: 9,textTransform: "uppercase",letterSpacing: "0.07em",marginBottom: 3 }}>
          Most recent critical event · {formatTime(totals.lastCriticalEvent.occurred_at)}
        </div>
        <div style={{ color: DS.rose,fontSize: 12 }}>{totals.lastCriticalEvent.message}</div>
      </button>}
    </Card>

    {/* ── Control band ── */}
    <Card>
      <div style={{ display: "flex",gap: 10,alignItems: "center",flexWrap: "wrap",marginBottom: 12 }}>
        <div style={{ display: "flex",gap: 2,padding: 4,background: DS.surface,
          border: `1px solid ${DS.border}`,borderRadius: 11 }}>
          {TABS.map((item) => {
            const active = tab === item.id;
            const blocked = item.id === "security" && !securityTabEnabled;
            return <button key={item.id} onClick={() => switchTab(item.id)}
              title={blocked ? "The security log tab is disabled on this platform" : item.hint}
              style={{
                padding: "7px 14px",borderRadius: 8,border: "none",fontFamily: "inherit",
                background: active ? "rgba(56,189,248,0.12)" : "transparent",
                color: active ? DS.sky : blocked ? DS.lo : DS.mid,
                fontSize: 12,fontWeight: active ? 600 : 400,cursor: "pointer",
                boxShadow: active ? `inset 0 -2px 0 ${DS.sky}` : "none",
              }}>{item.label}</button>;
          })}
        </div>

        <button onClick={() => setFiltersOpen((v) => !v)} style={{
          ...ctlStyle,display: "flex",alignItems: "center",gap: 7,
          borderColor: activeFilters.length ? DS.sky : DS.border,
          color: activeFilters.length ? DS.sky : DS.mid,
        }}>
          Filters {activeFilters.length > 0 && <span style={{
            background: DS.sky,color: "#04121f",borderRadius: 20,
            padding: "1px 7px",fontSize: 10,fontWeight: 700,
          }}>{activeFilters.length}</span>}
          <span style={{ fontSize: 9 }}>{filtersOpen ? "▲" : "▼"}</span>
        </button>

        <span style={{ marginLeft: "auto",fontSize: 11,color: DS.mid }}>
          {tenantScope === "all" ? "All Companies" : currentCompany?.name ?? "Selected context"}
        </span>
      </div>

      {/* Applied-filter chips */}
      {activeFilters.length > 0 && <div style={{ display: "flex",gap: 6,flexWrap: "wrap",marginBottom: 12 }}>
        {activeFilters.map(([key,value]) => <span key={key} style={{
          display: "inline-flex",alignItems: "center",gap: 6,fontSize: 10,
          background: "rgba(56,189,248,0.09)",border: `1px solid ${DS.sky}33`,
          borderRadius: 20,padding: "4px 6px 4px 10px",color: DS.hi,
        }}>
          <span style={{ color: DS.lo }}>{FILTER_LABELS[key] ?? key}:</span>
          <span style={{ maxWidth: 160,overflow: "hidden",textOverflow: "ellipsis",whiteSpace: "nowrap" }}>
            {key === "from" || key === "to" ? formatTime(value) : value}
          </span>
          <button onClick={() => removeFilter(key)} aria-label={`Remove ${key} filter`} style={{
            border: "none",background: "transparent",color: DS.mid,cursor: "pointer",
            fontSize: 12,lineHeight: 1,padding: "0 2px",
          }}>×</button>
        </span>)}
        <button onClick={clearFilters} style={{ ...ctlStyle,padding: "3px 10px",fontSize: 10 }}>Clear all</button>
      </div>}

      {filtersOpen && <div style={{
        border: `1px solid ${DS.border}`,borderRadius: 12,padding: 16,
        background: "rgba(255,255,255,0.015)",marginBottom: 12,
      }}>
        {isAudit && <div style={{
          fontSize: 11,color: DS.amber,background: "rgba(245,158,11,0.08)",
          border: `1px solid ${DS.amber}33`,borderRadius: 8,padding: "8px 11px",marginBottom: 14,
        }}>
          Audit records support only time, user, action, correlation ID and search.
          The remaining filters stay visible but are inactive on this tab.
        </div>}

        <FilterGroup title="Time range">
          <Labelled label="From">
            <input type="datetime-local" value={draft.from || ""} onChange={(e) => setField("from",e.target.value)}
              aria-label="From" style={inputStyle} />
          </Labelled>
          <Labelled label="To">
            <input type="datetime-local" value={draft.to || ""} onChange={(e) => setField("to",e.target.value)}
              aria-label="To" style={inputStyle} />
          </Labelled>
        </FilterGroup>

        <FilterGroup title="Classification">
          <Labelled label="Source" disabled={disabledOn("source")}>
            <select value={draft.source || ""} onChange={(e) => setField("source",e.target.value)}
              disabled={disabledOn("source")} style={fieldStyle(disabledOn("source"))}>
              <option value="">All sources</option><option value="backend">Backend</option>
              <option value="sync-engine">Sync Engine</option><option value="windows-service">Windows Service</option>
              <option value="authentication">Authentication</option><option value="admin">Admin</option>
              <option value="database">Database</option><option value="redis">Redis</option>
            </select>
          </Labelled>
          <Labelled label="Severity" disabled={disabledOn("severity")}>
            <select value={draft.severity || ""} onChange={(e) => setField("severity",e.target.value)}
              disabled={disabledOn("severity")} style={fieldStyle(disabledOn("severity"))}>
              <option value="">All severity</option><option value="debug">Debug</option><option value="info">Info</option>
              <option value="warning">Warning</option><option value="error">Error</option><option value="critical">Critical</option>
            </select>
          </Labelled>
          <Labelled label="Module" disabled={disabledOn("module")}>
            <input placeholder="e.g. orders" value={draft.module || ""} disabled={disabledOn("module")}
              onChange={(e) => setField("module",e.target.value)} style={fieldStyle(disabledOn("module"))} />
          </Labelled>
          <Labelled label="Status" disabled={disabledOn("status")}>
            <input placeholder="e.g. failed" value={draft.status || ""} disabled={disabledOn("status")}
              onChange={(e) => setField("status",e.target.value)} style={fieldStyle(disabledOn("status"))} />
          </Labelled>
          <Labelled label={isAudit ? "Action (exact match)" : "Event type"}>
            <input placeholder={isAudit ? "e.g. user.updated" : "e.g. sync.completed"} value={draft.eventType || ""}
              onChange={(e) => setField("eventType",e.target.value)} style={inputStyle} />
          </Labelled>
        </FilterGroup>

        <FilterGroup title="Identifiers">
          <Labelled label="Agent ID" disabled={disabledOn("agentId")}>
            <input placeholder="Agent ID" value={draft.agentId || ""} disabled={disabledOn("agentId")}
              onChange={(e) => setField("agentId",e.target.value)} style={fieldStyle(disabledOn("agentId"))} />
          </Labelled>
          <Labelled label="Correlation ID">
            <input placeholder="Correlation ID" value={draft.correlationId || ""}
              onChange={(e) => setField("correlationId",e.target.value)} style={inputStyle} />
          </Labelled>
          <Labelled label="User UUID">
            <input placeholder="User UUID" value={draft.actorUserId || ""}
              onChange={(e) => setField("actorUserId",e.target.value)} style={inputStyle} />
          </Labelled>
          <Labelled label="Sync Run UUID" disabled={disabledOn("syncRunId")}>
            <input placeholder="Sync Run UUID" value={draft.syncRunId || ""} disabled={disabledOn("syncRunId")}
              onChange={(e) => setField("syncRunId",e.target.value)} style={fieldStyle(disabledOn("syncRunId"))} />
          </Labelled>
          <Labelled label="Command UUID" disabled={disabledOn("commandId")}>
            <input placeholder="Command UUID" value={draft.commandId || ""} disabled={disabledOn("commandId")}
              onChange={(e) => setField("commandId",e.target.value)} style={fieldStyle(disabledOn("commandId"))} />
          </Labelled>
        </FilterGroup>

        <FilterGroup title="Search">
          <Labelled label={isAudit ? "Search action or reason" : "Search messages"}>
            <input placeholder="Free text" value={draft.search || ""}
              onChange={(e) => setField("search",e.target.value)} style={{ ...inputStyle,minWidth: 260 }} />
          </Labelled>
        </FilterGroup>

        <div style={{ display: "flex",gap: 8,marginTop: 4 }}>
          <button style={{ ...ctlStyle,borderColor: DS.sky,color: DS.sky }} onClick={applyFilters}>Apply filters</button>
          <button style={ctlStyle} onClick={clearFilters}>Clear</button>
        </div>
      </div>}

      <div style={{ display: "flex",gap: 8,alignItems: "center",flexWrap: "wrap" }}>
        <button style={ctlStyle} onClick={() => { void events.refetch();void summary.refetch(); }}>
          Refresh
        </button>
        <select value={String(filters.limit)} aria-label="Rows per page" style={ctlStyle}
          onChange={(e) => setFilters((v) => ({ ...v,limit: Number(e.target.value),page: 1 }))}>
          {[25,50,100,200].map((n) => <option key={n} value={n}>{n} per page</option>)}
        </select>
        <div style={{ marginLeft: "auto",display: "flex",gap: 8,alignItems: "center" }}>
          <select value={exportFormat} aria-label="Export format" style={ctlStyle} disabled={!exportEnabled}
            onChange={(e) => setExportFormat(e.target.value as "csv"|"json")}>
            <option value="csv">CSV</option><option value="json">JSON</option>
          </select>
          <button style={{ ...ctlStyle,color: exportEnabled ? DS.sky : DS.lo,
            cursor: exportEnabled ? "pointer" : "not-allowed" }}
            disabled={exportLogs.isPending || !exportEnabled}
            title={exportEnabled ? "Export the current filter selection"
              : "Export is disabled on this platform (SYSTEM_LOGS_EXPORT_ENABLED)"}
            onClick={() => exportLogs.mutate({ filters,format: exportFormat })}>
            {exportLogs.isPending ? "Exporting…" : `Export ${exportFormat.toUpperCase()}`}
          </button>
        </div>
      </div>
      {isAudit && <p style={{ margin: "9px 0 0",fontSize: 10,color: DS.lo }}>
        Export always covers system events, not audit records.
      </p>}
    </Card>

    {/* ── Results band ── */}
    <Card>
      {events.isLoading && <SkeletonRows />}

      {events.isError && <div style={{
        padding: "18px 16px",borderRadius: 10,
        border: `1px solid ${DS.rose}33`,background: "rgba(244,63,94,0.06)",
      }}>
        <p style={{ margin: 0,color: DS.rose,fontSize: 13,fontWeight: 600 }}>
          {errStatus === 403 ? "Access denied"
            : errStatus === 400 ? "The request was rejected"
            : errStatus === 503 ? "This log feed is disabled"
            : "Logs unavailable"}
        </p>
        <p style={{ margin: "5px 0 0",color: DS.mid,fontSize: 11 }}>
          {errStatus === 403 ? "Your role does not grant access to this log category."
            : errStatus === 400 ? ((events.error as any)?.response?.data?.message
                ?? "One of the filters is not valid. Try clearing filters.")
            : errStatus === 503 ? "A platform administrator has switched this feature off."
            : "The logs service did not respond. Try refreshing."}
        </p>
        {errStatus === 400 && <button onClick={clearFilters} style={{ ...ctlStyle,marginTop: 10 }}>Clear filters</button>}
      </div>}

      {!events.isLoading && !events.isError && rows.length === 0 && <div style={{
        padding: "48px 0",textAlign: "center",
      }}>
        <p style={{ margin: 0,color: DS.mid,fontSize: 13 }}>
          {activeFilters.length ? "No events match these filters" : "No events recorded yet"}
        </p>
        <p style={{ margin: "5px 0 0",color: DS.lo,fontSize: 11 }}>
          {activeFilters.length ? "Try widening the time range or removing a filter."
            : "Events will appear here as the platform and sync engine report activity."}
        </p>
        {activeFilters.length > 0 && <button onClick={clearFilters}
          style={{ ...ctlStyle,marginTop: 14 }}>Clear filters</button>}
      </div>}

      {rows.length > 0 && <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%",borderCollapse: "collapse",minWidth: 1080 }}>
          <thead>
            <tr>
              {["Time","Severity","Company","Source","Module","Event","Message","Details"].map((title) => {
                const sortable = SORTABLE[title] && !isAudit;
                const isSorted = sortable && filters.sortBy === SORTABLE[title].key;
                return <th key={title} onClick={() => sortable && toggleSort(title)}
                  title={title === "Severity" && sortable ? "Sorts alphabetically, not by seriousness" : undefined}
                  style={{
                    textAlign: title === "Details" ? "right" : "left",
                    position: "sticky",top: 0,background: "#070d18",zIndex: 1,
                    padding: "0 8px 10px",fontSize: 9,fontWeight: 600,
                    letterSpacing: "0.07em",textTransform: "uppercase",
                    color: isSorted ? DS.sky : DS.lo,
                    cursor: sortable ? "pointer" : "default",
                    borderBottom: `1px solid ${DS.border}`,whiteSpace: "nowrap",
                  }}>
                  {title === "Severity" && isAudit ? "Outcome" : title}
                  {sortable && <span style={{ marginLeft: 5,opacity: isSorted ? 1 : 0.3 }}>
                    {isSorted && filters.sortDirection === "asc" ? "▲" : "▼"}
                  </span>}
                </th>;
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row,index) => {
              const rowId = String(row.id);
              const isOpen = expandedAudit === rowId;
              return <Fragment key={rowId}>
                <tr style={{
                  borderBottom: `1px solid rgba(255,255,255,0.03)`,
                  background: index % 2 ? "rgba(255,255,255,0.014)" : "transparent",
                }}>
                  <td style={{ ...cellStyle,color: DS.lo,fontFamily: DS.mono,whiteSpace: "nowrap" }}>
                    {formatTime(row.occurred_at ?? row.at)}
                  </td>
                  <td style={cellStyle}>
                    <SeverityPill value={row.severity ?? row.outcome ?? "audit"} />
                  </td>
                  <td style={{ ...cellStyle,color: DS.mid }}>{row.tenant_name ?? row.tenantName ?? "Platform"}</td>
                  <td style={{ ...cellStyle,color: DS.mid }}>{row.source ?? "—"}</td>
                  <td style={{ ...cellStyle,color: DS.mid }}>{row.module ?? "—"}</td>
                  <td style={{ ...cellStyle,color: DS.sky }}>{row.event_type ?? row.action}</td>
                  <td style={{ ...cellStyle,color: DS.hi,maxWidth: 380,overflow: "hidden",
                    textOverflow: "ellipsis",whiteSpace: "nowrap" }}
                    title={row.message ?? row.reason ?? row.action}>
                    {row.message ?? row.reason ?? "—"}
                  </td>
                  <td style={{ ...cellStyle,textAlign: "right" }}>
                    <button style={{ ...ctlStyle,padding: "3px 10px",fontSize: 10 }}
                      onClick={() => isAudit
                        ? setExpandedAudit(isOpen ? null : rowId)
                        : setSelectedId(rowId)}>
                      {isAudit ? (isOpen ? "Hide" : "Details") : "Open"}
                    </button>
                  </td>
                </tr>
                {isAudit && isOpen && <tr>
                  <td colSpan={8} style={{ padding: "0 8px 12px" }}>
                    <AuditDetail row={row} />
                  </td>
                </tr>}
              </Fragment>;
            })}
          </tbody>
        </table>
      </div>}

      <div style={{ display: "flex",gap: 8,alignItems: "center",marginTop: 16,
        paddingTop: 14,borderTop: `1px solid ${DS.border}` }}>
        <button style={ctlStyle} disabled={filters.page === 1}
          onClick={() => setFilters((v) => ({ ...v,page: v.page-1 }))}>Previous</button>
        <span style={{ color: DS.lo,fontSize: 10 }}>
          Page {filters.page} of {totalPages} · {(payload?.pagination?.total ?? 0).toLocaleString()} records
        </span>
        <button style={ctlStyle} disabled={filters.page >= totalPages}
          onClick={() => setFilters((v) => ({ ...v,page: v.page+1 }))}>Next</button>
      </div>
    </Card>

    {selectedId && !isAudit && <LogDrawer data={detail.data} related={(related.data as any[]) ?? []}
      loading={detail.isLoading} onClose={() => setSelectedId(null)} />}
  </div>;
}

// ── Presentational helpers ────────────────────────────────────────────────────

const inputStyle = { background: "#090d18",border: `1px solid ${DS.border}`,borderRadius: 8,
  padding: "8px 10px",color: DS.hi,fontSize: 11,fontFamily: "inherit",width: "100%",
  boxSizing: "border-box" as const,outline: "none" };
const ctlStyle = { background: "#090d18",border: `1px solid ${DS.border}`,borderRadius: 8,
  padding: "7px 12px",color: DS.mid,fontSize: 11,fontFamily: "inherit",cursor: "pointer" };
const cellStyle = { padding: "10px 8px",fontSize: 11,verticalAlign: "top" as const };

function fieldStyle(disabled: boolean) {
  return disabled
    ? { ...inputStyle,opacity: 0.4,cursor: "not-allowed",background: "#070a12" }
    : inputStyle;
}

function FilterGroup({ title,children }: { title: string;children: React.ReactNode }) {
  return <div style={{ marginBottom: 16 }}>
    <div style={{ fontSize: 9,color: DS.lo,textTransform: "uppercase",
      letterSpacing: "0.1em",marginBottom: 8,fontWeight: 600 }}>{title}</div>
    <div style={{ display: "grid",gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",gap: 10 }}>
      {children}
    </div>
  </div>;
}

function Labelled({ label,disabled,children }: { label: string;disabled?: boolean;children: React.ReactNode }) {
  return <label title={disabled ? "Not supported on audit records" : undefined}
    style={{ display: "block",opacity: disabled ? 0.55 : 1 }}>
    <span style={{ display: "block",fontSize: 10,color: DS.lo,marginBottom: 5 }}>
      {label}{disabled && " · n/a"}
    </span>
    {children}
  </label>;
}

function SeverityPill({ value }: { value: string }) {
  const color = severityColor(value);
  return <span style={{
    fontSize: 9,fontWeight: 700,textTransform: "uppercase",letterSpacing: "0.05em",
    padding: "3px 8px",borderRadius: 20,whiteSpace: "nowrap",
    background: `${color}1f`,color,border: `1px solid ${color}33`,
  }}>{value}</span>;
}

function SkeletonRows() {
  return <div style={{ display: "flex",flexDirection: "column",gap: 8 }}>
    {Array.from({ length: 8 }).map((_,index) => <div key={index} style={{
      height: 32,borderRadius: 7,background: "rgba(255,255,255,0.03)",
      opacity: 1 - index * 0.09,
    }} />)}
  </div>;
}

// Audit rows have no detail endpoint — GET events/:id only reads system_events,
// and audit ids are BIGSERIAL too, so it would happily return an unrelated row.
// Everything a drawer would show is already in the list response, so expand in place.
function AuditDetail({ row }: { row: any }) {
  const fields: [string,any][] = [
    ["Action",row.action],["Outcome",row.outcome],["Reason",row.reason],
    ["Actor",row.actorName ?? row.actorId],["Company",row.tenantName],
    ["Target ID",row.targetId],["Request ID",row.requestId],
    ["Correlation ID",row.correlationId],["Occurred",formatTime(row.at)],
  ];
  return <div style={{
    border: `1px solid ${DS.border}`,borderRadius: 10,padding: 14,
    background: "rgba(255,255,255,0.02)",
  }}>
    <div style={{ display: "grid",gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",gap: 10 }}>
      {fields.map(([label,value]) => value != null && value !== "" && <div key={label}>
        <div style={{ fontSize: 9,color: DS.lo,textTransform: "uppercase",letterSpacing: "0.06em" }}>{label}</div>
        <div style={{ fontSize: 11,color: DS.hi,wordBreak: "break-all",marginTop: 3 }}>{String(value)}</div>
      </div>)}
    </div>
    {row.metadata && Object.keys(row.metadata).length > 0 && <>
      <div style={{ fontSize: 9,color: DS.lo,textTransform: "uppercase",
        letterSpacing: "0.06em",margin: "14px 0 6px" }}>Metadata</div>
      <pre style={{ margin: 0,color: DS.mid,fontSize: 10,fontFamily: DS.mono,
        whiteSpace: "pre-wrap",wordBreak: "break-word" }}>
        {JSON.stringify(row.metadata,null,2)}
      </pre>
    </>}
  </div>;
}

function LogDrawer({ data,related,loading,onClose }: { data: any;related: any[];loading: boolean;onClose: () => void }) {
  return <div style={{ position: "fixed",inset: 0,background: "rgba(0,0,0,.6)",zIndex: 1000 }}
    onClick={onClose}>
    <aside onClick={(e) => e.stopPropagation()} style={{ position: "absolute",right: 0,top: 0,bottom: 0,
      width: "min(640px,92vw)",background: "#080c16",borderLeft: `1px solid ${DS.border}`,
      padding: "22px 26px",overflowY: "auto" }}>
      <div style={{ display: "flex",justifyContent: "space-between",alignItems: "center",marginBottom: 18 }}>
        <div>
          <h2 style={{ color: DS.hi,fontFamily: DS.display,fontSize: 19,margin: 0,fontWeight: 400 }}>Event Details</h2>
          {data?.severity && <div style={{ marginTop: 7 }}><SeverityPill value={data.severity} /></div>}
        </div>
        <button onClick={onClose} style={ctlStyle}>Close</button>
      </div>
      {loading ? <p style={{ color: DS.mid }}>Loading…</p> : <>
        {data?.message && <div style={{
          border: `1px solid ${DS.border}`,borderRadius: 10,padding: "12px 14px",
          background: "rgba(255,255,255,0.02)",marginBottom: 18,
        }}>
          <div style={{ fontSize: 9,color: DS.lo,textTransform: "uppercase",
            letterSpacing: "0.07em",marginBottom: 5 }}>Message</div>
          <p style={{ color: DS.hi,margin: 0,fontSize: 12,lineHeight: 1.55 }}>{data.message}</p>
        </div>}

        {Object.entries({
          "Event ID": data?.id,"Occurred": formatTime(data?.occurred_at),"Received": formatTime(data?.created_at),
          "Company": data?.tenant_name,"Source": data?.source,"Module": data?.module,
          "Event": data?.event_type,"Status": data?.status,"Actor": data?.actor_name || data?.actor_user_id,
          "Agent": data?.agent_id,"Correlation ID": data?.correlation_id,"Request ID": data?.request_id,
          "Sync Run ID": data?.sync_run_id,"Command ID": data?.command_id,"Rows": data?.rows_processed,
          "Duration ms": data?.duration_ms,"Version": data?.service_version,"Git SHA": data?.git_sha,
        }).map(([label,value]) => value != null && <div key={label} style={{ display: "grid",gridTemplateColumns: "140px 1fr",
          padding: "7px 0",borderBottom: `1px solid ${DS.border}`,fontSize: 11 }}>
          <span style={{ color: DS.lo }}>{label}</span>
          <span style={{ color: DS.hi,wordBreak: "break-all",fontFamily: DS.mono }}>{String(value)}</span>
        </div>)}

        <h3 style={{ color: DS.hi,fontSize: 12,textTransform: "uppercase",
          letterSpacing: "0.07em",marginTop: 22 }}>Sanitised Metadata</h3>
        <pre style={{ color: DS.mid,fontSize: 10,fontFamily: DS.mono,whiteSpace: "pre-wrap",
          wordBreak: "break-word",background: "rgba(255,255,255,0.02)",
          border: `1px solid ${DS.border}`,borderRadius: 8,padding: 12 }}>
          {JSON.stringify(data?.metadata ?? {},null,2)}
        </pre>

        <h3 style={{ color: DS.hi,fontSize: 12,textTransform: "uppercase",
          letterSpacing: "0.07em",marginTop: 22 }}>Related Events</h3>
        {related.length === 0 ? <p style={{ color: DS.lo,fontSize: 11 }}>No correlated events.</p> :
          related.map((event) => <div key={event.id} style={{ borderLeft: `2px solid ${severityColor(event.severity)}`,
            padding: "8px 11px",marginBottom: 6,color: DS.mid,fontSize: 10,
            background: "rgba(255,255,255,0.02)",borderRadius: "0 6px 6px 0" }}>
            <span style={{ fontFamily: DS.mono,color: DS.lo }}>{formatTime(event.occurred_at)}</span>
            {" · "}<span style={{ color: DS.sky }}>{event.event_type}</span>
            {" · "}{event.message}
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
  if (value === "critical" || value === "error" || value === "failure") return DS.rose;
  if (value === "warning") return DS.amber;
  if (value === "info") return DS.sky;
  if (value === "success") return DS.emerald;
  return DS.lo;
}
