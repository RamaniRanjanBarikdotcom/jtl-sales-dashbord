"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DS } from "@/lib/design-system";
import { ChartTip } from "@/components/charts/recharts/ChartTip";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { useFilterStore, useStore , sessionHasPermission} from "@/lib/store";
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
  useCompareProducts,
  useDeleteComparisonView,
  useProductDetail,
  useSaveComparisonView,
  useSavedComparisonViews,
  exportComparisonCsv,
} from "@/hooks/useComparisonData";
import { DataFreshnessBanner } from "@/components/analytics/DataFreshnessBanner";

const TABS: Array<{ id: ComparisonTab; label: string }> = [
  { id: "executive", label: "Executive Compare" },
  { id: "sales", label: "Sales & Channels" },
  { id: "products", label: "Product Performance" },
  { id: "inventory", label: "Inventory Performance" },
  { id: "customers", label: "Customer Analysis" },
  { id: "saved", label: "Saved Views" },
];

const card: React.CSSProperties = {
  border: `1px solid ${DS.border}`,
  borderRadius: 14,
  background: "rgba(8,12,18,0.82)",
  padding: 16,
};

const control: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${DS.border}`,
  color: DS.hi,
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 12,
};

function number(value: unknown, digits = 0) {
  return Number(value || 0).toLocaleString("de-DE", { maximumFractionDigits: digits });
}

function money(value: unknown) {
  return `${number(value, 2)} €`;
}

function Change({ value }: { value: unknown }) {
  const numeric = value == null ? null : Number(value);
  const color = numeric == null ? DS.lo : numeric >= 0 ? DS.emerald : DS.rose;
  return <span style={{ color, fontSize: 11 }}>{numeric == null ? "No baseline" : `${numeric >= 0 ? "+" : ""}${numeric.toFixed(1)}%`}</span>;
}

function Loading() {
  return <div style={{ ...card, color: DS.lo, minHeight: 180, display: "grid", placeItems: "center" }}>Loading real analytics…</div>;
}

function Empty({ text }: { text: string }) {
  return <div style={{ color: DS.lo, padding: "32px 8px", textAlign: "center", fontSize: 12 }}>{text}</div>;
}

function pct(value: unknown, digits = 1) {
  return `${number(value, digits)}%`;
}

function shortDate(value: unknown) {
  if (!value) return "";
  const text = String(value);
  return text.length > 10 ? text.slice(5, 10) : text;
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

function Pager({ page, total, limit, onChange }: { page: number; total: number; limit: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
      <button style={control} disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
      <span style={{ color: DS.lo, fontSize: 11 }}>Page {page} of {pages} · {number(total)} rows</span>
      <button style={control} disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
    </div>
  );
}

function DataTable({ columns, rows, onRow }: {
  columns: Array<{ key: string; label: string; render?: (row: any) => React.ReactNode }>;
  rows: any[];
  onRow?: (row: any) => void;
}) {
  if (!rows.length) return <Empty text="No records match the selected real-data filters." />;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
        <thead><tr>{columns.map((column) => (
          <th key={column.key} style={{ textAlign: "left", padding: "8px", borderBottom: `1px solid ${DS.border}`, color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em" }}>{column.label}</th>
        ))}</tr></thead>
        <tbody>{rows.map((row, index) => (
          <tr key={String(row.id ?? row.channel_id ?? row.jtl_customer_id ?? index)} onClick={() => onRow?.(row)}
            style={{ cursor: onRow ? "pointer" : "default", borderBottom: "1px solid rgba(255,255,255,.035)" }}>
            {columns.map((column) => <td key={column.key} style={{ padding: "10px 8px", color: DS.mid, fontSize: 11 }}>{column.render ? column.render(row) : String(row[column.key] ?? "—")}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function MiniTrend({ data, color }: { data: any[]; color: string }) {
  if (!data.length) return <Empty text="No sales trend for this channel in the selected period." />;
  return (
    <div style={{ width: "100%", height: 150 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id={`compareTrend-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.38} />
              <stop offset="100%" stopColor={color} stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={14} />
          <YAxis tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={44} tickFormatter={(value) => `€${number(value, 0)}`} />
          <Tooltip content={<ChartTip />} />
          <Area type="monotone" dataKey="revenue" name="Revenue" stroke={color} fill={`url(#compareTrend-${color.replace("#", "")})`} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function MetricStrip({ channel, color }: { channel: any; color: string }) {
  const metrics = [
    { label: "Total Revenue", value: money(channel?.revenue), change: channel?.revenue_change },
    { label: "Orders", value: number(channel?.orders), change: null },
    { label: "Avg. Order Value", value: money(channel?.average_order_value), change: null },
    { label: "Units", value: number(channel?.units, 1), change: null },
    { label: "Customers", value: number(channel?.customers), change: null },
    { label: "Products Sold", value: number(channel?.products_sold), change: null },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", border: `1px solid ${DS.border}`, borderRadius: 8, overflow: "hidden", background: "rgba(255,255,255,0.025)" }}>
      {metrics.map((metric, index) => (
        <div key={metric.label} style={{ padding: "12px 10px", borderLeft: index ? `1px solid ${DS.border}` : undefined }}>
          <div style={{ color: DS.lo, fontSize: 10 }}>{metric.label}</div>
          <div style={{ color: DS.hi, fontSize: 20, fontFamily: DS.mono, marginTop: 4 }}>{metric.value}</div>
          {metric.change != null && <div style={{ color, fontSize: 10, marginTop: 3 }}><Change value={metric.change} /></div>}
        </div>
      ))}
    </div>
  );
}

function ProductsMiniTable({ rows, accent }: { rows: any[]; accent: string }) {
  const topRows = rows.slice(0, 5);
  if (!topRows.length) return <Empty text="No product rows for this channel." />;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={{ textAlign: "left", padding: "8px 0", color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em" }}>Product</th>
          <th style={{ textAlign: "right", padding: "8px 0", color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em" }}>Revenue</th>
          <th style={{ textAlign: "right", padding: "8px 0", color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em" }}>Units</th>
        </tr>
      </thead>
      <tbody>
        {topRows.map((row, index) => (
          <tr key={String(row.id ?? row.sku ?? index)} style={{ borderTop: "1px solid rgba(255,255,255,.045)" }}>
            <td style={{ padding: "8px 0", color: DS.mid, fontSize: 11, maxWidth: 210, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 99, background: accent, marginRight: 7 }} />
              {row.name || row.product_name || "Unknown product"}
            </td>
            <td style={{ padding: "8px 0", color: DS.hi, fontSize: 11, textAlign: "right", fontFamily: DS.mono }}>{money(row.revenue)}</td>
            <td style={{ padding: "8px 0", color: DS.mid, fontSize: 11, textAlign: "right", fontFamily: DS.mono }}>{number(row.units, 1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChannelComparePanel({ title, channel, detail, trend, accent, options, onChange, channels }: {
  title: string;
  channel: any;
  detail: any;
  trend: any[];
  accent: string;
  options: any[];
  onChange: (id: string) => void;
  channels: any[];
}) {
  const displayName = channel?.channel_name || "Select channel";
  return (
    <section style={{ ...card, padding: 0, overflow: "hidden", borderColor: `${accent}66`, minWidth: 0 }}>
      <div style={{ background: `linear-gradient(135deg, ${accent}, rgba(10,21,37,0.85))`, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "rgba(255,255,255,0.72)", fontSize: 9, textTransform: "uppercase", letterSpacing: ".11em" }}>{title}</div>
          <h3 style={{ margin: "2px 0 0", color: "#fff", fontSize: 18, lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</h3>
        </div>
        <select value={channel?.channel_id || ""} onChange={(event) => onChange(event.target.value)} style={{ ...control, background: "rgba(2,5,8,.72)", color: "#fff", minWidth: 150 }} aria-label={`${title} selector`}>
          {options.map((item) => <option key={item.channel_id} value={item.channel_id}>{item.channel_name}</option>)}
        </select>
      </div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
        <MetricStrip channel={channel} color={accent} />
        <div>
          <div style={{ color: DS.hi, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Daily sales trend</div>
          {detail.isLoading ? <Loading /> : <MiniTrend data={trend} color={accent} />}
        </div>
        <div>
          <div style={{ color: DS.hi, fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Top products</div>
          <ProductsMiniTable rows={detail.data?.products?.rows ?? []} accent={accent} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {(channel?.raw_channels || channels.find((item) => item.channel_id === channel?.channel_id)?.raw_channels || []).slice(0, 4).map((raw: string) => (
            <span key={raw} style={{ border: `1px solid ${DS.border}`, borderRadius: 999, padding: "4px 8px", color: DS.lo, fontSize: 10 }}>{raw}</span>
          ))}
        </div>
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
  return (
    <div style={{ display: "grid", gap: 7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", color: DS.hi, fontSize: 12 }}>
        <span>{label}</span>
        <span style={{ color: DS.lo }}>{format(left)} / {format(right)}</span>
      </div>
      <div style={{ display: "grid", gap: 5 }}>
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", alignItems: "center", gap: 8 }}>
          <span style={{ color: DS.mid, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{leftName}</span>
          <div style={{ height: 9, background: "rgba(255,255,255,.05)", borderRadius: 99, overflow: "hidden" }}><div style={{ width: `${ratio(left, max)}%`, height: "100%", background: leftColor }} /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", alignItems: "center", gap: 8 }}>
          <span style={{ color: DS.mid, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{rightName}</span>
          <div style={{ height: 9, background: "rgba(255,255,255,.05)", borderRadius: 99, overflow: "hidden" }}><div style={{ width: `${ratio(right, max)}%`, height: "100%", background: rightColor }} /></div>
        </div>
      </div>
    </div>
  );
}

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
  const [selectedProduct, setSelectedProduct] = useState<number | null>(null);
  const [saveName, setSaveName] = useState("");
  const [selectedProducts, setSelectedProducts] = useState<number[]>([]);
  const [matrixPage, setMatrixPage] = useState(1);
  const [matrixMetric, setMatrixMetric] = useState<"revenue" | "units" | "orders" | "customers" | "margin">("revenue");
  const [isExporting, setIsExporting] = useState(false);

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
    page,
    limit: 50,
    deadStockDays,
  }), [compareMode, compareFrom, compareTo, granularity, category, region, warehouse, segment, country, minStock, maxStock, performance, search, page, deadStockDays]);

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
  const channelPairOptions = useMemo<ComparisonOptions>(() => ({
    ...options,
    channels: leftChannel && rightChannel ? `${leftChannel},${rightChannel}` : undefined,
  }), [options, leftChannel, rightChannel]);
  const matrixOptions = useMemo<ComparisonOptions>(() => ({
    ...options,
    page: matrixPage,
    limit: 100,
  }), [options, matrixPage]);

  const summary = useComparisonSummary(options, enabled && tab === "executive");
  const channels = useComparisonChannels({ ...options, page: 1, limit: 100 }, enabled && tab === "sales");
  const leftTrend = useComparisonTrend(leftOptions, enabled && tab === "sales" && Boolean(leftChannel));
  const rightTrend = useComparisonTrend(rightOptions, enabled && tab === "sales" && Boolean(rightChannel));
  const channelPair = useComparisonChannelPair(
    channelPairOptions,
    enabled && tab === "sales" && Boolean(leftChannel && rightChannel && leftChannel !== rightChannel),
  );
  const products = useComparisonProducts(options, enabled && tab === "products");
  const matrix = useComparisonMatrix(matrixOptions, enabled && tab === "products");
  const inventory = useComparisonInventory(options, enabled && tab === "inventory");
  const customers = useComparisonCustomers(options, enabled && tab === "customers");
  const segments = useComparisonSegments(options, enabled && tab === "customers");
  const saved = useSavedComparisonViews(enabled && tab === "saved");
  const channelDetail = useChannelDetail(selectedChannel, options);
  const leftDetail = useChannelDetail(leftChannel, leftOptions);
  const rightDetail = useChannelDetail(rightChannel, rightOptions);
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

  useEffect(() => {
    if (!channelRows.length) return;
    setLeftChannel((current) => current && channelRows.some((row: any) => row.channel_id === current) ? current : channelRows[0]?.channel_id ?? null);
    setRightChannel((current) => {
      if (current && channelRows.some((row: any) => row.channel_id === current)) return current;
      return channelRows.find((row: any) => row.channel_id !== channelRows[0]?.channel_id)?.channel_id ?? channelRows[0]?.channel_id ?? null;
    });
  }, [channelRows]);

  if (flags.isLoading) return <Loading />;
  if (!enabled) {
    return (
      <div style={card}>
        <h2 style={{ margin: 0, color: DS.hi, fontFamily: DS.display }}>Compare & Analyse</h2>
        <p style={{ color: DS.lo, fontSize: 12 }}>The production feature is installed but disabled. Enable <code>COMPARISON_CENTRE_ENABLED</code> and the required comparison module flags after applying migration 16.</p>
      </div>
    );
  }

  const switchTab = (next: ComparisonTab) => {
    setTab(next);
    setPage(1);
    setSelectedChannel(null);
    setSelectedProduct(null);
    setPerformance("all");
    setMatrixPage(1);
  };

  const exportDataset = tab === "sales" ? "channels" : tab === "products" ? "products" : tab === "inventory" ? "inventory" : tab === "customers" ? "customers" : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <DataFreshnessBanner />
      <section className="analytics-filter-panel" style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, color: DS.hi, fontFamily: DS.display }}>Sales Channel Comparison</h2>
            <p style={{ margin: "5px 0 0", color: DS.lo, fontSize: 11 }}>Side-by-side performance across real JTL channels, products, inventory, customers, and orders</p>
          </div>
          <div className="analytics-filter-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(145px,1fr))", gap: 8, width: "min(760px,100%)" }}>
            <label className="analytics-filter-field" style={{ display: "grid", gap: 4, color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em" }}>
              Date Range
              <select value={range} onChange={(event) => { setRange(event.target.value as any); setPage(1); }} style={control} aria-label="Date range">
                <option value="TODAY">Today</option>
                <option value="YESTERDAY">Yesterday</option>
                <option value="30D">Last 30 Days</option>
                <option value="7D">Last 7 Days</option>
                <option value="MONTH">This Month</option>
                <option value="PREVIOUS_MONTH">Previous Month</option>
                <option value="QUARTER">This Quarter</option>
                <option value="PREVIOUS_QUARTER">Previous Quarter</option>
                <option value="3M">Last 3 Months</option>
                <option value="6M">Last 6 Months</option>
                <option value="12M">Last 12 Months</option>
                <option value="YTD">Year To Date</option>
                <option value="YEAR">This Year</option>
                <option value="PREVIOUS_YEAR">Previous Year</option>
                <option value="ALL">All Time</option>
                <option value="custom">Custom Range</option>
              </select>
            </label>
            <label className="analytics-filter-field" style={{ display: "grid", gap: 4, color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em" }}>
              Product Category
              <input value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }} placeholder="All categories" style={control} />
            </label>
            <label className="analytics-filter-field" style={{ display: "grid", gap: 4, color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em" }}>
              Region
              <input value={region} onChange={(event) => { setRegion(event.target.value); setPage(1); }} placeholder="Global" style={control} />
            </label>
            <label className="analytics-filter-field" style={{ display: "grid", gap: 4, color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em" }}>
              Baseline
              <select value={compareMode} onChange={(event) => setCompareMode(event.target.value as ComparisonOptions["compareMode"])} style={control} aria-label="Comparison period">
                <option value="previous_period">Previous period</option>
                <option value="previous_year">Same period last year</option>
                <option value="custom">Custom baseline</option>
                <option value="none">No comparison</option>
              </select>
            </label>
            <label className="analytics-filter-field" style={{ display: "grid", gap: 4, color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em" }}>
              Grouping
              <select value={granularity} onChange={(event) => setGranularity(event.target.value as ComparisonOptions["granularity"])} style={control} aria-label="Comparison granularity">
                {["day", "week", "month", "quarter", "year"].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="analytics-filter-field" style={{ display: "grid", gap: 4, color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em" }}>
              Search
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Product or customer" style={control} />
            </label>
            {range === "custom" && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, gridColumn: "1 / -1" }}>
              <label style={{ display: "grid", gap: 4, color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em" }}>
                Current From
                <input type="date" value={from || ""} onChange={(event) => setCustom(event.target.value, to || event.target.value)} style={control} />
              </label>
              <label style={{ display: "grid", gap: 4, color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em" }}>
                Current To
                <input type="date" value={to || ""} onChange={(event) => setCustom(from || event.target.value, event.target.value)} style={control} />
              </label>
            </div>}
            {compareMode === "custom" && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, gridColumn: "1 / -1" }}>
              <label style={{ display: "grid", gap: 4, color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em" }}>
                Baseline From
                <input type="date" value={compareFrom} onChange={(event) => { setCompareFrom(event.target.value); setPage(1); }} style={control} />
              </label>
              <label style={{ display: "grid", gap: 4, color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em" }}>
                Baseline To
                <input type="date" value={compareTo} onChange={(event) => { setCompareTo(event.target.value); setPage(1); }} style={control} />
              </label>
            </div>}
          </div>
          <div className="analytics-header-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%", justifyContent: "flex-end" }}>
            <button className="analytics-clear-button" onClick={() => {
              resetGlobalFilters(); setCategory(""); setRegion(""); setSearch(""); setWarehouse("");
              setSegment(""); setCountry(""); setMinStock(""); setMaxStock(""); setPerformance("all");
              setCompareMode("previous_period"); setCompareFrom(""); setCompareTo(""); setGranularity("month"); setPage(1);
            }}>Clear filters</button>
            {canExportComparison && exportDataset && <button className="analytics-download-button" style={control} disabled={isExporting} onClick={async () => {
              try {
                setIsExporting(true);
                await exportComparisonCsv(exportDataset, options);
              } finally {
                setIsExporting(false);
              }
            }}>{isExporting ? "Preparing…" : "Download CSV"}</button>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 16 }}>
          {TABS.map((item) => <button key={item.id} onClick={() => switchTab(item.id)} style={{ ...control, color: tab === item.id ? DS.sky : DS.mid, borderColor: tab === item.id ? DS.sky : DS.border, cursor: "pointer" }}>{item.label}</button>)}
        </div>
        {tab !== "saved" && <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Name this view" style={{ ...control, flex: 1 }} />
          <button style={control} disabled={!saveName.trim() || saveView.isPending} onClick={() => saveView.mutate({ name: saveName.trim(), tab, config: options }, { onSuccess: () => setSaveName("") })}>Save view</button>
        </div>}
      </section>

      {tab === "executive" && (summary.isLoading ? <Loading /> : (
        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12 }}>
          {[
            ["Revenue", money(summary.data?.current?.revenue), summary.data?.change?.revenue],
            ["Orders", number(summary.data?.current?.orders), summary.data?.change?.orders],
            ["Average Order", money(summary.data?.current?.averageOrderValue), summary.data?.change?.averageOrderValue],
            ["Gross Margin", money(summary.data?.current?.grossMargin), summary.data?.change?.grossMargin],
            ["Units", number(summary.data?.current?.units), summary.data?.change?.units],
          ].map(([label, value, change]) => (
            <div key={String(label)} style={card}>
              <div style={{ color: DS.lo, fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</div>
              <div style={{ color: DS.hi, fontSize: 25, fontFamily: DS.display, margin: "12px 0 5px" }}>{value as string}</div>
              <Change value={change} />
            </div>
          ))}
          <div style={{ ...card, gridColumn: "1 / -1", color: DS.lo, fontSize: 11 }}>
            Current: {summary.data?.periods?.current?.start} → {summary.data?.periods?.current?.end}
            {summary.data?.periods?.comparison && <> · Baseline: {summary.data.periods.comparison.start} → {summary.data.periods.comparison.end}</>}
            {" · "}Last data: {summary.data?.freshness?.lastSyncedAt ? new Date(summary.data.freshness.lastSyncedAt).toLocaleString() : "not synced"}
          </div>
        </section>
      ))}

      {tab === "sales" && (
        <>
          {channels.isLoading ? <Loading /> : !channelRows.length ? <section style={card}><Empty text="No channels found for the selected filters." /></section> : (
            <>
              <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", gap: 14 }}>
                <ChannelComparePanel
                  title="Channel A"
                  channel={leftRow}
                  detail={leftDetail}
                  trend={leftTrendRows}
                  accent={leftAccent}
                  options={channelRows}
                  channels={channelRows}
                  onChange={(id) => setLeftChannel(id)}
                />
                <ChannelComparePanel
                  title="Channel B"
                  channel={rightRow}
                  detail={rightDetail}
                  trend={rightTrendRows}
                  accent={rightAccent}
                  options={channelRows}
                  channels={channelRows}
                  onChange={(id) => setRightChannel(id)}
                />
              </section>

              <section style={{ ...card, display: "grid", gap: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <h3 style={{ color: DS.hi, margin: 0, fontFamily: DS.display }}>Cross-Channel Insights</h3>
                    <p style={{ color: DS.lo, fontSize: 11, margin: "4px 0 0" }}>Revenue mix, order volume, and value quality for the selected pair.</p>
                  </div>
                  {canExportComparison && <button className="analytics-download-button" style={control} disabled={isExporting} onClick={async () => {
                    try {
                      setIsExporting(true);
                      await exportComparisonCsv("channels", options);
                    } finally {
                      setIsExporting(false);
                    }
                  }}>{isExporting ? "Preparing…" : "Download channels CSV"}</button>}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 14 }}>
                  <div style={{ display: "grid", gap: 13 }}>
                    <InsightBar label="Revenue" left={Number(leftRow?.revenue || 0)} right={Number(rightRow?.revenue || 0)} leftColor={leftAccent} rightColor={rightAccent} leftName={leftRow?.channel_name || "Channel A"} rightName={rightRow?.channel_name || "Channel B"} format={money} />
                    <InsightBar label="Orders" left={Number(leftRow?.orders || 0)} right={Number(rightRow?.orders || 0)} leftColor={leftAccent} rightColor={rightAccent} leftName={leftRow?.channel_name || "Channel A"} rightName={rightRow?.channel_name || "Channel B"} />
                    <InsightBar label="Average Order Value" left={Number(leftRow?.average_order_value || 0)} right={Number(rightRow?.average_order_value || 0)} leftColor={leftAccent} rightColor={rightAccent} leftName={leftRow?.channel_name || "Channel A"} rightName={rightRow?.channel_name || "Channel B"} format={money} />
                    <InsightBar label="Units" left={Number(leftRow?.units || 0)} right={Number(rightRow?.units || 0)} leftColor={leftAccent} rightColor={rightAccent} leftName={leftRow?.channel_name || "Channel A"} rightName={rightRow?.channel_name || "Channel B"} />
                    <InsightBar label="Customers" left={Number(leftRow?.customers || 0)} right={Number(rightRow?.customers || 0)} leftColor={leftAccent} rightColor={rightAccent} leftName={leftRow?.channel_name || "Channel A"} rightName={rightRow?.channel_name || "Channel B"} />
                    <InsightBar label="Products Sold" left={Number(leftRow?.products_sold || 0)} right={Number(rightRow?.products_sold || 0)} leftColor={leftAccent} rightColor={rightAccent} leftName={leftRow?.channel_name || "Channel A"} rightName={rightRow?.channel_name || "Channel B"} />
                  </div>

                  <div style={{ minHeight: 210 }}>
                    <ResponsiveContainer width="100%" height={210}>
                      <BarChart data={[
                        { name: leftRow?.channel_name || "Channel A", revenue: Number(leftRow?.revenue || 0), color: leftAccent },
                        { name: rightRow?.channel_name || "Channel B", revenue: Number(rightRow?.revenue || 0), color: rightAccent },
                      ]} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: DS.lo, fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: DS.lo, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(value) => `€${number(value, 0)}`} />
                        <Tooltip content={<ChartTip />} />
                        <Bar dataKey="revenue" name="Revenue" radius={[6, 6, 0, 0]}>
                          <Cell fill={leftAccent} />
                          <Cell fill={rightAccent} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div style={{ alignSelf: "start", border: `1px solid ${DS.border}`, borderRadius: 8, padding: 14, background: "rgba(255,255,255,0.025)" }}>
                    <div style={{ color: DS.lo, fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em" }}>Best Current Performer</div>
                    <div style={{ color: DS.hi, fontSize: 22, marginTop: 10, fontFamily: DS.display }}>
                      {Number(leftRow?.revenue || 0) >= Number(rightRow?.revenue || 0) ? leftRow?.channel_name : rightRow?.channel_name}
                    </div>
                    <div style={{ color: DS.mid, fontSize: 12, marginTop: 8 }}>
                      Revenue lead: {money(Math.abs(Number(leftRow?.revenue || 0) - Number(rightRow?.revenue || 0)))}
                    </div>
                    <div style={{ color: DS.lo, fontSize: 11, marginTop: 12 }}>
                      AOV gap: {money(Math.abs(Number(leftRow?.average_order_value || 0) - Number(rightRow?.average_order_value || 0)))} · Order gap: {number(Math.abs(Number(leftRow?.orders || 0) - Number(rightRow?.orders || 0)))}
                    </div>
                  </div>
                </div>
              </section>

              <section style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <h3 style={{ color: DS.hi, margin: 0, fontFamily: DS.display }}>Channel Product Relationship</h3>
                    <p style={{ color: DS.lo, fontSize: 11, margin: "4px 0 0" }}>Common, unique, and stocked-without-sales products for the selected channels.</p>
                  </div>
                  {canExportComparison && <button className="analytics-download-button" style={control} disabled={isExporting || !leftChannel || !rightChannel || leftChannel === rightChannel} onClick={async () => {
                    try {
                      setIsExporting(true);
                      await exportComparisonCsv("channel_pair", channelPairOptions);
                    } finally {
                      setIsExporting(false);
                    }
                  }}>Download relationship CSV</button>}
                </div>
                {leftChannel === rightChannel ? <Empty text="Choose two different channels to compare product relationships." /> : channelPair.isLoading ? <Loading /> : <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(120px,1fr))", gap: 8, margin: "14px 0" }}>
                    {[
                      ["Sold on Both", channelPair.data?.counts?.common],
                      [`Unique to ${leftRow?.channel_name || "A"}`, channelPair.data?.counts?.uniqueToA],
                      [`Unique to ${rightRow?.channel_name || "B"}`, channelPair.data?.counts?.uniqueToB],
                      ["Stocked, No Sales", channelPair.data?.counts?.stockedZeroSales],
                    ].map(([label, value]) => <div key={String(label)} style={{ border: `1px solid ${DS.border}`, borderRadius: 8, padding: 10 }}><div style={{ color: DS.lo, fontSize: 9 }}>{label}</div><div style={{ color: DS.hi, fontFamily: DS.mono, fontSize: 18, marginTop: 5 }}>{number(value)}</div></div>)}
                  </div>
                  <DataTable rows={channelPair.data?.rows ?? []} columns={[
                    { key: "name", label: "Product" }, { key: "sku", label: "SKU" }, { key: "relationship", label: "Relationship" },
                    { key: "revenue_a", label: `${leftRow?.channel_name || "A"} Revenue`, render: (row) => money(row.revenue_a) },
                    { key: "revenue_b", label: `${rightRow?.channel_name || "B"} Revenue`, render: (row) => money(row.revenue_b) },
                    { key: "units_a", label: "A Units", render: (row) => number(row.units_a, 1) },
                    { key: "units_b", label: "B Units", render: (row) => number(row.units_b, 1) },
                    { key: "total_stock", label: "Current Stock", render: (row) => number(row.total_stock, 1) },
                  ]} />
                  <Pager page={channelPair.data?.page || page} total={channelPair.data?.total || 0} limit={channelPair.data?.limit || 50} onChange={setPage} />
                </>}
              </section>

              <section style={card}>
                <h3 style={{ color: DS.hi, marginTop: 0, fontFamily: DS.display }}>All Channels</h3>
                <DataTable rows={channelRows} onRow={(row) => setSelectedChannel(row.channel_id)} columns={[
                  { key: "channel_name", label: "Channel" },
                  { key: "channel_type", label: "Type" },
                  { key: "revenue", label: "Revenue", render: (row) => money(row.revenue) },
                  { key: "orders", label: "Orders", render: (row) => number(row.orders) },
                  { key: "units", label: "Units", render: (row) => number(row.units, 1) },
                  { key: "customers", label: "Customers", render: (row) => number(row.customers) },
                  { key: "products_sold", label: "Products", render: (row) => number(row.products_sold) },
                  { key: "stocked_zero_sales", label: "Stock, No Sales", render: (row) => number(row.stocked_zero_sales) },
                  { key: "returns", label: "Returns", render: (row) => number(row.returns) },
                  { key: "average_order_value", label: "AOV", render: (row) => money(row.average_order_value) },
                  { key: "revenue_change", label: "Change", render: (row) => <Change value={row.revenue_change} /> },
                ]} />
              </section>

              {selectedChannel && <div style={{ ...card, marginTop: 0, borderColor: DS.sky }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><strong style={{ color: DS.hi }}>Channel detail</strong><button style={control} onClick={() => setSelectedChannel(null)}>Close</button></div>
                {channelDetail.isLoading ? <Loading /> : <>
                  <p style={{ color: DS.mid, fontSize: 12 }}>{channelDetail.data?.channel?.channel_name} · Raw identifiers: {(channelDetail.data?.channel?.raw_channels || []).join(", ")}</p>
                  <DataTable rows={channelDetail.data?.products?.rows ?? []} columns={[
                    { key: "name", label: "Product" }, { key: "sku", label: "SKU" },
                    { key: "revenue", label: "Revenue", render: (row) => money(row.revenue) },
                    { key: "units", label: "Units", render: (row) => number(row.units, 1) },
                  ]} />
                  <h4 style={{ color: DS.hi, marginBottom: 8 }}>Stocked products with no sales on this channel</h4>
                  <DataTable rows={channelDetail.data?.stockedWithoutSales?.rows ?? []} columns={[
                    { key: "name", label: "Product" }, { key: "sku", label: "SKU" },
                    { key: "category", label: "Category" },
                    { key: "stock", label: "Stock", render: (row) => number(row.stock, 1) },
                    { key: "last_sale_date", label: "Last Sale", render: (row) => row.last_sale_date ? String(row.last_sale_date).slice(0, 10) : "Never on channel" },
                  ]} />
                </>}
              </div>}
            </>
          )}
        </>
      )}

      {tab === "products" && (
        <>
          <section style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <h3 style={{ color: DS.hi, margin: 0, fontFamily: DS.display }}>Product Performance</h3>
              <select value={performance} onChange={(event) => { setPerformance(event.target.value); setPage(1); }} style={control}>
                <option value="all">All products</option><option value="with_sales">With sales</option><option value="zero_sales">Zero sales</option><option value="with_stock">With stock</option><option value="without_stock">Without stock</option><option value="stock_no_sales">Stock but no sales</option><option value="growing">Growing</option><option value="declining">Declining</option>
              </select>
            </div>
            {products.isLoading ? <Loading /> : <>
              <DataTable rows={products.data?.rows ?? []} onRow={(row) => setSelectedProduct(Number(row.id))} columns={[
                { key: "select", label: "Compare", render: (row) => <input type="checkbox" checked={selectedProducts.includes(Number(row.id))} onClick={(event) => event.stopPropagation()} onChange={(event) => setSelectedProducts((current) => event.target.checked ? [...current, Number(row.id)].slice(-5) : current.filter((id) => id !== Number(row.id)))} /> },
                { key: "name", label: "Product" }, { key: "sku", label: "SKU" }, { key: "category", label: "Category" },
                { key: "revenue", label: "Revenue", render: (row) => money(row.revenue) },
                { key: "units", label: "Units", render: (row) => number(row.units, 1) },
                { key: "stock", label: "Stock", render: (row) => number(row.stock, 1) },
                { key: "revenue_change", label: "Change", render: (row) => <Change value={row.revenue_change} /> },
              ]} />
              <Pager page={products.data?.page || 1} total={products.data?.total || 0} limit={products.data?.limit || 50} onChange={setPage} />
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                <button style={control} disabled={selectedProducts.length < 2 || compareProducts.isPending} onClick={() => compareProducts.mutate(selectedProducts)}>Compare selected</button>
                <span style={{ color: DS.lo, fontSize: 11 }}>{selectedProducts.length}/5 selected</span>
              </div>
              {compareProducts.data && <div style={{ ...card, marginTop: 12, borderColor: DS.emerald }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <strong style={{ color: DS.hi }}>Side-by-side comparison</strong>
                  {canExportComparison && <button className="analytics-download-button" style={control} disabled={isExporting} onClick={async () => { try { setIsExporting(true); await exportComparisonCsv("products", { ...options, productIds: selectedProducts.join(",") }); } finally { setIsExporting(false); } }}>Download selected CSV</button>}
                </div>
                <DataTable rows={compareProducts.data} columns={[
                  { key: "name", label: "Product" }, { key: "sku", label: "SKU" },
                  { key: "revenue", label: "Revenue", render: (row) => money(row.revenue) },
                  { key: "units", label: "Units", render: (row) => number(row.units, 1) },
                  { key: "orders", label: "Orders", render: (row) => number(row.orders) },
                  { key: "customers", label: "Customers", render: (row) => number(row.customers) },
                  { key: "channel_names", label: "Channels" },
                  { key: "stock", label: "Stock", render: (row) => number(row.stock, 1) },
                  { key: "sales_velocity", label: "Velocity", render: (row) => `${number(row.sales_velocity, 2)}/day` },
                  { key: "last_sale", label: "Last Sale", render: (row) => row.last_sale ? String(row.last_sale).slice(0, 10) : "Never" },
                  { key: "returns", label: "Returns", render: (row) => number(row.returns) },
                  { key: "margin", label: "Margin", render: (row) => row.margin == null ? "Unavailable" : `${number(row.margin, 1)}%` },
                  { key: "trend", label: "Period Trend", render: (row) => Array.isArray(row.trend) && row.trend.length ? row.trend.map((point: any) => `${String(point.period).slice(0, 7)} ${money(point.revenue)}`).join(" · ") : "No sales trend" },
                ]} />
              </div>}
            </>}
            {selectedProduct && <div style={{ ...card, marginTop: 14, borderColor: DS.violet }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><strong style={{ color: DS.hi }}>Product drill-through</strong><button style={control} onClick={() => setSelectedProduct(null)}>Close</button></div>
              {productDetail.isLoading ? <Loading /> : <p style={{ color: DS.mid, fontSize: 12 }}>{productDetail.data?.product?.name} · {productDetail.data?.inventory?.length || 0} warehouse records · Current stock {number(productDetail.data?.performance?.stock, 1)}</p>}
            </div>}
          </section>
          <section style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <h3 style={{ color: DS.hi, margin: 0, fontFamily: DS.display }}>Product × Channel Matrix</h3>
                <p style={{ color: DS.lo, fontSize: 10, margin: "4px 0 0" }}>Server-paginated combinations · zero means no recorded sales in this result page.</p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={matrixMetric} onChange={(event) => setMatrixMetric(event.target.value as typeof matrixMetric)} style={control}>
                  <option value="revenue">Revenue</option>
                  <option value="units">Units</option>
                  <option value="orders">Orders</option>
                  <option value="customers">Customers</option>
                  <option value="margin">Margin</option>
                </select>
                {canExportComparison && <button className="analytics-download-button" style={control} disabled={isExporting} onClick={async () => {
                  try {
                    setIsExporting(true);
                    await exportComparisonCsv("product_channel_matrix", matrixOptions);
                  } finally {
                    setIsExporting(false);
                  }
                }}>Download matrix CSV</button>}
              </div>
            </div>
            {matrix.isLoading ? <Loading /> : matrixRows.length === 0 ? <p style={{ color: DS.lo, fontSize: 12 }}>No product-channel sales found for the selected filters.</p> : <>
              <div style={{ overflow: "auto", maxHeight: 520, border: `1px solid ${DS.border}`, borderRadius: 9, marginTop: 14 }}>
                <table style={{ borderCollapse: "collapse", minWidth: Math.max(760, 310 + matrixChannels.length * 145), width: "100%" }}>
                  <thead><tr>
                    <th style={{ position: "sticky", left: 0, top: 0, zIndex: 3, textAlign: "left", padding: "9px 10px", color: DS.lo, background: DS.surface, borderBottom: `1px solid ${DS.border}` }}>Product / SKU</th>
                    {matrixChannels.map(([channelId, channelName]) => <th key={channelId} style={{ position: "sticky", top: 0, zIndex: 2, textAlign: "right", padding: "9px 10px", color: DS.lo, background: DS.surface, borderBottom: `1px solid ${DS.border}` }}>{channelName}</th>)}
                    <th style={{ position: "sticky", top: 0, zIndex: 2, textAlign: "right", padding: "9px 10px", color: DS.sky, background: DS.surface, borderBottom: `1px solid ${DS.border}` }}>Page Total</th>
                  </tr></thead>
                  <tbody>{matrixProducts.map((product) => {
                    const values = matrixChannels.map(([channelId]) => matrixLookup.get(`${product.id}:${channelId}`) ?? null);
                    const numericValues = values.filter((value): value is number => value != null);
                    const total = matrixMetric === "margin"
                      ? (numericValues.length ? numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length : null)
                      : numericValues.reduce((sum, value) => sum + value, 0);
                    return <tr key={product.id} style={{ borderBottom: `1px solid rgba(255,255,255,.04)` }}>
                      <td style={{ position: "sticky", left: 0, zIndex: 1, padding: "9px 10px", background: DS.surface }}><div style={{ color: DS.hi, fontSize: 11 }}>{product.name}</div><div style={{ color: DS.lo, fontFamily: DS.mono, fontSize: 9 }}>{product.sku || "No SKU"}</div></td>
                      {values.map((value, index) => <td key={matrixChannels[index][0]} style={{ textAlign: "right", padding: "9px 10px", color: value != null && value > 0 ? DS.mid : DS.lo, fontFamily: DS.mono, fontSize: 10 }}>{value == null ? "Unavailable" : matrixMetric === "revenue" ? money(value) : matrixMetric === "margin" ? `${number(value, 1)}%` : number(value, 1)}</td>)}
                      <td style={{ textAlign: "right", padding: "9px 10px", color: DS.sky, fontFamily: DS.mono, fontWeight: 700, fontSize: 10 }}>{total == null ? "Unavailable" : matrixMetric === "revenue" ? money(total) : matrixMetric === "margin" ? `${number(total, 1)}% avg` : number(total, 1)}</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
              <Pager page={matrix.data?.page || matrixPage} total={matrix.data?.total || 0} limit={matrix.data?.limit || 100} onChange={setMatrixPage} />
            </>}
          </section>
        </>
      )}

      {tab === "inventory" && (
        <section style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <h3 style={{ color: DS.hi, margin: 0, fontFamily: DS.display }}>Inventory Performance</h3>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={warehouse} onChange={(event) => { setWarehouse(event.target.value); setPage(1); }} placeholder="Warehouse" style={{ ...control, width: 140 }} />
              <input type="number" min={0} value={minStock} onChange={(event) => { setMinStock(event.target.value); setPage(1); }} placeholder="Min stock" style={{ ...control, width: 100 }} />
              <input type="number" min={0} value={maxStock} onChange={(event) => { setMaxStock(event.target.value); setPage(1); }} placeholder="Max stock" style={{ ...control, width: 100 }} />
              <select value={performance} onChange={(event) => { setPerformance(event.target.value); setPage(1); }} style={control}>
                <option value="all">All stock</option><option value="fast_moving">Fast moving</option><option value="slow_moving">Slow moving</option><option value="dead_stock">Dead stock</option><option value="overstock">Overstock</option><option value="stockout_risk">Stockout risk</option>
              </select>
              <input type="number" min={1} value={deadStockDays} onChange={(event) => setDeadStockDays(Math.max(1, Number(event.target.value)))} style={{ ...control, width: 90 }} title="Dead stock days" />
            </div>
          </div>
          {inventory.isLoading ? <Loading /> : <>
            <DataTable rows={inventory.data?.rows ?? []} columns={[
              { key: "name", label: "Product" }, { key: "sku", label: "SKU" }, { key: "warehouses", label: "Warehouses" },
              { key: "stock", label: "Stock", render: (row) => number(row.stock, 1) },
              { key: "stock_value", label: "Value", render: (row) => money(row.stock_value) },
              { key: "units_30d", label: "Units 30d", render: (row) => number(row.units_30d, 1) },
              { key: "stock_cover_days", label: "Cover", render: (row) => row.stock_cover_days == null ? "No demand" : `${number(row.stock_cover_days, 1)} days` },
              { key: "classification", label: "Class" },
            ]} />
            <Pager page={inventory.data?.page || 1} total={inventory.data?.total || 0} limit={inventory.data?.limit || 50} onChange={setPage} />
          </>}
        </section>
      )}

      {tab === "customers" && (
        <>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
            {(segments.data || []).map((segment) => <div key={segment.segment} style={card}><div style={{ color: DS.hi }}>{segment.segment}</div><div style={{ color: DS.sky, fontSize: 22, marginTop: 8 }}>{number(segment.customers)}</div><div style={{ color: DS.lo, fontSize: 10 }}>{money(segment.total_ltv)} LTV</div></div>)}
          </section>
          <section style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <h3 style={{ color: DS.hi, margin: 0, fontFamily: DS.display }}>Customer Analysis</h3>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input value={segment} onChange={(event) => { setSegment(event.target.value); setPage(1); }} placeholder="Segment" style={{ ...control, width: 120 }} />
                <input value={country} onChange={(event) => { setCountry(event.target.value); setPage(1); }} placeholder="Country" style={{ ...control, width: 110 }} />
                <select value={performance} onChange={(event) => { setPerformance(event.target.value); setPage(1); }} style={control}>
                  <option value="all">All customers</option><option value="new">New</option><option value="repeat">Repeat</option><option value="one_time">One-time</option><option value="high_value">High-value</option><option value="at_risk">At risk</option><option value="inactive">Inactive</option><option value="reactivated">Reactivated</option><option value="single_channel">Single-channel</option><option value="multi_channel">Multi-channel</option>
                </select>
              </div>
            </div>
            {customers.isLoading ? <Loading /> : <>
              <DataTable rows={customers.data?.rows ?? []} columns={[
                { key: "display_name", label: "Customer" }, { key: "company", label: "Company" }, { key: "segment", label: "RFM Segment" },
                { key: "customer_type", label: "Type" }, { key: "total_orders", label: "Orders", render: (row) => number(row.total_orders) },
                { key: "ltv", label: "LTV", render: (row) => money(row.ltv) }, { key: "days_since_last_order", label: "Recency", render: (row) => `${number(row.days_since_last_order)} days` },
              ]} />
              <Pager page={customers.data?.page || 1} total={customers.data?.total || 0} limit={customers.data?.limit || 50} onChange={setPage} />
            </>}
          </section>
        </>
      )}

      {tab === "saved" && (
        <section style={card}>
          <h3 style={{ color: DS.hi, marginTop: 0, fontFamily: DS.display }}>Saved Views</h3>
          <DataTable rows={saved.data || []} columns={[
            { key: "name", label: "Name" }, { key: "tab", label: "Tab" },
            { key: "updated_at", label: "Updated", render: (row) => new Date(row.updated_at).toLocaleString() },
            { key: "apply", label: "", render: (row) => <button style={{ ...control, color: DS.sky }} onClick={(event) => {
              event.stopPropagation();
              const config = row.config || {};
              if (config.compareMode) setCompareMode(config.compareMode);
              if (config.granularity) setGranularity(config.granularity);
              if (config.performance) setPerformance(config.performance);
              if (config.deadStockDays) setDeadStockDays(Number(config.deadStockDays));
              if (["executive", "sales", "products", "inventory", "customers"].includes(row.tab)) setTab(row.tab);
            }}>Apply</button> },
            { key: "actions", label: "", render: (row) => <button style={{ ...control, color: DS.rose }} onClick={(event) => { event.stopPropagation(); deleteView.mutate(row.id); }}>Delete</button> },
          ]} />
        </section>
      )}
    </div>
  );
}
