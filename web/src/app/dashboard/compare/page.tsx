"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DS } from "@/lib/design-system";
import { ChartTip } from "@/components/charts/recharts/ChartTip";
import { DetailPanel, SectionLabel, StatRow } from "@/components/ui/DetailPanel";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { useFilterStore, useStore, sessionHasPermission } from "@/lib/store";
import {
  ComparisonOptions,
  ComparisonTab,
  useChannelDetail,
  useComparisonChannelPair,
  useComparisonChannels,
  useComparisonCustomers,
  useComparisonInventory,
  useComparisonMatrix,
  useComparisonProducts,
  useComparisonSegments,
  useComparisonSummary,
  useComparisonTrend,
  useChannelProducts,
  useCompareProducts,
  useDeleteComparisonView,
  useProductDetail,
  useSaveComparisonView,
  useSavedComparisonViews,
  exportComparisonCsv,
} from "@/hooks/useComparisonData";

/* ══════════════════════════════════════════════════════════════════════════
   Tabs
   ══════════════════════════════════════════════════════════════════════════ */

const TABS: Array<{ id: ComparisonTab; label: string; hint: string }> = [
  { id: "executive", label: "Executive", hint: "Headline KPIs versus the selected baseline" },
  { id: "sales", label: "Sales & Channels", hint: "Head-to-head channel performance" },
  { id: "products", label: "Products", hint: "Product performance and the channel matrix" },
  { id: "inventory", label: "Inventory", hint: "Stock cover, dead stock and stockout risk" },
  { id: "customers", label: "Customers", hint: "Segments, value and recency" },
  { id: "saved", label: "Saved Views", hint: "Re-apply a stored filter configuration" },
];

const RANGE_LABELS: Record<string, string> = {
  TODAY: "Today", YESTERDAY: "Yesterday", "7D": "Last 7 days", "30D": "Last 30 days",
  MONTH: "This month", PREVIOUS_MONTH: "Previous month", QUARTER: "This quarter",
  PREVIOUS_QUARTER: "Previous quarter", "3M": "Last 3 months", "6M": "Last 6 months",
  "12M": "Last 12 months", YTD: "Year to date", YEAR: "This year", PREVIOUS_YEAR: "Previous year",
  ALL: "All time", custom: "Custom range",
};

const BASELINE_LABELS: Record<string, string> = {
  previous_period: "vs previous period",
  previous_year: "vs same period last year",
  custom: "vs custom baseline",
  none: "no baseline",
};

/* ══════════════════════════════════════════════════════════════════════════
   Formatting helpers
   ══════════════════════════════════════════════════════════════════════════ */

function number(value: unknown, digits = 0) {
  return Number(value || 0).toLocaleString("de-DE", { maximumFractionDigits: digits });
}

function money(value: unknown) {
  return `${number(value, 2)} €`;
}

function compactMoney(value: unknown) {
  const numeric = Number(value || 0);
  if (Math.abs(numeric) >= 1_000_000) return `€${(numeric / 1_000_000).toLocaleString("de-DE", { maximumFractionDigits: 1 })}M`;
  if (Math.abs(numeric) >= 1_000) return `€${(numeric / 1_000).toLocaleString("de-DE", { maximumFractionDigits: 1 })}k`;
  return `€${number(numeric, 0)}`;
}

function pct(value: unknown, digits = 1) {
  return `${number(value, digits)}%`;
}

function shortDate(value: unknown) {
  if (!value) return "";
  const text = String(value);
  return text.length > 10 ? text.slice(5, 10) : text;
}

function isoDay(value: unknown) {
  return value ? String(value).slice(0, 10) : "—";
}

function channelAccent(channelName: unknown, fallback: string) {
  const text = String(channelName || "").toLowerCase();
  if (text.includes("amazon")) return DS.amber;
  if (text.includes("shopify")) return DS.emerald;
  if (text.includes("ebay")) return DS.violet;
  if (text.includes("retail")) return DS.orange;
  return fallback;
}

function ratio(value: number, max: number) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(3, Math.min(100, (value / max) * 100));
}

/* ══════════════════════════════════════════════════════════════════════════
   Primitives
   ══════════════════════════════════════════════════════════════════════════ */

function Change({ value, size = 11 }: { value: unknown; size?: number }) {
  const numeric = value == null || value === "" ? null : Number(value);
  if (numeric == null || Number.isNaN(numeric)) {
    return <span style={{ fontSize: size - 0.5, color: DS.lo, whiteSpace: "nowrap" }}>No baseline</span>;
  }
  const flat = Math.abs(numeric) < 0.05;
  const color = flat ? DS.mid : numeric > 0 ? DS.emerald : DS.rose;
  const background = flat ? "rgba(255,255,255,0.05)" : numeric > 0 ? "rgba(16,185,129,0.12)" : "rgba(244,63,94,0.12)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3, whiteSpace: "nowrap",
      fontSize: size - 1, fontWeight: 600, color, background,
      borderRadius: 999, padding: "2px 7px", fontVariantNumeric: "tabular-nums",
    }}>
      {flat ? "—" : numeric > 0 ? "▲" : "▼"}{`${Math.abs(numeric).toFixed(1)}%`}
    </span>
  );
}

function Skeleton({ height = 12, width = "100%", radius = 6 }: { height?: number; width?: number | string; radius?: number }) {
  return <div className="cmp-skel" style={{ height, width, borderRadius: radius }} />;
}

function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div style={{ display: "grid", gap: 9, padding: "16px" }} aria-busy="true" aria-label="Loading data">
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`, gap: 10 }}>
        {Array.from({ length: columns }).map((_, index) => <Skeleton key={index} height={8} width="60%" />)}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} style={{ display: "grid", gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`, gap: 10, opacity: 1 - rowIndex * 0.1 }}>
          {Array.from({ length: columns }).map((_, index) => <Skeleton key={index} height={12} width={index === 0 ? "85%" : "55%"} />)}
        </div>
      ))}
    </div>
  );
}

function BlockSkeleton({ height = 180 }: { height?: number }) {
  return <div style={{ padding: 16 }} aria-busy="true"><Skeleton height={height} radius={10} /></div>;
}

function EmptyState({ icon = "◎", title, hint, action }: { icon?: string; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="cmp-empty">
      <div className="cmp-empty__icon">{icon}</div>
      <div className="cmp-empty__title">{title}</div>
      {hint && <div className="cmp-empty__hint">{hint}</div>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : "An unexpected error occurred";
  const is404 = msg.includes("404") || msg.includes("disabled") || msg.includes("not found");
  return (
    <div style={{ padding: "28px 20px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
      <span style={{ fontSize: 26 }}>{is404 ? "⚑" : "⚠"}</span>
      <div style={{ color: DS.rose, fontSize: 13, fontWeight: 600 }}>{is404 ? "Feature unavailable" : "Failed to load"}</div>
      <div style={{ color: DS.lo, fontSize: 11, maxWidth: 380 }}>{is404 ? "This comparison module may be disabled. Check COMPARISON_CENTRE_ENABLED and related feature flags." : msg}</div>
      {onRetry && !is404 && (
        <button className="cmp-btn cmp-btn--sm" onClick={onRetry} style={{ marginTop: 4 }}>Retry</button>
      )}
    </div>
  );
}

function Panel({ title, sub, actions, children, flush, accent, style }: {
  title?: string;
  sub?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  flush?: boolean;
  accent?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section className="cmp-panel" style={{ borderColor: accent ? `${accent}55` : undefined, ...style }}>
      {(title || actions) && (
        <div className="cmp-panel__head">
          <div style={{ minWidth: 0 }}>
            {title && <h3 className="cmp-panel__title">{title}</h3>}
            {sub && <p className="cmp-panel__sub">{sub}</p>}
          </div>
          {actions && <div className="cmp-panel__actions">{actions}</div>}
        </div>
      )}
      <div className={flush ? "cmp-panel__body cmp-panel__body--flush" : "cmp-panel__body"}>{children}</div>
    </section>
  );
}

type Column = {
  key: string;
  label: string;
  align?: "left" | "right";
  strong?: boolean;
  truncate?: boolean;
  render?: (row: any) => React.ReactNode;
};

function DataTable({ columns, rows, onRow, emptyTitle, emptyHint, maxHeight }: {
  columns: Column[];
  rows: any[];
  onRow?: (row: any) => void;
  emptyTitle?: string;
  emptyHint?: string;
  maxHeight?: number;
}) {
  if (!rows.length) {
    return <EmptyState icon="⌀" title={emptyTitle || "Nothing matches these filters"} hint={emptyHint || "Widen the date range or clear a filter to see records here."} />;
  }
  return (
    <div className="cmp-table-wrap" style={maxHeight ? { maxHeight } : undefined}>
      <table className="cmp-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.align === "right" ? "num" : undefined} scope="col">{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={String(row.id ?? row.channel_id ?? row.jtl_order_id ?? row.jtl_customer_id ?? index)}
              data-clickable={onRow ? "1" : undefined}
              tabIndex={onRow ? 0 : undefined}
              onClick={onRow ? () => onRow(row) : undefined}
              onKeyDown={onRow ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onRow(row); } } : undefined}
            >
              {columns.map((column) => {
                const content = column.render ? column.render(row) : (row[column.key] ?? "—");
                return (
                  <td key={column.key} className={[column.align === "right" ? "num" : "", column.strong ? "cell-strong" : ""].filter(Boolean).join(" ")}>
                    {column.truncate
                      ? <span className="truncate" title={typeof content === "string" || typeof content === "number" ? String(content) : undefined}>{content as React.ReactNode}</span>
                      : (content as React.ReactNode)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pager({ page, total, limit, onChange, compact, note, extra }: {
  page: number; total: number; limit: number; onChange: (page: number) => void;
  compact?: boolean; note?: React.ReactNode; extra?: React.ReactNode;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <div className="cmp-pager" style={compact ? { padding: "10px 0 0", borderTop: "none" } : undefined}>
      <span className="cmp-pager__info">
        {total === 0 ? "No rows" : <>Showing <b style={{ color: DS.mid }}>{number(from)}–{number(to)}</b> of {number(total)}</>}
        {note}
      </span>
      {extra}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button className="cmp-btn cmp-btn--sm" disabled={page <= 1} onClick={() => onChange(1)} aria-label="First page">«</button>
        <button className="cmp-btn cmp-btn--sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
        <span style={{ fontSize: 10.5, color: DS.mid, fontFamily: DS.mono, padding: "0 4px", whiteSpace: "nowrap" }}>{page} / {pages}</span>
        <button className="cmp-btn cmp-btn--sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
        <button className="cmp-btn cmp-btn--sm" disabled={page >= pages} onClick={() => onChange(pages)} aria-label="Last page">»</button>
      </div>
    </div>
  );
}

function ExportButton({ label, onExport, exporting, setExporting, disabled, primary }: {
  label: string;
  onExport: () => Promise<unknown>;
  exporting: boolean;
  setExporting: (value: boolean) => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      className={primary ? "cmp-btn cmp-btn--primary" : "cmp-btn"}
      disabled={exporting || disabled}
      onClick={async () => {
        try {
          setExporting(true);
          await onExport();
        } finally {
          setExporting(false);
        }
      }}
    >
      {exporting ? "Preparing…" : <>↓ {label}</>}
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Sales-tab building blocks
   ══════════════════════════════════════════════════════════════════════════ */

function MetricStrip({ channel }: { channel: any }) {
  const metrics = [
    { label: "Revenue", value: money(channel?.revenue), change: channel?.revenue_change },
    { label: "Orders", value: number(channel?.orders), change: null },
    { label: "Avg. order", value: money(channel?.average_order_value), change: null },
    { label: "Units", value: number(channel?.units, 1), change: null },
    { label: "Customers", value: number(channel?.customers), change: null },
    { label: "Products sold", value: number(channel?.products_sold), change: null },
  ];
  return (
    <div className="cmp-metrics">
      {metrics.map((metric) => (
        <div key={metric.label}>
          <div className="cmp-metrics__label">{metric.label}</div>
          <div className="cmp-metrics__value">{metric.value}</div>
          {metric.change != null && <div style={{ marginTop: 5 }}><Change value={metric.change} size={10} /></div>}
        </div>
      ))}
    </div>
  );
}

function MiniTrend({ data, color }: { data: any[]; color: string }) {
  if (!data.length) {
    return <EmptyState icon="∿" title="No sales in this period" hint="This channel recorded no active orders inside the selected window." />;
  }
  const gradientId = `cmpTrend-${color.replace("#", "")}`;
  return (
    <div style={{ width: "100%", height: 156 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: -14 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.045)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={48} tickFormatter={(value) => compactMoney(value)} />
          <Tooltip content={<ChartTip />} cursor={{ stroke: color, strokeOpacity: 0.35 }} />
          <Area type="monotone" dataKey="revenue" name="Revenue" stroke={color} fill={`url(#${gradientId})`} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ProductsMiniTable({ rows, accent }: { rows: any[]; accent: string }) {
  if (!rows.length) {
    return <EmptyState icon="⌀" title="No products sold here" hint="No order line for this channel falls inside the selected period." />;
  }
  const max = Math.max(...rows.map((row) => Number(row.revenue || 0)), 1);
  return (
    <table className="cmp-table" style={{ marginTop: 4 }}>
      <thead>
        <tr>
          <th scope="col">Product</th>
          <th scope="col" className="num">Revenue</th>
          <th scope="col" className="num">Units</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={String(row.id ?? row.sku ?? index)}>
            <td>
              <span className="truncate cell-strong" style={{ maxWidth: 230 }} title={row.name || row.product_name || ""}>
                {row.name || row.product_name || "Unknown product"}
              </span>
              <div style={{ height: 3, borderRadius: 3, background: "rgba(255,255,255,0.05)", marginTop: 6, maxWidth: 230 }}>
                <div style={{ height: "100%", borderRadius: 3, width: `${ratio(Number(row.revenue || 0), max)}%`, background: accent, opacity: 0.75 }} />
              </div>
            </td>
            <td className="num">{money(row.revenue)}</td>
            <td className="num">{number(row.units, 1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChannelComparePanel({ side, channel, products, trend, accent, onChange, channels, page, onPageChange, onDownload, exporting, setExporting, canExport }: {
  side: "A" | "B";
  channel: any;
  products: any;
  trend: any[];
  accent: string;
  onChange: (id: string) => void;
  channels: any[];
  page: number;
  onPageChange: (page: number) => void;
  onDownload: () => Promise<unknown>;
  exporting: boolean;
  setExporting: (value: boolean) => void;
  canExport: boolean;
}) {
  const displayName = channel?.channel_name || "Select channel";
  const rawChannels: string[] = channel?.raw_channels
    || channels.find((item) => item.channel_id === channel?.channel_id)?.raw_channels
    || [];
  return (
    <section className="cmp-panel" style={{ borderColor: `${accent}55`, minWidth: 0 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
        padding: "13px 16px",
        background: `linear-gradient(115deg, ${accent}2e 0%, rgba(10,21,37,0.15) 62%)`,
        borderBottom: `1px solid ${accent}44`,
      }}>
        <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 11 }}>
          <span style={{
            flex: "none", width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center",
            background: `${accent}22`, border: `1px solid ${accent}66`, color: accent,
            fontSize: 11, fontWeight: 700, fontFamily: DS.mono,
          }}>{side}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".11em" }}>Channel {side}</div>
            <h3 className="truncate" style={{ margin: "1px 0 0", color: DS.hi, fontSize: 17, fontWeight: 600, maxWidth: 260 }} title={displayName}>{displayName}</h3>
          </div>
        </div>
        <select
          className="cmp-select"
          style={{ width: "auto", minWidth: 165, maxWidth: 240 }}
          value={channel?.channel_id || ""}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`Channel ${side} selector`}
        >
          {channels.map((item) => <option key={item.channel_id} value={item.channel_id}>{item.channel_name}</option>)}
        </select>
      </div>

      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 15 }}>
        <MetricStrip channel={channel} />

        <div>
          <div style={{ color: DS.hi, fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}>Daily sales trend</div>
          <MiniTrend data={trend} color={accent} />
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: DS.hi, fontSize: 11.5, fontWeight: 600 }}>Products sold on this channel</div>
              <div style={{ color: DS.lo, fontSize: 9.5, marginTop: 2 }}>Gross revenue · same period and channel definition as the Sales page</div>
            </div>
            {canExport && <ExportButton label="CSV" onExport={onDownload} exporting={exporting} setExporting={setExporting} disabled={!channel?.channel_id} />}
          </div>
          {products.isLoading
            ? <TableSkeleton rows={5} columns={3} />
            : <>
              <ProductsMiniTable rows={products.data?.rows ?? []} accent={accent} />
              <Pager compact page={products.data?.page || page} total={products.data?.total || 0} limit={products.data?.limit || 5} onChange={onPageChange} />
            </>}
        </div>

        {rawChannels.length > 0 && (
          <div>
            <div style={{ color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".09em", marginBottom: 6 }}>Raw JTL identifiers</div>
            <div className="cmp-chiprow">
              {rawChannels.slice(0, 4).map((raw: string) => <span key={raw} className="cmp-chip">{raw}</span>)}
              {rawChannels.length > 4 && <span className="cmp-chip">+{rawChannels.length - 4} more</span>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function InsightBar({ label, left, right, leftColor, rightColor, leftName, rightName, format = number }: {
  label: string;
  left: number;
  right: number;
  leftColor: string;
  rightColor: string;
  leftName: string;
  rightName: string;
  format?: (value: unknown) => string;
}) {
  const max = Math.max(left, right, 1);
  const leader = left === right ? null : left > right ? "left" : "right";
  const rows: Array<{ name: string; value: number; color: string; side: "left" | "right" }> = [
    { name: leftName, value: left, color: leftColor, side: "left" },
    { name: rightName, value: right, color: rightColor, side: "right" },
  ];
  return (
    <div style={{ display: "grid", gap: 7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ color: DS.hi, fontSize: 11.5, fontWeight: 600 }}>{label}</span>
        <span style={{ color: DS.lo, fontSize: 10, fontFamily: DS.mono }}>
          {max > 0 ? `Δ ${format(Math.abs(left - right))}` : "—"}
        </span>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {rows.map((row) => (
          <div key={row.side} style={{ display: "grid", gridTemplateColumns: "minmax(0,110px) 1fr auto", alignItems: "center", gap: 9 }}>
            <span className="truncate" style={{ color: leader === row.side ? DS.hi : DS.mid, fontSize: 10 }} title={row.name}>{row.name}</span>
            <div style={{ height: 8, background: "rgba(255,255,255,.05)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ width: `${ratio(row.value, max)}%`, height: "100%", background: row.color, opacity: leader === row.side ? 1 : 0.55, transition: "width .5s ease" }} />
            </div>
            <span style={{ fontFamily: DS.mono, fontSize: 10.5, color: leader === row.side ? DS.hi : DS.mid, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{format(row.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Page
   ══════════════════════════════════════════════════════════════════════════ */

export default function ComparePage() {
  const flags = useFeatureFlags();
  const session = useStore((state) => state.session);
  const enabled = flags.data?.COMPARISON_CENTRE_ENABLED === true;
  const canExportComparison = sessionHasPermission(session, "comparison.export");
  const range = useFilterStore((state) => state.range);
  const from = useFilterStore((state) => state.from);
  const to = useFilterStore((state) => state.to);
  const setRange = useFilterStore((state) => state.setRange);
  const setCustom = useFilterStore((state) => state.setCustom);
  const resetGlobalFilters = useFilterStore((state) => state.resetFilters);

  const [tab, setTab] = useState<ComparisonTab>("sales");
  const [compareMode, setCompareMode] = useState<ComparisonOptions["compareMode"]>("previous_period");
  const [compareFrom, setCompareFrom] = useState("");
  const [compareTo, setCompareTo] = useState("");
  const [granularity, setGranularity] = useState<ComparisonOptions["granularity"]>("day");
  const [performance, setPerformance] = useState("all");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [region, setRegion] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [segment, setSegment] = useState("");
  const [country, setCountry] = useState("");
  const [minStock, setMinStock] = useState("");
  const [maxStock, setMaxStock] = useState("");
  const [page, setPage] = useState(1);
  const [deadStockDays, setDeadStockDays] = useState(90);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [leftChannel, setLeftChannel] = useState<string | null>(null);
  const [rightChannel, setRightChannel] = useState<string | null>(null);
  const [productChannel, setProductChannel] = useState("");
  const [leftProductPage, setLeftProductPage] = useState(1);
  const [rightProductPage, setRightProductPage] = useState(1);
  const [selectedProduct, setSelectedProduct] = useState<number | null>(null);
  const [saveName, setSaveName] = useState("");
  const [selectedProducts, setSelectedProducts] = useState<number[]>([]);
  const [matrixPage, setMatrixPage] = useState(1);
  const [matrixMetric, setMatrixMetric] = useState<"revenue" | "units" | "orders" | "customers" | "margin">("revenue");
  const [showRelationship, setShowRelationship] = useState(false);
  const [showMatrix, setShowMatrix] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  const options = useMemo<ComparisonOptions>(() => ({
    compareMode,
    compareFrom: compareMode === "custom" ? compareFrom || undefined : undefined,
    compareTo: compareMode === "custom" ? compareTo || undefined : undefined,
    granularity,
    category: category || undefined,
    region: region || undefined,
    warehouse: warehouse || undefined,
    segment: segment || undefined,
    country: country || undefined,
    minStock: minStock === "" ? undefined : Number(minStock),
    maxStock: maxStock === "" ? undefined : Number(maxStock),
    performance,
    search: search || undefined,
  }), [compareMode, compareFrom, compareTo, granularity, category, region, warehouse, segment, country, minStock, maxStock, performance, search]);

  const leftOptions = useMemo<ComparisonOptions>(() => ({
    ...options,
    channels: leftChannel || undefined,
    page: 1,
    limit: 20,
  }), [options, leftChannel]);

  const rightOptions = useMemo<ComparisonOptions>(() => ({
    ...options,
    channels: rightChannel || undefined,
    page: 1,
    limit: 20,
  }), [options, rightChannel]);
  const leftProductOptions = useMemo<ComparisonOptions>(() => ({
    ...options,
    channels: leftChannel || undefined,
    performance: "with_sales",
    page: leftProductPage,
    limit: 5,
  }), [options, leftChannel, leftProductPage]);
  const rightProductOptions = useMemo<ComparisonOptions>(() => ({
    ...options,
    channels: rightChannel || undefined,
    performance: "with_sales",
    page: rightProductPage,
    limit: 5,
  }), [options, rightChannel, rightProductPage]);
  const productOptions = useMemo<ComparisonOptions>(() => ({
    ...options,
    channels: productChannel || undefined,
  }), [options, productChannel]);
  const channelPairOptions = useMemo<ComparisonOptions>(() => ({
    ...options,
    channels: leftChannel && rightChannel ? `${leftChannel},${rightChannel}` : undefined,
  }), [options, leftChannel, rightChannel]);
  const matrixOptions = useMemo<ComparisonOptions>(() => ({
    ...productOptions,
    page: matrixPage,
    limit: 100,
  }), [productOptions, matrixPage]);

  const isSalesTab = tab === "sales";
  const isProductsTab = tab === "products";

  const summary = useComparisonSummary(options, enabled && tab === "executive");
  const channels = useComparisonChannels({ ...options, page: 1, limit: 100 }, enabled && (isSalesTab || isProductsTab));
  const leftTrend = useComparisonTrend(leftOptions, enabled && isSalesTab && Boolean(leftChannel));
  const rightTrend = useComparisonTrend(rightOptions, enabled && isSalesTab && Boolean(rightChannel));
  const channelPair = useComparisonChannelPair(
    channelPairOptions,
    enabled && isSalesTab && showRelationship && Boolean(leftChannel && rightChannel && leftChannel !== rightChannel),
  );
  const products = useComparisonProducts({ ...productOptions, page, limit: 50 }, enabled && isProductsTab);
  const matrix = useComparisonMatrix(matrixOptions, enabled && isProductsTab && showMatrix);
  const inventory = useComparisonInventory({ ...options, page, limit: 50, deadStockDays }, enabled && tab === "inventory");
  const customers = useComparisonCustomers({ ...options, page, limit: 50 }, enabled && tab === "customers");
  const segments = useComparisonSegments(options, enabled && tab === "customers");
  const saved = useSavedComparisonViews(enabled && tab === "saved");
  const channelDetail = useChannelDetail(selectedChannel, options);
  const leftProducts = useChannelProducts(leftChannel, leftProductOptions);
  const rightProducts = useChannelProducts(rightChannel, rightProductOptions);
  const productDetail = useProductDetail(selectedProduct, options);
  const saveView = useSaveComparisonView();
  const deleteView = useDeleteComparisonView();
  const compareProducts = useCompareProducts();

  const channelRows = channels.data?.rows ?? [];
  const leftRow = useMemo(() => channelRows.find((row: any) => row.channel_id === leftChannel) ?? channelRows[0] ?? null, [channelRows, leftChannel]);
  const rightRow = useMemo(() => channelRows.find((row: any) => row.channel_id === rightChannel) ?? channelRows.find((row: any) => row.channel_id !== leftRow?.channel_id) ?? channelRows[1] ?? null, [channelRows, leftRow?.channel_id, rightChannel]);
  const leftAccent = channelAccent(leftRow?.channel_name, DS.sky);
  const rightAccent = channelAccent(rightRow?.channel_name, DS.amber);
  const leftTrendRows = (leftTrend.data?.current ?? []).map((row: any) => ({ ...row, label: shortDate(row.bucket) }));
  const rightTrendRows = (rightTrend.data?.current ?? []).map((row: any) => ({ ...row, label: shortDate(row.bucket) }));
  const matrixRows = matrix.data?.rows ?? [];
  const matrixChannels: Array<[string, string]> = Array.from(
    new Map<string, string>(matrixRows.map((row: any) => [String(row.channel_id), String(row.channel_name)])).entries(),
  );
  const matrixProducts: Array<{ id: string; name: string; sku: string }> = Array.from(
    new Map<string, { id: string; name: string; sku: string }>(matrixRows.map((row: any) => [String(row.product_id), { id: String(row.product_id), name: String(row.product_name), sku: String(row.sku || "") }])).values(),
  );
  const matrixLookup = new Map<string, number | null>(matrixRows.map((row: any) => [`${row.product_id}:${row.channel_id}`, row[matrixMetric] == null ? null : Number(row[matrixMetric])]));

  const channelRevenueMax = Math.max(...channelRows.map((row: any) => Number(row.revenue || 0)), 1);
  const channelRevenueTotal = channelRows.reduce((sum: number, row: any) => sum + Number(row.revenue || 0), 0);

  useEffect(() => {
    if (!channelRows.length) return;
    setLeftChannel((current) => current && channelRows.some((row: any) => row.channel_id === current) ? current : channelRows[0]?.channel_id ?? null);
    setRightChannel((current) => {
      if (current && channelRows.some((row: any) => row.channel_id === current)) return current;
      return channelRows.find((row: any) => row.channel_id !== channelRows[0]?.channel_id)?.channel_id ?? channelRows[0]?.channel_id ?? null;
    });
  }, [channelRows]);

  /* ── Active-filter chips ────────────────────────────────────────────── */
  const activeFilters = useMemo(() => {
    const list: Array<{ key: string; label: string; clear: () => void }> = [];
    if (category) list.push({ key: "category", label: `Category: ${category}`, clear: () => { setCategory(""); setPage(1); } });
    if (region) list.push({ key: "region", label: `Region: ${region}`, clear: () => { setRegion(""); setPage(1); } });
    if (search) list.push({ key: "search", label: `Search: ${search}`, clear: () => { setSearch(""); setPage(1); } });
    if (warehouse) list.push({ key: "warehouse", label: `Warehouse: ${warehouse}`, clear: () => { setWarehouse(""); setPage(1); } });
    if (segment) list.push({ key: "segment", label: `Segment: ${segment}`, clear: () => { setSegment(""); setPage(1); } });
    if (country) list.push({ key: "country", label: `Country: ${country}`, clear: () => { setCountry(""); setPage(1); } });
    if (minStock !== "") list.push({ key: "minStock", label: `Min stock: ${minStock}`, clear: () => { setMinStock(""); setPage(1); } });
    if (maxStock !== "") list.push({ key: "maxStock", label: `Max stock: ${maxStock}`, clear: () => { setMaxStock(""); setPage(1); } });
    if (performance !== "all") list.push({ key: "performance", label: `Filter: ${performance.replace(/_/g, " ")}`, clear: () => { setPerformance("all"); setPage(1); } });
    return list;
  }, [category, region, search, warehouse, segment, country, minStock, maxStock, performance]);

  const clearAllFilters = () => {
    resetGlobalFilters(); setCategory(""); setRegion(""); setSearch(""); setWarehouse("");
    setSegment(""); setCountry(""); setMinStock(""); setMaxStock(""); setPerformance("all");
    setCompareMode("previous_period"); setCompareFrom(""); setCompareTo(""); setGranularity("month"); setPage(1);
  };

  const switchTab = (next: ComparisonTab) => {
    setTab(next);
    setPage(1);
    setSelectedChannel(null);
    setSelectedProduct(null);
    setPerformance("all");
    setMatrixPage(1);
    setLeftProductPage(1);
    setRightProductPage(1);
    setShowRelationship(false);
    setShowMatrix(false);
  };

  const tabCounts: Partial<Record<ComparisonTab, number | undefined>> = {
    sales: channels.data ? channelRows.length : undefined,
    products: products.data?.total,
    inventory: inventory.data?.total,
    customers: customers.data?.total,
    saved: saved.data?.length,
  };

  const exportDataset = tab === "sales" ? "channels" : tab === "products" ? "products" : tab === "inventory" ? "inventory" : tab === "customers" ? "customers" : null;
  const activeTab = TABS.find((item) => item.id === tab);

  if (flags.isLoading) {
    return (
      <div className="cmp-shell">
        <div className="cmp-panel"><BlockSkeleton height={90} /></div>
        <div className="cmp-panel"><BlockSkeleton height={260} /></div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <Panel title="Compare & Analyse" sub="Feature module is installed but currently switched off.">
        <EmptyState
          icon="⚑"
          title="Comparison centre is disabled"
          hint="Enable COMPARISON_CENTRE_ENABLED together with the comparison module flags after applying migration 16."
        />
      </Panel>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     Render
     ══════════════════════════════════════════════════════════════════════ */

  return (
    <div className="cmp-shell">
      {/* ── Command bar ──────────────────────────────────────────────── */}
      <header className="cmp-bar">
        <div className="cmp-bar__top">
          <div style={{ minWidth: 0 }}>
            <h2 className="cmp-bar__title">Compare &amp; Analyse</h2>
            <p className="cmp-bar__sub">{activeTab?.hint}</p>
          </div>
          <div className="cmp-bar__actions">
            <button
              className={filtersOpen ? "cmp-btn cmp-btn--primary" : "cmp-btn"}
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((current) => !current)}
            >
              ⚙ Filters
              {activeFilters.length > 0 && <span style={{ fontFamily: DS.mono, fontSize: 9.5, background: "rgba(56,189,248,0.18)", color: DS.sky, borderRadius: 999, padding: "1px 6px" }}>{activeFilters.length}</span>}
              <span style={{ opacity: .6 }}>{filtersOpen ? "▲" : "▼"}</span>
            </button>
            {tab !== "saved" && (
              <button className={saveOpen ? "cmp-btn cmp-btn--primary" : "cmp-btn"} onClick={() => setSaveOpen((current) => !current)}>
                ☆ Save view
              </button>
            )}
            {canExportComparison && exportDataset && (
              <ExportButton
                primary
                label="Export CSV"
                exporting={isExporting}
                setExporting={setIsExporting}
                onExport={() => exportComparisonCsv(exportDataset, options)}
              />
            )}
          </div>
        </div>

        {/* Context + active filters */}
        <div className="cmp-chiprow">
          <span className="cmp-chip cmp-chip--accent cmp-chip--dot">
            {RANGE_LABELS[range] || range}
            {range === "custom" && from && to && <b>{from} → {to}</b>}
          </span>
          <span className="cmp-chip">{BASELINE_LABELS[compareMode]}</span>
          <span className="cmp-chip">Grouped by <b>{granularity}</b></span>
          {activeFilters.map((filter) => (
            <span key={filter.key} className="cmp-chip">
              <span className="truncate" style={{ maxWidth: 190 }} title={filter.label}>{filter.label}</span>
              <button className="cmp-chip__x" onClick={filter.clear} aria-label={`Clear ${filter.label}`}>×</button>
            </span>
          ))}
          {activeFilters.length > 0 && (
            <button className="cmp-btn cmp-btn--sm" onClick={clearAllFilters}>Clear all</button>
          )}
        </div>

        {/* Save-view row */}
        {saveOpen && tab !== "saved" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              className="cmp-input"
              style={{ flex: "1 1 220px", maxWidth: 360 }}
              value={saveName}
              onChange={(event) => setSaveName(event.target.value)}
              placeholder={`Name this ${activeTab?.label ?? ""} view`}
              onKeyDown={(event) => {
                if (event.key === "Enter" && saveName.trim() && !saveView.isPending) {
                  saveView.mutate({ name: saveName.trim(), tab, config: options }, { onSuccess: () => { setSaveName(""); setSaveOpen(false); } });
                }
              }}
            />
            <button
              className="cmp-btn cmp-btn--primary"
              disabled={!saveName.trim() || saveView.isPending}
              onClick={() => saveView.mutate({ name: saveName.trim(), tab, config: options }, { onSuccess: () => { setSaveName(""); setSaveOpen(false); } })}
            >
              {saveView.isPending ? "Saving…" : "Save"}
            </button>
            <button className="cmp-btn" onClick={() => setSaveOpen(false)}>Cancel</button>
            <span style={{ fontSize: 10.5, color: DS.lo }}>Stores the current period, baseline, grouping and filters.</span>
          </div>
        )}

        {/* Filter drawer */}
        <div className={filtersOpen ? "cmp-filters is-open" : "cmp-filters"}>
          <div className="cmp-filters__inner">
            <div className="cmp-filters__grid">
              <label className="cmp-field">
                <span>Date range</span>
                <select className="cmp-select" value={range} onChange={(event) => { setRange(event.target.value as any); setPage(1); }} aria-label="Date range">
                  {Object.entries(RANGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="cmp-field">
                <span>Baseline</span>
                <select className="cmp-select" value={compareMode} onChange={(event) => setCompareMode(event.target.value as ComparisonOptions["compareMode"])} aria-label="Comparison period">
                  <option value="previous_period">Previous period</option>
                  <option value="previous_year">Same period last year</option>
                  <option value="custom">Custom baseline</option>
                  <option value="none">No comparison</option>
                </select>
              </label>
              <label className="cmp-field">
                <span>Grouping</span>
                <select className="cmp-select" value={granularity} onChange={(event) => setGranularity(event.target.value as ComparisonOptions["granularity"])} aria-label="Comparison granularity">
                  {["day", "week", "month", "quarter", "year"].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="cmp-field">
                <span>Product category</span>
                <input className="cmp-input" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }} placeholder="All categories" />
              </label>
              <label className="cmp-field">
                <span>Region</span>
                <input className="cmp-input" value={region} onChange={(event) => { setRegion(event.target.value); setPage(1); }} placeholder="Global" />
              </label>
              <label className="cmp-field">
                <span>Search</span>
                <input className="cmp-input" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Product or customer" />
              </label>

              {range === "custom" && <>
                <label className="cmp-field">
                  <span>Current from</span>
                  <input className="cmp-input" type="date" value={from || ""} onChange={(event) => setCustom(event.target.value, to || event.target.value)} />
                </label>
                <label className="cmp-field">
                  <span>Current to</span>
                  <input className="cmp-input" type="date" value={to || ""} onChange={(event) => setCustom(from || event.target.value, event.target.value)} />
                </label>
              </>}

              {compareMode === "custom" && <>
                <label className="cmp-field">
                  <span>Baseline from</span>
                  <input className="cmp-input" type="date" value={compareFrom} onChange={(event) => { setCompareFrom(event.target.value); setPage(1); }} />
                </label>
                <label className="cmp-field">
                  <span>Baseline to</span>
                  <input className="cmp-input" type="date" value={compareTo} onChange={(event) => { setCompareTo(event.target.value); setPage(1); }} />
                </label>
              </>}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 0 4px" }}>
              <button className="cmp-btn" onClick={clearAllFilters}>Reset all filters</button>
              <button className="cmp-btn cmp-btn--primary" onClick={() => setFiltersOpen(false)}>Done</button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <nav className="cmp-tabs" role="tablist" aria-label="Comparison sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? "cmp-tab is-active" : "cmp-tab"}
              onClick={() => switchTab(item.id)}
            >
              {item.label}
              {tabCounts[item.id] != null && <span className="cmp-tab__count">{number(tabCounts[item.id])}</span>}
            </button>
          ))}
        </nav>
      </header>

      {/* ══════════════════════════════════════════════════════════════════
          EXECUTIVE
          ══════════════════════════════════════════════════════════════════ */}
      {tab === "executive" && (
        <div className="tab-in" style={{ display: "grid", gap: 14 }}>
          {summary.isError ? (
            <Panel title="Executive"><ErrorState error={summary.error} onRetry={() => summary.refetch()} /></Panel>
          ) : summary.isLoading ? (
            <>
              <div className="cmp-kpis">
                {Array.from({ length: 5 }).map((_, index) => <div key={index} className="cmp-panel"><BlockSkeleton height={72} /></div>)}
              </div>
              <div className="cmp-panel"><BlockSkeleton height={90} /></div>
            </>
          ) : (
            <>
              <section className="cmp-kpis">
                {([
                  ["Revenue", money(summary.data?.current?.revenue), summary.data?.change?.revenue, money(summary.data?.comparison?.revenue), DS.sky],
                  ["Orders", number(summary.data?.current?.orders), summary.data?.change?.orders, number(summary.data?.comparison?.orders), DS.emerald],
                  ["Average order", money(summary.data?.current?.averageOrderValue), summary.data?.change?.averageOrderValue, money(summary.data?.comparison?.averageOrderValue), DS.violet],
                  ["Gross margin", money(summary.data?.current?.grossMargin), summary.data?.change?.grossMargin, money(summary.data?.comparison?.grossMargin), DS.amber],
                  ["Units", number(summary.data?.current?.units), summary.data?.change?.units, number(summary.data?.comparison?.units), DS.cyan],
                ] as Array<[string, string, unknown, string, string]>).map(([label, value, change, baseline, accent]) => (
                  <div key={label} className="cmp-panel" style={{ padding: "16px 18px", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: 0, left: "14%", right: "14%", height: 1, background: `radial-gradient(ellipse at 50%, ${accent}99, transparent 78%)` }} />
                    <div style={{ color: DS.lo, fontSize: 9.5, textTransform: "uppercase", letterSpacing: ".09em", fontWeight: 600 }}>{label}</div>
                    <div style={{ color: DS.hi, fontSize: 24, fontFamily: DS.display, margin: "11px 0 8px", overflowWrap: "anywhere" }}>{value}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <Change value={change} />
                      {compareMode !== "none" && <span style={{ fontSize: 9.5, color: DS.lo, fontFamily: DS.mono }}>was {baseline}</span>}
                    </div>
                  </div>
                ))}
              </section>

              <Panel title="Period context" sub="Exactly what the numbers above are measured over.">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 20 }}>
                  <div>
                    <SectionLabel text="Current period" />
                    <StatRow label="From" value={isoDay(summary.data?.periods?.current?.start)} />
                    <StatRow label="To" value={isoDay(summary.data?.periods?.current?.end)} />
                  </div>
                  <div>
                    <SectionLabel text="Baseline period" />
                    {summary.data?.periods?.comparison ? <>
                      <StatRow label="From" value={isoDay(summary.data.periods.comparison.start)} />
                      <StatRow label="To" value={isoDay(summary.data.periods.comparison.end)} />
                    </> : <p style={{ color: DS.lo, fontSize: 11, margin: "8px 0 0" }}>No baseline selected.</p>}
                  </div>
                  <div>
                    <SectionLabel text="Data freshness" />
                    <StatRow
                      label="Last sync"
                      value={summary.data?.freshness?.lastSyncedAt ? new Date(summary.data.freshness.lastSyncedAt).toLocaleString() : "Not synced"}
                      color={summary.data?.freshness?.lastSyncedAt ? DS.emerald : DS.amber}
                    />
                    <StatRow label="Revenue basis" value="Gross" />
                  </div>
                </div>
              </Panel>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          SALES & CHANNELS
          ══════════════════════════════════════════════════════════════════ */}
      {tab === "sales" && (
        <div className="tab-in" style={{ display: "grid", gap: 14 }}>
          {channels.isError ? (
            <Panel title="Sales &amp; Channels"><ErrorState error={channels.error} onRetry={() => channels.refetch()} /></Panel>
          ) : channels.isLoading ? (
            <>
              <div className="cmp-duo">
                <div className="cmp-panel"><BlockSkeleton height={380} /></div>
                <div className="cmp-panel"><BlockSkeleton height={380} /></div>
              </div>
              <div className="cmp-panel"><TableSkeleton rows={6} columns={6} /></div>
            </>
          ) : !channelRows.length ? (
            <Panel title="Sales & Channels">
              <EmptyState icon="⌀" title="No channels in this period" hint="No active orders were found for the selected date range and filters." action={<button className="cmp-btn cmp-btn--primary" onClick={clearAllFilters}>Reset filters</button>} />
            </Panel>
          ) : (
            <>
              {/* A/B panels */}
              <section className="cmp-duo">
                <ChannelComparePanel
                  side="A"
                  channel={leftRow}
                  products={leftProducts}
                  trend={leftTrendRows}
                  accent={leftAccent}
                  channels={channelRows}
                  page={leftProductPage}
                  onPageChange={setLeftProductPage}
                  exporting={isExporting}
                  setExporting={setIsExporting}
                  canExport={canExportComparison}
                  onDownload={() => leftChannel
                    ? exportComparisonCsv("products", { ...leftProductOptions, page: undefined, limit: undefined })
                    : Promise.resolve()}
                  onChange={(id) => { setLeftChannel(id); setLeftProductPage(1); setShowRelationship(false); }}
                />
                <ChannelComparePanel
                  side="B"
                  channel={rightRow}
                  products={rightProducts}
                  trend={rightTrendRows}
                  accent={rightAccent}
                  channels={channelRows}
                  page={rightProductPage}
                  onPageChange={setRightProductPage}
                  exporting={isExporting}
                  setExporting={setIsExporting}
                  canExport={canExportComparison}
                  onDownload={() => rightChannel
                    ? exportComparisonCsv("products", { ...rightProductOptions, page: undefined, limit: undefined })
                    : Promise.resolve()}
                  onChange={(id) => { setRightChannel(id); setRightProductPage(1); setShowRelationship(false); }}
                />
              </section>

              {/* Head-to-head */}
              <Panel
                title="Head-to-head"
                sub="Revenue mix, order volume and value quality for the selected pair."
                actions={canExportComparison && (
                  <ExportButton label="Channels CSV" exporting={isExporting} setExporting={setIsExporting} onExport={() => exportComparisonCsv("channels", options)} />
                )}
              >
                {/* Winner strip */}
                {(() => {
                  const leftRevenue = Number(leftRow?.revenue || 0);
                  const rightRevenue = Number(rightRow?.revenue || 0);
                  const winner = leftRevenue >= rightRevenue ? leftRow : rightRow;
                  const winnerAccent = leftRevenue >= rightRevenue ? leftAccent : rightAccent;
                  const lead = Math.abs(leftRevenue - rightRevenue);
                  const leadPct = Math.max(leftRevenue, rightRevenue) > 0 ? (lead / Math.max(leftRevenue, rightRevenue)) * 100 : 0;
                  return (
                    <div style={{
                      display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 14,
                      border: `1px solid ${winnerAccent}44`, borderRadius: 11, padding: "13px 15px",
                      background: `linear-gradient(110deg, ${winnerAccent}14, transparent 70%)`, marginBottom: 16,
                    }}>
                      <div>
                        <div style={{ color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".09em" }}>Leading channel</div>
                        <div className="truncate" style={{ color: DS.hi, fontSize: 19, fontFamily: DS.display, marginTop: 6 }} title={winner?.channel_name || ""}>{winner?.channel_name || "—"}</div>
                      </div>
                      <div>
                        <div style={{ color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".09em" }}>Revenue lead</div>
                        <div style={{ color: winnerAccent, fontSize: 16, fontFamily: DS.mono, marginTop: 8 }}>{money(lead)}</div>
                        <div style={{ color: DS.lo, fontSize: 10, marginTop: 3 }}>{pct(leadPct)} ahead</div>
                      </div>
                      <div>
                        <div style={{ color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".09em" }}>AOV gap</div>
                        <div style={{ color: DS.hi, fontSize: 16, fontFamily: DS.mono, marginTop: 8 }}>{money(Math.abs(Number(leftRow?.average_order_value || 0) - Number(rightRow?.average_order_value || 0)))}</div>
                      </div>
                      <div>
                        <div style={{ color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".09em" }}>Order gap</div>
                        <div style={{ color: DS.hi, fontSize: 16, fontFamily: DS.mono, marginTop: 8 }}>{number(Math.abs(Number(leftRow?.orders || 0) - Number(rightRow?.orders || 0)))}</div>
                      </div>
                    </div>
                  );
                })()}

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 22 }}>
                  <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
                    <InsightBar label="Revenue" left={Number(leftRow?.revenue || 0)} right={Number(rightRow?.revenue || 0)} leftColor={leftAccent} rightColor={rightAccent} leftName={leftRow?.channel_name || "Channel A"} rightName={rightRow?.channel_name || "Channel B"} format={money} />
                    <InsightBar label="Orders" left={Number(leftRow?.orders || 0)} right={Number(rightRow?.orders || 0)} leftColor={leftAccent} rightColor={rightAccent} leftName={leftRow?.channel_name || "Channel A"} rightName={rightRow?.channel_name || "Channel B"} />
                    <InsightBar label="Average order value" left={Number(leftRow?.average_order_value || 0)} right={Number(rightRow?.average_order_value || 0)} leftColor={leftAccent} rightColor={rightAccent} leftName={leftRow?.channel_name || "Channel A"} rightName={rightRow?.channel_name || "Channel B"} format={money} />
                    <InsightBar label="Units" left={Number(leftRow?.units || 0)} right={Number(rightRow?.units || 0)} leftColor={leftAccent} rightColor={rightAccent} leftName={leftRow?.channel_name || "Channel A"} rightName={rightRow?.channel_name || "Channel B"} />
                    <InsightBar label="Customers" left={Number(leftRow?.customers || 0)} right={Number(rightRow?.customers || 0)} leftColor={leftAccent} rightColor={rightAccent} leftName={leftRow?.channel_name || "Channel A"} rightName={rightRow?.channel_name || "Channel B"} />
                    <InsightBar label="Products sold" left={Number(leftRow?.products_sold || 0)} right={Number(rightRow?.products_sold || 0)} leftColor={leftAccent} rightColor={rightAccent} leftName={leftRow?.channel_name || "Channel A"} rightName={rightRow?.channel_name || "Channel B"} />
                  </div>

                  <div style={{ minHeight: 250 }}>
                    <div style={{ color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".09em", marginBottom: 8 }}>Revenue side by side</div>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={[
                        { name: leftRow?.channel_name || "Channel A", revenue: Number(leftRow?.revenue || 0) },
                        { name: rightRow?.channel_name || "Channel B", revenue: Number(rightRow?.revenue || 0) },
                      ]} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.045)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: DS.mid, fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: DS.lo, fontSize: 10 }} axisLine={false} tickLine={false} width={54} tickFormatter={(value) => compactMoney(value)} />
                        <Tooltip content={<ChartTip />} cursor={{ fill: "rgba(56,189,248,0.07)" }} />
                        <Bar dataKey="revenue" name="Revenue" radius={[6, 6, 0, 0]} maxBarSize={92}>
                          <Cell fill={leftAccent} />
                          <Cell fill={rightAccent} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </Panel>

              {/* Product relationship */}
              <Panel
                title="Channel product relationship"
                sub="Common, unique and stocked-without-sales products for the selected pair."
                actions={<>
                  {!showRelationship && (
                    <button className="cmp-btn cmp-btn--primary" disabled={!leftChannel || !rightChannel || leftChannel === rightChannel} onClick={() => setShowRelationship(true)}>
                      Analyse product overlap
                    </button>
                  )}
                  {showRelationship && canExportComparison && (
                    <ExportButton
                      label="Relationship CSV"
                      exporting={isExporting}
                      setExporting={setIsExporting}
                      disabled={!leftChannel || !rightChannel || leftChannel === rightChannel}
                      onExport={() => exportComparisonCsv("channel_pair", channelPairOptions)}
                    />
                  )}
                </>}
                flush={showRelationship && !channelPair.isLoading && leftChannel !== rightChannel}
              >
                {!showRelationship ? (
                  <EmptyState
                    icon="⧉"
                    title="Overlap analysis is loaded on demand"
                    hint="This query scans every product on both channels, so it only runs when you ask for it."
                    action={<button className="cmp-btn cmp-btn--primary" disabled={!leftChannel || !rightChannel || leftChannel === rightChannel} onClick={() => setShowRelationship(true)}>Analyse product overlap</button>}
                  />
                ) : leftChannel === rightChannel ? (
                  <EmptyState icon="⚠" title="Pick two different channels" hint="Channel A and Channel B are currently the same, so there is nothing to compare." />
                ) : channelPair.isLoading ? (
                  <TableSkeleton rows={6} columns={6} />
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, padding: "14px 16px" }}>
                      {([
                        ["Sold on both", channelPair.data?.counts?.common, DS.emerald],
                        [`Only ${leftRow?.channel_name || "A"}`, channelPair.data?.counts?.uniqueToA, leftAccent],
                        [`Only ${rightRow?.channel_name || "B"}`, channelPair.data?.counts?.uniqueToB, rightAccent],
                        ["Stocked, no sales", channelPair.data?.counts?.stockedZeroSales, DS.rose],
                      ] as Array<[string, unknown, string]>).map(([label, value, accent]) => (
                        <div key={label} style={{ border: `1px solid ${accent}3a`, borderRadius: 10, padding: "11px 13px", background: `${accent}0d` }}>
                          <div className="truncate" style={{ color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em" }} title={label}>{label}</div>
                          <div style={{ color: accent, fontFamily: DS.mono, fontSize: 20, marginTop: 6 }}>{number(value)}</div>
                        </div>
                      ))}
                    </div>
                    <DataTable
                      rows={channelPair.data?.rows ?? []}
                      emptyTitle="No shared or unique products"
                      columns={[
                        { key: "name", label: "Product", strong: true, truncate: true },
                        { key: "sku", label: "SKU" },
                        { key: "relationship", label: "Relationship", render: (row) => {
                          const value = String(row.relationship || "");
                          const accent = value.includes("both") ? DS.emerald : value.includes("stock") ? DS.rose : DS.sky;
                          return <span className="cmp-chip" style={{ borderColor: `${accent}55`, color: accent, background: `${accent}14` }}>{value.replace(/_/g, " ")}</span>;
                        } },
                        { key: "revenue_a", label: `${leftRow?.channel_name || "A"} revenue`, align: "right", render: (row) => money(row.revenue_a) },
                        { key: "revenue_b", label: `${rightRow?.channel_name || "B"} revenue`, align: "right", render: (row) => money(row.revenue_b) },
                        { key: "units_a", label: "A units", align: "right", render: (row) => number(row.units_a, 1) },
                        { key: "units_b", label: "B units", align: "right", render: (row) => number(row.units_b, 1) },
                        { key: "total_stock", label: "Current stock", align: "right", render: (row) => number(row.total_stock, 1) },
                      ]}
                    />
                    <Pager page={channelPair.data?.page || page} total={channelPair.data?.total || 0} limit={channelPair.data?.limit || 50} onChange={setPage} />
                  </>
                )}
              </Panel>

              {/* All channels */}
              <Panel
                title="All channels"
                sub="Select a row to drill into products, dead stock and recent orders."
                flush
              >
                <DataTable
                  rows={channelRows}
                  onRow={(row) => setSelectedChannel(row.channel_id)}
                  emptyTitle="No channels"
                  columns={[
                    { key: "channel_name", label: "Channel", strong: true, render: (row) => (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 7, height: 7, borderRadius: 99, background: channelAccent(row.channel_name, DS.sky), flex: "none" }} />
                        <span className="truncate" style={{ maxWidth: 190 }} title={row.channel_name}>{row.channel_name}</span>
                      </span>
                    ) },
                    { key: "channel_type", label: "Type" },
                    { key: "revenue", label: "Revenue", align: "right", render: (row) => money(row.revenue) },
                    { key: "share", label: "Share", render: (row) => (
                      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 108 }}>
                        <span style={{ flex: 1, height: 4, borderRadius: 4, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                          <span style={{ display: "block", height: "100%", width: `${ratio(Number(row.revenue || 0), channelRevenueMax)}%`, background: channelAccent(row.channel_name, DS.sky) }} />
                        </span>
                        <span style={{ fontFamily: DS.mono, fontSize: 10, color: DS.mid, minWidth: 38, textAlign: "right" }}>
                          {channelRevenueTotal > 0 ? pct((Number(row.revenue || 0) / channelRevenueTotal) * 100) : "—"}
                        </span>
                      </span>
                    ) },
                    { key: "orders", label: "Orders", align: "right", render: (row) => number(row.orders) },
                    { key: "units", label: "Units", align: "right", render: (row) => number(row.units, 1) },
                    { key: "customers", label: "Customers", align: "right", render: (row) => number(row.customers) },
                    { key: "products_sold", label: "Products", align: "right", render: (row) => number(row.products_sold) },
                    { key: "returns", label: "Returns", align: "right", render: (row) => number(row.returns) },
                    { key: "average_order_value", label: "AOV", align: "right", render: (row) => money(row.average_order_value) },
                    { key: "revenue_change", label: "Change", align: "right", render: (row) => <Change value={row.revenue_change} /> },
                  ]}
                />
              </Panel>
            </>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          PRODUCTS
          ══════════════════════════════════════════════════════════════════ */}
      {tab === "products" && (
        <div className="tab-in" style={{ display: "grid", gap: 14 }}>
          <Panel
            title="Marketplace product performance"
            sub="Product gross sales use the same canonical marketplace and period as the Sales page."
            flush={!products.isLoading && !products.isError}
            actions={<>
              <select
                className="cmp-select"
                style={{ width: "auto", minWidth: 155 }}
                value={productChannel}
                onChange={(event) => { setProductChannel(event.target.value); setPage(1); setMatrixPage(1); setSelectedProducts([]); }}
                aria-label="Marketplace filter"
              >
                <option value="">All marketplaces</option>
                {channelRows.map((channel: any) => <option key={channel.channel_id} value={channel.channel_id}>{channel.channel_name}</option>)}
              </select>
              <select className="cmp-select" style={{ width: "auto", minWidth: 150 }} value={performance} onChange={(event) => { setPerformance(event.target.value); setPage(1); }} aria-label="Product performance filter">
                <option value="all">All products</option>
                <option value="with_sales">With sales</option>
                <option value="zero_sales">Zero sales</option>
                <option value="with_stock">With stock</option>
                <option value="without_stock">Without stock</option>
                <option value="stock_no_sales">Stock but no sales</option>
                <option value="growing">Growing</option>
                <option value="declining">Declining</option>
              </select>
            </>}
          >
            {products.isError ? <ErrorState error={products.error} onRetry={() => products.refetch()} /> : products.isLoading ? <TableSkeleton rows={8} columns={7} /> : (
              <>
                <DataTable
                  rows={products.data?.rows ?? []}
                  onRow={(row) => setSelectedProduct(Number(row.id))}
                  emptyTitle="No products match these filters"
                  emptyHint="Try switching the performance filter back to “All products” or widening the date range."
                  columns={[
                    { key: "select", label: "⇄", render: (row) => (
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.name} for comparison`}
                        style={{ accentColor: DS.sky, cursor: "pointer", width: 14, height: 14 }}
                        checked={selectedProducts.includes(Number(row.id))}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setSelectedProducts((current) => event.target.checked ? [...current, Number(row.id)].slice(-5) : current.filter((id) => id !== Number(row.id)))}
                      />
                    ) },
                    { key: "name", label: "Product", strong: true, truncate: true },
                    { key: "sku", label: "SKU" },
                    { key: "category", label: "Category", truncate: true },
                    { key: "revenue", label: "Revenue", align: "right", render: (row) => money(row.revenue) },
                    { key: "units", label: "Units", align: "right", render: (row) => number(row.units, 1) },
                    { key: "stock", label: "Stock", align: "right", render: (row) => number(row.stock, 1) },
                    { key: "revenue_change", label: "Change", align: "right", render: (row) => <Change value={row.revenue_change} /> },
                  ]}
                />
                <Pager
                  page={products.data?.page || 1}
                  total={products.data?.total || 0}
                  limit={products.data?.limit || 50}
                  onChange={setPage}
                  note={productChannel
                    ? <span style={{ color: DS.sky }}> · {channelRows.find((channel: any) => channel.channel_id === productChannel)?.channel_name}</span>
                    : undefined}
                  extra={
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginRight: "auto", paddingLeft: 6 }}>
                      <span style={{ fontSize: 10.5, color: selectedProducts.length ? DS.sky : DS.lo, fontFamily: DS.mono }}>{selectedProducts.length}/5 selected</span>
                      {selectedProducts.length > 0 && <button className="cmp-btn cmp-btn--sm" onClick={() => setSelectedProducts([])}>Clear</button>}
                      <button
                        className="cmp-btn cmp-btn--sm cmp-btn--primary"
                        disabled={selectedProducts.length < 2 || compareProducts.isPending}
                        onClick={() => compareProducts.mutate({ productIds: selectedProducts, channels: productChannel || undefined, country: productOptions.country, region: productOptions.region })}
                      >
                        {compareProducts.isPending ? "Comparing…" : "Compare selected"}
                      </button>
                    </div>
                  }
                />
              </>
            )}
          </Panel>

          {compareProducts.data && (
            <Panel
              accent={DS.emerald}
              title="Side-by-side product comparison"
              sub={`${compareProducts.data.length} selected products across the current period.`}
              flush
              actions={<>
                {canExportComparison && (
                  <ExportButton
                    label="Selected CSV"
                    exporting={isExporting}
                    setExporting={setIsExporting}
                    onExport={() => exportComparisonCsv("products", { ...productOptions, productIds: selectedProducts.join(",") })}
                  />
                )}
                <button className="cmp-btn" onClick={() => compareProducts.reset()}>Close</button>
              </>}
            >
              <DataTable
                rows={compareProducts.data}
                emptyTitle="Nothing to compare"
                columns={[
                  { key: "name", label: "Product", strong: true, truncate: true },
                  { key: "sku", label: "SKU" },
                  { key: "revenue", label: "Revenue", align: "right", render: (row) => money(row.revenue) },
                  { key: "units", label: "Units", align: "right", render: (row) => number(row.units, 1) },
                  { key: "orders", label: "Orders", align: "right", render: (row) => number(row.orders) },
                  { key: "customers", label: "Customers", align: "right", render: (row) => number(row.customers) },
                  { key: "channel_names", label: "Channels", truncate: true },
                  { key: "stock", label: "Stock", align: "right", render: (row) => number(row.stock, 1) },
                  { key: "sales_velocity", label: "Velocity", align: "right", render: (row) => `${number(row.sales_velocity, 2)}/day` },
                  { key: "last_sale", label: "Last sale", render: (row) => row.last_sale ? isoDay(row.last_sale) : "Never" },
                  { key: "returns", label: "Returns", align: "right", render: (row) => number(row.returns) },
                  { key: "margin", label: "Margin", align: "right", render: (row) => row.margin == null ? <span style={{ color: DS.lo }}>Unavailable</span> : pct(row.margin) },
                  { key: "trend", label: "Period trend", render: (row) => Array.isArray(row.trend) && row.trend.length
                    ? <span className="truncate" style={{ maxWidth: 300 }} title={row.trend.map((point: any) => `${String(point.period).slice(0, 7)} ${money(point.revenue)}`).join(" · ")}>
                        {row.trend.map((point: any) => `${String(point.period).slice(0, 7)} ${money(point.revenue)}`).join(" · ")}
                      </span>
                    : <span style={{ color: DS.lo }}>No sales trend</span> },
                ]}
              />
            </Panel>
          )}

          <Panel
            title="Product × channel matrix"
            sub="Server-paginated combinations · a zero means no recorded sales inside this result page."
            flush={showMatrix && !matrix.isLoading && matrixRows.length > 0}
            actions={<>
              <select className="cmp-select" style={{ width: "auto", minWidth: 125 }} value={matrixMetric} onChange={(event) => setMatrixMetric(event.target.value as typeof matrixMetric)} aria-label="Matrix metric">
                <option value="revenue">Revenue</option>
                <option value="units">Units</option>
                <option value="orders">Orders</option>
                <option value="customers">Customers</option>
                <option value="margin">Margin</option>
              </select>
              {!showMatrix && <button className="cmp-btn cmp-btn--primary" onClick={() => setShowMatrix(true)}>Load matrix</button>}
              {canExportComparison && (
                <ExportButton label="Matrix CSV" exporting={isExporting} setExporting={setIsExporting} onExport={() => exportComparisonCsv("product_channel_matrix", matrixOptions)} />
              )}
            </>}
          >
            {!showMatrix ? (
              <EmptyState
                icon="▦"
                title="Matrix is loaded on demand"
                hint="Building the full product × channel grid is expensive, so it stays off until you need it."
                action={<button className="cmp-btn cmp-btn--primary" onClick={() => setShowMatrix(true)}>Load matrix</button>}
              />
            ) : matrix.isLoading ? (
              <TableSkeleton rows={8} columns={5} />
            ) : matrixRows.length === 0 ? (
              <EmptyState icon="⌀" title="No product-channel sales" hint="No order line matched the selected filters in this period." />
            ) : (
              <>
                <div className="cmp-table-wrap" style={{ maxHeight: 540 }}>
                  <table className="cmp-table" style={{ minWidth: Math.max(760, 300 + matrixChannels.length * 145) }}>
                    <thead>
                      <tr>
                        <th className="sticky-col" scope="col">Product / SKU</th>
                        {matrixChannels.map(([channelId, channelName]) => <th key={channelId} className="num" scope="col">{channelName}</th>)}
                        <th className="num" scope="col" style={{ color: DS.sky }}>Page total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matrixProducts.map((product) => {
                        const values = matrixChannels.map(([channelId]) => matrixLookup.get(`${product.id}:${channelId}`) ?? null);
                        const numericValues = values.filter((value): value is number => value != null);
                        const total = matrixMetric === "margin"
                          ? (numericValues.length ? numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length : null)
                          : numericValues.reduce((sum, value) => sum + value, 0);
                        return (
                          <tr key={product.id}>
                            <td className="sticky-col">
                              <div className="truncate cell-strong" style={{ maxWidth: 240 }} title={product.name}>{product.name}</div>
                              <div style={{ color: DS.lo, fontFamily: DS.mono, fontSize: 9 }}>{product.sku || "No SKU"}</div>
                            </td>
                            {values.map((value, index) => (
                              <td key={matrixChannels[index][0]} className="num" style={{ color: value != null && value > 0 ? DS.hi : DS.lo }}>
                                {value == null ? "—" : matrixMetric === "revenue" ? money(value) : matrixMetric === "margin" ? pct(value) : number(value, 1)}
                              </td>
                            ))}
                            <td className="num" style={{ color: DS.sky, fontWeight: 700 }}>
                              {total == null ? "—" : matrixMetric === "revenue" ? money(total) : matrixMetric === "margin" ? `${pct(total)} avg` : number(total, 1)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <Pager page={matrix.data?.page || matrixPage} total={matrix.data?.total || 0} limit={matrix.data?.limit || 100} onChange={setMatrixPage} />
              </>
            )}
          </Panel>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          INVENTORY
          ══════════════════════════════════════════════════════════════════ */}
      {tab === "inventory" && (
        <div className="tab-in">
          <Panel
            title="Inventory performance"
            sub="Stock cover is derived from the last 30 days of demand; dead stock uses the day threshold on the right."
            flush={!inventory.isLoading && !inventory.isError}
            actions={<>
              <input className="cmp-input" style={{ width: 130 }} value={warehouse} onChange={(event) => { setWarehouse(event.target.value); setPage(1); }} placeholder="Warehouse" aria-label="Warehouse" />
              <input className="cmp-input" style={{ width: 92 }} type="number" min={0} value={minStock} onChange={(event) => { setMinStock(event.target.value); setPage(1); }} placeholder="Min" aria-label="Minimum stock" />
              <input className="cmp-input" style={{ width: 92 }} type="number" min={0} value={maxStock} onChange={(event) => { setMaxStock(event.target.value); setPage(1); }} placeholder="Max" aria-label="Maximum stock" />
              <select className="cmp-select" style={{ width: "auto", minWidth: 140 }} value={performance} onChange={(event) => { setPerformance(event.target.value); setPage(1); }} aria-label="Stock classification">
                <option value="all">All stock</option>
                <option value="fast_moving">Fast moving</option>
                <option value="slow_moving">Slow moving</option>
                <option value="dead_stock">Dead stock</option>
                <option value="overstock">Overstock</option>
                <option value="stockout_risk">Stockout risk</option>
              </select>
              <label className="cmp-field" style={{ gridAutoFlow: "column", alignItems: "center", gap: 6 }}>
                <span style={{ whiteSpace: "nowrap" }}>Dead after</span>
                <input className="cmp-input" style={{ width: 78 }} type="number" min={1} value={deadStockDays} onChange={(event) => setDeadStockDays(Math.max(1, Number(event.target.value)))} title="Dead stock days" />
              </label>
            </>}
          >
            {inventory.isError ? <ErrorState error={inventory.error} onRetry={() => inventory.refetch()} /> : inventory.isLoading ? <TableSkeleton rows={8} columns={7} /> : (
              <>
                <DataTable
                  rows={inventory.data?.rows ?? []}
                  emptyTitle="No stock records match"
                  emptyHint="Clear the warehouse or min/max stock filters to see the full catalogue."
                  columns={[
                    { key: "name", label: "Product", strong: true, truncate: true },
                    { key: "sku", label: "SKU" },
                    { key: "warehouses", label: "Warehouses", truncate: true },
                    { key: "stock", label: "Stock", align: "right", render: (row) => number(row.stock, 1) },
                    { key: "stock_value", label: "Value", align: "right", render: (row) => money(row.stock_value) },
                    { key: "units_30d", label: "Units 30d", align: "right", render: (row) => number(row.units_30d, 1) },
                    { key: "stock_cover_days", label: "Cover", align: "right", render: (row) => row.stock_cover_days == null
                      ? <span style={{ color: DS.lo }}>No demand</span>
                      : <span style={{ color: Number(row.stock_cover_days) < 14 ? DS.rose : Number(row.stock_cover_days) > 180 ? DS.amber : DS.hi }}>{number(row.stock_cover_days, 1)} d</span> },
                    { key: "classification", label: "Class", render: (row) => {
                      const value = String(row.classification || "—");
                      const accent = value.includes("dead") ? DS.rose : value.includes("fast") ? DS.emerald : value.includes("over") ? DS.amber : value.includes("risk") ? DS.orange : DS.mid;
                      return <span className="cmp-chip" style={{ borderColor: `${accent}55`, color: accent, background: `${accent}14` }}>{value.replace(/_/g, " ")}</span>;
                    } },
                  ]}
                />
                <Pager page={inventory.data?.page || 1} total={inventory.data?.total || 0} limit={inventory.data?.limit || 50} onChange={setPage} />
              </>
            )}
          </Panel>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          CUSTOMERS
          ══════════════════════════════════════════════════════════════════ */}
      {tab === "customers" && (
        <div className="tab-in" style={{ display: "grid", gap: 14 }}>
          {segments.isError ? null : segments.isLoading ? (
            <div className="cmp-kpis">
              {Array.from({ length: 4 }).map((_, index) => <div key={index} className="cmp-panel"><BlockSkeleton height={62} /></div>)}
            </div>
          ) : (segments.data || []).length > 0 && (() => {
            const rows = segments.data || [];
            const maxCustomers = Math.max(...rows.map((item: any) => Number(item.customers || 0)), 1);
            const palette = [DS.sky, DS.emerald, DS.violet, DS.amber, DS.cyan, DS.orange, DS.indigo, DS.lime];
            return (
              <section className="cmp-kpis">
                {rows.map((item: any, index: number) => {
                  const accent = palette[index % palette.length];
                  const active = segment && segment.toLowerCase() === String(item.segment || "").toLowerCase();
                  return (
                    <button
                      key={item.segment}
                      className="cmp-panel"
                      style={{ padding: "14px 16px", textAlign: "left", borderColor: active ? `${accent}88` : undefined, background: active ? `${accent}12` : undefined }}
                      onClick={() => { setSegment(active ? "" : String(item.segment || "")); setPage(1); }}
                      title={active ? "Clear this segment filter" : `Filter the table by ${item.segment}`}
                    >
                      <div className="truncate" style={{ color: DS.hi, fontSize: 12, fontWeight: 600 }}>{item.segment}</div>
                      <div style={{ color: accent, fontSize: 21, fontFamily: DS.mono, margin: "8px 0 6px" }}>{number(item.customers)}</div>
                      <div style={{ height: 3, borderRadius: 3, background: "rgba(255,255,255,0.06)", marginBottom: 7 }}>
                        <div style={{ height: "100%", borderRadius: 3, width: `${ratio(Number(item.customers || 0), maxCustomers)}%`, background: accent }} />
                      </div>
                      <div style={{ color: DS.lo, fontSize: 10 }}>{money(item.total_ltv)} lifetime value</div>
                    </button>
                  );
                })}
              </section>
            );
          })()}

          <Panel
            title="Customer analysis"
            sub="Recency, value and channel behaviour for customers active in the selected period."
            flush={!customers.isLoading && !customers.isError}
            actions={<>
              <input className="cmp-input" style={{ width: 125 }} value={segment} onChange={(event) => { setSegment(event.target.value); setPage(1); }} placeholder="Segment" aria-label="Segment" />
              <input className="cmp-input" style={{ width: 105 }} value={country} onChange={(event) => { setCountry(event.target.value); setPage(1); }} placeholder="Country" aria-label="Country" />
              <select className="cmp-select" style={{ width: "auto", minWidth: 155 }} value={performance} onChange={(event) => { setPerformance(event.target.value); setPage(1); }} aria-label="Customer behaviour filter">
                <option value="all">All customers</option>
                <option value="new">New</option>
                <option value="repeat">Repeat</option>
                <option value="one_time">One-time</option>
                <option value="high_value">High-value</option>
                <option value="at_risk">At risk</option>
                <option value="inactive">Inactive</option>
                <option value="reactivated">Reactivated</option>
                <option value="single_channel">Single-channel</option>
                <option value="multi_channel">Multi-channel</option>
              </select>
            </>}
          >
            {customers.isError ? <ErrorState error={customers.error} onRetry={() => customers.refetch()} /> : customers.isLoading ? <TableSkeleton rows={8} columns={7} /> : (
              <>
                <DataTable
                  rows={customers.data?.rows ?? []}
                  emptyTitle="No customers match"
                  emptyHint="Clear the segment or country filter, or widen the date range."
                  columns={[
                    { key: "display_name", label: "Customer", strong: true, truncate: true },
                    { key: "company", label: "Company", truncate: true },
                    { key: "segment", label: "RFM segment", render: (row) => row.segment ? <span className="cmp-chip">{row.segment}</span> : "—" },
                    { key: "customer_type", label: "Type" },
                    { key: "total_orders", label: "Orders", align: "right", render: (row) => number(row.total_orders) },
                    { key: "ltv", label: "LTV", align: "right", render: (row) => money(row.ltv) },
                    { key: "days_since_last_order", label: "Recency", align: "right", render: (row) => (
                      <span style={{ color: Number(row.days_since_last_order) > 180 ? DS.rose : Number(row.days_since_last_order) <= 30 ? DS.emerald : DS.hi }}>
                        {number(row.days_since_last_order)} d
                      </span>
                    ) },
                  ]}
                />
                <Pager page={customers.data?.page || 1} total={customers.data?.total || 0} limit={customers.data?.limit || 50} onChange={setPage} />
              </>
            )}
          </Panel>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          SAVED VIEWS
          ══════════════════════════════════════════════════════════════════ */}
      {tab === "saved" && (
        <div className="tab-in">
          <Panel title="Saved views" sub="Applying a view restores its period, baseline, grouping and every filter it was saved with.">
            {saved.isLoading ? <TableSkeleton rows={4} columns={3} /> : !(saved.data || []).length ? (
              <EmptyState
                icon="☆"
                title="No saved views yet"
                hint="Configure the filters you use often on any tab, then press “Save view” in the header to store them here."
              />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: 12 }}>
                {(saved.data || []).map((view: any) => {
                  const config = view.config || {};
                  const target = TABS.find((item) => item.id === view.tab);
                  return (
                    <div key={view.id} style={{ border: `1px solid ${DS.border}`, borderRadius: 12, padding: "13px 15px", background: "rgba(255,255,255,0.02)", display: "grid", gap: 10 }}>
                      <div>
                        <div className="truncate" style={{ color: DS.hi, fontSize: 13, fontWeight: 600 }} title={view.name}>{view.name}</div>
                        <div style={{ color: DS.lo, fontSize: 10, marginTop: 3 }}>
                          {target?.label || view.tab} · updated {new Date(view.updated_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="cmp-chiprow">
                        {config.compareMode && <span className="cmp-chip">{BASELINE_LABELS[config.compareMode] || config.compareMode}</span>}
                        {config.granularity && <span className="cmp-chip">by {config.granularity}</span>}
                        {config.performance && config.performance !== "all" && <span className="cmp-chip">{String(config.performance).replace(/_/g, " ")}</span>}
                        {config.category && <span className="cmp-chip">{config.category}</span>}
                        {config.region && <span className="cmp-chip">{config.region}</span>}
                        {config.search && <span className="cmp-chip">“{config.search}”</span>}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="cmp-btn cmp-btn--sm cmp-btn--primary"
                          style={{ flex: 1 }}
                          onClick={() => {
                            // Restore every field the view was saved with, then fall back to
                            // the neutral default so a partially-saved view cannot leave a
                            // stale filter behind from whatever the user had on screen.
                            setCompareMode(config.compareMode || "previous_period");
                            setCompareFrom(config.compareFrom || "");
                            setCompareTo(config.compareTo || "");
                            setGranularity(config.granularity || "day");
                            setPerformance(config.performance || "all");
                            setCategory(config.category || "");
                            setRegion(config.region || "");
                            setWarehouse(config.warehouse || "");
                            setSegment(config.segment || "");
                            setCountry(config.country || "");
                            setSearch(config.search || "");
                            setMinStock(config.minStock == null ? "" : String(config.minStock));
                            setMaxStock(config.maxStock == null ? "" : String(config.maxStock));
                            setDeadStockDays(config.deadStockDays ? Number(config.deadStockDays) : 90);
                            setProductChannel(config.channels && !String(config.channels).includes(",") ? String(config.channels) : "");
                            setPage(1);
                            setMatrixPage(1);
                            setSelectedChannel(null);
                            setSelectedProduct(null);
                            setShowRelationship(false);
                            setShowMatrix(false);
                            if (TABS.some((item) => item.id === view.tab && item.id !== "saved")) setTab(view.tab);
                          }}
                        >
                          Apply view
                        </button>
                        <button
                          className="cmp-btn cmp-btn--sm cmp-btn--danger"
                          disabled={deleteView.isPending}
                          onClick={() => deleteView.mutate(view.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          Channel drill-through
          ══════════════════════════════════════════════════════════════════ */}
      <DetailPanel
        open={Boolean(selectedChannel)}
        title={channelDetail.data?.channel?.channel_name || "Channel detail"}
        subtitle={selectedChannel
          ? `${isoDay(channelDetail.data?.periods?.current?.start)} → ${isoDay(channelDetail.data?.periods?.current?.end)}`
          : undefined}
        onClose={() => setSelectedChannel(null)}
      >
        {channelDetail.isLoading ? (
          <div style={{ display: "grid", gap: 10 }}>
            <Skeleton height={60} radius={10} />
            <Skeleton height={140} radius={10} />
            <Skeleton height={140} radius={10} />
          </div>
        ) : !channelDetail.data ? (
          <EmptyState icon="⌀" title="No detail available" />
        ) : (
          <>
            <div className="cmp-metrics">
              <div><div className="cmp-metrics__label">Revenue</div><div className="cmp-metrics__value">{money(channelDetail.data.channel?.revenue)}</div></div>
              <div><div className="cmp-metrics__label">Orders</div><div className="cmp-metrics__value">{number(channelDetail.data.channel?.orders)}</div></div>
              <div><div className="cmp-metrics__label">AOV</div><div className="cmp-metrics__value">{money(channelDetail.data.channel?.average_order_value)}</div></div>
            </div>

            {(channelDetail.data.channel?.raw_channels || []).length > 0 && <>
              <SectionLabel text="Raw JTL identifiers" />
              <div className="cmp-chiprow">
                {(channelDetail.data.channel?.raw_channels || []).map((raw: string) => <span key={raw} className="cmp-chip">{raw}</span>)}
              </div>
            </>}

            <SectionLabel text={`Top products (${number(channelDetail.data.products?.total || 0)} total)`} />
            <DataTable
              maxHeight={280}
              rows={channelDetail.data.products?.rows ?? []}
              emptyTitle="No products sold"
              columns={[
                { key: "name", label: "Product", strong: true, truncate: true },
                { key: "sku", label: "SKU" },
                { key: "revenue", label: "Revenue", align: "right", render: (row) => money(row.revenue) },
                { key: "units", label: "Units", align: "right", render: (row) => number(row.units, 1) },
              ]}
            />

            <SectionLabel text={`Stocked with no sales here (${number(channelDetail.data.stockedWithoutSales?.total || 0)} total)`} />
            <DataTable
              maxHeight={280}
              rows={channelDetail.data.stockedWithoutSales?.rows ?? []}
              emptyTitle="Every stocked product sold"
              emptyHint="No product with stock went unsold on this channel in the period."
              columns={[
                { key: "name", label: "Product", strong: true, truncate: true },
                { key: "sku", label: "SKU" },
                { key: "category", label: "Category", truncate: true },
                { key: "stock", label: "Stock", align: "right", render: (row) => number(row.stock, 1) },
                { key: "last_sale_date", label: "Last sale", render: (row) => row.last_sale_date ? isoDay(row.last_sale_date) : "Never here" },
              ]}
            />

            <SectionLabel text={`Recent orders (${number(channelDetail.data.orders?.total || 0)} total)`} />
            <DataTable
              maxHeight={280}
              rows={channelDetail.data.orders?.rows ?? []}
              emptyTitle="No orders in this period"
              columns={[
                { key: "order_number", label: "Order", strong: true },
                { key: "order_date", label: "Date", render: (row) => isoDay(row.order_date) },
                { key: "payment_method", label: "Payment", truncate: true },
                { key: "status", label: "Status" },
                { key: "revenue", label: "Revenue", align: "right", render: (row) => money(row.revenue) },
              ]}
            />
          </>
        )}
      </DetailPanel>

      {/* ══════════════════════════════════════════════════════════════════
          Product drill-through
          ══════════════════════════════════════════════════════════════════ */}
      <DetailPanel
        open={Boolean(selectedProduct)}
        title={productDetail.data?.product?.name || "Product detail"}
        subtitle={productDetail.data?.product?.article_number ? `SKU ${productDetail.data.product.article_number}` : undefined}
        onClose={() => setSelectedProduct(null)}
      >
        {productDetail.isLoading ? (
          <div style={{ display: "grid", gap: 10 }}>
            <Skeleton height={60} radius={10} />
            <Skeleton height={160} radius={10} />
          </div>
        ) : !productDetail.data ? (
          <EmptyState icon="⌀" title="No detail available" />
        ) : (
          <>
            <div className="cmp-metrics">
              <div><div className="cmp-metrics__label">Revenue</div><div className="cmp-metrics__value">{money(productDetail.data.performance?.revenue)}</div></div>
              <div><div className="cmp-metrics__label">Units</div><div className="cmp-metrics__value">{number(productDetail.data.performance?.units, 1)}</div></div>
              <div><div className="cmp-metrics__label">Stock</div><div className="cmp-metrics__value">{number(productDetail.data.performance?.stock, 1)}</div></div>
            </div>

            <SectionLabel text="Attributes" />
            <StatRow label="Category" value={productDetail.data.product?.category || "Uncategorised"} />
            <StatRow label="Orders in period" value={number(productDetail.data.performance?.orders)} />
            <StatRow label="Revenue change" value={productDetail.data.performance?.revenue_change == null ? "No baseline" : pct(productDetail.data.performance.revenue_change)} color={Number(productDetail.data.performance?.revenue_change) >= 0 ? DS.emerald : DS.rose} />
            <StatRow label="Warehouse records" value={number(productDetail.data.inventory?.length || 0)} />

            <SectionLabel text="Stock by warehouse" />
            <DataTable
              maxHeight={320}
              rows={productDetail.data.inventory ?? []}
              emptyTitle="No warehouse records"
              emptyHint="This product has no inventory rows synced from JTL."
              columns={[
                { key: "warehouse_name", label: "Warehouse", strong: true, truncate: true },
                { key: "available", label: "Available", align: "right", render: (row) => number(row.available, 1) },
                { key: "reserved", label: "Reserved", align: "right", render: (row) => number(row.reserved, 1) },
                { key: "total", label: "Total", align: "right", render: (row) => number(row.total, 1) },
              ]}
            />
          </>
        )}
      </DetailPanel>
    </div>
  );
}
