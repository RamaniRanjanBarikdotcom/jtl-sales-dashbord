"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AreaChart, Area, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import { useInventoryAlertsPaged, useInventoryKpis, useInventoryListPaged, useInventoryMovementsPaged } from "@/hooks/useInventoryData";
import { useProductsCategories } from "@/hooks/useProductsData";
import { ChartTip } from "@/components/charts/recharts/ChartTip";

interface Props {
  open: boolean;
  onClose: () => void;
}

type StockStatus = "all" | "out_of_stock" | "low_stock" | "in_stock";

function stockState(stock: number): Exclude<StockStatus, "all"> {
  if (stock <= 0) return "out_of_stock";
  if (stock <= 5) return "low_stock";
  return "in_stock";
}

const DSI_BAR_COLORS = {
  critical: DS.rose,
  low: DS.amber,
  normal: DS.sky,
  healthy: DS.emerald,
};

function fmtTick(raw: string | number): string {
  const value = String(raw ?? "");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function shortLabel(value: string, max = 28): string {
  if (!value) return "-";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function InventoryTrendFullModal({ open, onClose }: Props) {
  const DSI_PAGE_SIZE = 12;
  const ALERTS_PAGE_SIZE = 14;
  const CATEGORIES_PAGE_SIZE = 10;
  const [mounted, setMounted] = useState(false);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StockStatus>("all");
  const [page, setPage] = useState(1);
  const [dsiPage, setDsiPage] = useState(1);
  const [alertsPage, setAlertsPage] = useState(1);
  const [alertsStatus, setAlertsStatus] = useState<"all" | "out_of_stock" | "low_stock">("all");
  const [categoryPage, setCategoryPage] = useState(1);

  const kpisQ = useInventoryKpis();
  const alertsQ = useInventoryAlertsPaged({ page: alertsPage, limit: ALERTS_PAGE_SIZE, status: alertsStatus });
  const movementsQ = useInventoryMovementsPaged({
    page: dsiPage,
    limit: DSI_PAGE_SIZE,
    enabled: open,
    refetchInterval: 15_000,
  });
  const categoriesQ = useProductsCategories();
  const listQ = useInventoryListPaged({ page, limit: 20, search: appliedSearch, status: statusFilter });

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setAppliedSearch("");
    setStatusFilter("all");
    setPage(1);
    setDsiPage(1);
    setAlertsPage(1);
    setAlertsStatus("all");
    setCategoryPage(1);
  }, [open]);

  useEffect(() => {
    const id = setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  useEffect(() => {
    setAlertsPage(1);
  }, [alertsStatus]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const kpis = kpisQ.data ?? {
    totalValue: 0,
    lowStockCount: 0,
    outOfStock: 0,
    avgSellThrough: 0,
    warehouseFillPct: 0,
    valueLabel: "at list price",
  };
  const daily = movementsQ.data?.daily ?? [];
  const dsi = movementsQ.data?.dsi ?? [];
  const alerts = alertsQ.data?.rows ?? [];
  const categoryValuation = categoriesQ.data ?? [];
  const totalPagesFromServer = Math.max(1, Math.ceil((listQ.data?.total ?? 0) / (listQ.data?.limit ?? 20)));
  const filteredRows = listQ.data?.rows ?? [];
  const dsiTotalPages = Math.max(1, Math.ceil((movementsQ.data?.dsi_total ?? dsi.length) / (movementsQ.data?.dsi_limit ?? DSI_PAGE_SIZE)));
  const alertsTotalPages = Math.max(1, Math.ceil((alertsQ.data?.total ?? alerts.length) / (alertsQ.data?.limit ?? ALERTS_PAGE_SIZE)));
  const categoriesTotalPages = Math.max(1, Math.ceil(categoryValuation.length / CATEGORIES_PAGE_SIZE));
  const categorySlice = categoryValuation.slice((categoryPage - 1) * CATEGORIES_PAGE_SIZE, categoryPage * CATEGORIES_PAGE_SIZE);

  const topDsiRows = dsi;
  const dsiRiskBuckets = topDsiRows.reduce(
    (acc: { critical: number; low: number; normal: number; healthy: number }, row: any) => {
      const v = Number(row?.dsi ?? 999);
      if (v <= 0) acc.critical += 1;
      else if (v <= 7) acc.low += 1;
      else if (v <= 30) acc.normal += 1;
      else acc.healthy += 1;
      return acc;
    },
    { critical: 0, low: 0, normal: 0, healthy: 0 },
  );

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(0,0,0,0.82)", backdropFilter: "blur(5px)" }} />
      <div
        style={{
          position: "fixed",
          inset: "3.5vh 2.5vw",
          zIndex: 1310,
          borderRadius: 18,
          border: "1px solid rgba(56,189,248,0.25)",
          background: "#071122",
          boxShadow: "0 30px 80px rgba(0,0,0,0.8)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${DS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "rgba(255,255,255,0.015)" }}>
          <div>
            <div style={{ fontSize: 16, color: DS.hi, fontWeight: 700 }}>Inventory Stock Management - Full View</div>
            <div style={{ fontSize: 11, color: DS.lo, marginTop: 3 }}>Live stock, alerts, DSI, valuation, and product records</div>
          </div>
          <button onClick={onClose} style={{ fontSize: 12, color: DS.hi, background: "rgba(255,255,255,0.04)", border: `1px solid ${DS.border}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>
            Close
          </button>
        </div>

        <div style={{ padding: 16, overflow: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            <MetricCard label={kpis.valueLabel === "catalog (list price)" ? "Catalog Value" : "Stock Value"} value={eur(kpis.totalValue)} color={DS.sky} />
            <MetricCard label="Low Stock" value={kpis.lowStockCount.toLocaleString("en-US")} color={DS.amber} />
            <MetricCard label="Out Of Stock" value={kpis.outOfStock.toLocaleString("en-US")} color={DS.rose} />
            <MetricCard label="In-Stock Rate" value={`${kpis.avgSellThrough}%`} color={DS.emerald} />
          </div>

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1.2fr 1fr" }}>
            <ChartShell title="Stock Movements" sub="Incoming vs Outgoing">
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: DS.lo }}>Auto-refresh: every 15s</span>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={daily} margin={{ top: 5, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="movInOverviewFull" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={DS.emerald} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={DS.emerald} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="movOutOverviewFull" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={DS.sky} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={DS.sky} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="d" tick={{ fill: DS.lo, fontSize: 9 }} tickFormatter={fmtTick} minTickGap={24} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={34} />
                  <Tooltip content={<ChartTip />} />
                  <Area type="monotone" dataKey="ord" name="Out" stroke={DS.sky} fill="url(#movOutOverviewFull)" dot={false} />
                  <Area type="monotone" dataKey="rev" name="In" stroke={DS.emerald} fill="url(#movInOverviewFull)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartShell>

            <ChartShell title="Days Of Stock (DSI)" sub="Top risk SKUs (cleaned)">
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(4, minmax(0,1fr))" }}>
                  <RiskPill label="Critical" value={dsiRiskBuckets.critical} color={DSI_BAR_COLORS.critical} />
                  <RiskPill label="Low" value={dsiRiskBuckets.low} color={DSI_BAR_COLORS.low} />
                  <RiskPill label="Normal" value={dsiRiskBuckets.normal} color={DSI_BAR_COLORS.normal} />
                  <RiskPill label="Healthy" value={dsiRiskBuckets.healthy} color={DSI_BAR_COLORS.healthy} />
                </div>
                <div style={{ maxHeight: 178, overflow: "auto", border: `1px solid ${DS.border}`, borderRadius: 8, background: "rgba(255,255,255,0.01)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {["Product", "DSI", "Trend"].map((h) => (
                          <th key={h} style={{ textAlign: "left", fontSize: 10, color: DS.lo, letterSpacing: "0.06em", textTransform: "uppercase", padding: "8px 10px", borderBottom: `1px solid ${DS.border}`, position: "sticky", top: 0, background: "#091327" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {topDsiRows.map((row: any, idx: number) => {
                        const dsiValue = Number(row?.dsi ?? 0);
                        const barPct = Math.min(100, Math.round((Math.min(dsiValue, 120) / 120) * 100));
                        const color = dsiValue === 0 ? DSI_BAR_COLORS.critical : dsiValue <= 7 ? DSI_BAR_COLORS.low : dsiValue <= 30 ? DSI_BAR_COLORS.normal : DSI_BAR_COLORS.healthy;
                        return (
                          <tr key={`${row?.name ?? "row"}-${idx}`}>
                            <td style={{ padding: "8px 10px", fontSize: 11, color: DS.hi, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row?.name || ""}>
                              {shortLabel(String(row?.name || "-"), 32)}
                            </td>
                            <td style={{ padding: "8px 10px", fontSize: 11, color, fontFamily: DS.mono }}>{dsiValue}d</td>
                            <td style={{ padding: "8px 10px" }}>
                              <div style={{ height: 5, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                                <div style={{ width: `${barPct}%`, height: "100%", background: color }} />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: DS.lo }}>
                    Page {movementsQ.data?.dsi_page ?? dsiPage} / {dsiTotalPages} - {movementsQ.data?.dsi_total ?? topDsiRows.length} total SKUs
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setDsiPage((p) => Math.max(1, p - 1))} disabled={dsiPage <= 1} style={pagerBtn(dsiPage <= 1)}>
                      Prev
                    </button>
                    <button onClick={() => setDsiPage((p) => Math.min(dsiTotalPages, p + 1))} disabled={dsiPage >= dsiTotalPages} style={pagerBtn(dsiPage >= dsiTotalPages)}>
                      Next
                    </button>
                  </div>
                </div>
              </div>
            </ChartShell>
          </div>

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
            <ChartShell title="Inventory Alerts" sub="Products requiring action">
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                <select
                  value={alertsStatus}
                  onChange={(e) => setAlertsStatus(e.target.value as "all" | "out_of_stock" | "low_stock")}
                  style={{ fontSize: 11, color: DS.hi, background: "rgba(255,255,255,0.04)", border: `1px solid ${DS.border}`, borderRadius: 8, padding: "6px 8px" }}
                >
                  <option value="all">All Alerts</option>
                  <option value="out_of_stock">Out of Stock</option>
                  <option value="low_stock">Low Stock</option>
                </select>
              </div>
              <div style={{ maxHeight: 240, overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Product", "SKU", "Stock", "Status", "DSI"].map((h) => (
                        <th key={h} style={{ textAlign: "left", fontSize: 10, color: DS.lo, letterSpacing: "0.06em", textTransform: "uppercase", padding: "8px 10px", borderBottom: `1px solid ${DS.border}`, position: "sticky", top: 0, background: "#091327" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {alertsQ.isLoading && (
                      <tr><td colSpan={5} style={{ padding: "10px", fontSize: 12, color: DS.lo }}>Loading alerts...</td></tr>
                    )}
                    {!alertsQ.isLoading && alerts.length === 0 && (
                      <tr><td colSpan={5} style={{ padding: "10px", fontSize: 12, color: DS.lo }}>No alerts found.</td></tr>
                    )}
                    {!alertsQ.isLoading && alerts.map((row: any, idx: number) => (
                      <tr key={`${row.product}-${idx}`}>
                        <td style={{ padding: "8px 10px", fontSize: 12, color: DS.hi, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.product}>{shortLabel(row.product, 38)}</td>
                        <td style={{ padding: "8px 10px", fontSize: 11, color: DS.lo, fontFamily: DS.mono }}>{row.warehouse}</td>
                        <td style={{ padding: "8px 10px", fontSize: 12, color: DS.hi, fontFamily: DS.mono }}>{row.stock}</td>
                        <td style={{ padding: "8px 10px", fontSize: 11, color: row.status === "out_of_stock" ? DS.rose : DS.amber }}>
                          {row.status === "out_of_stock" ? "Out of Stock" : "Low Stock"}
                        </td>
                        <td style={{ padding: "8px 10px", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{row.dsi} days</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <span style={{ fontSize: 10, color: DS.lo }}>
                  Page {alertsQ.data?.page ?? alertsPage} / {alertsTotalPages} - {alertsQ.data?.total ?? alerts.length} total alerts
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setAlertsPage((p) => Math.max(1, p - 1))} disabled={alertsPage <= 1} style={pagerBtn(alertsPage <= 1)}>
                    Prev
                  </button>
                  <button onClick={() => setAlertsPage((p) => Math.min(alertsTotalPages, p + 1))} disabled={alertsPage >= alertsTotalPages} style={pagerBtn(alertsPage >= alertsTotalPages)}>
                    Next
                  </button>
                </div>
              </div>
            </ChartShell>

            <ChartShell title="Category Valuation Snapshot" sub="Share by category">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={categorySlice} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barSize={12}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                  <XAxis type="number" tick={false} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: DS.lo, fontSize: 9 }} tickFormatter={(value) => shortLabel(String(value), 18)} axisLine={false} tickLine={false} width={96} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="v" name="Value %" radius={[0, 4, 4, 0]}>
                    {categorySlice.map((c: any, i: number) => <Cell key={i} fill={c.c} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                <span style={{ fontSize: 10, color: DS.lo }}>
                  Page {categoryPage} / {categoriesTotalPages} - {categoryValuation.length} categories
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setCategoryPage((p) => Math.max(1, p - 1))} disabled={categoryPage <= 1} style={pagerBtn(categoryPage <= 1)}>
                    Prev
                  </button>
                  <button onClick={() => setCategoryPage((p) => Math.min(categoriesTotalPages, p + 1))} disabled={categoryPage >= categoriesTotalPages} style={pagerBtn(categoryPage >= categoriesTotalPages)}>
                    Next
                  </button>
                </div>
              </div>
            </ChartShell>
          </div>

          <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", overflow: "hidden" }}>
            <div style={{ padding: "10px 12px", borderBottom: `1px solid ${DS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600 }}>Inventory Product Records</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as StockStatus)}
                  style={{ fontSize: 11, color: DS.hi, background: "rgba(255,255,255,0.04)", border: `1px solid ${DS.border}`, borderRadius: 8, padding: "6px 8px" }}
                >
                  <option value="all">All Stock</option>
                  <option value="out_of_stock">Out of Stock</option>
                  <option value="low_stock">Low Stock</option>
                  <option value="in_stock">In Stock</option>
                </select>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search product/SKU..."
                  style={{ width: 220, fontSize: 11, color: DS.hi, background: "rgba(255,255,255,0.04)", border: `1px solid ${DS.border}`, borderRadius: 8, padding: "6px 9px" }}
                />
              </div>
            </div>

            <div style={{ maxHeight: 320, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Product", "SKU", "Category", "Stock", "Reserved", "List Price", "Status"].map((h) => (
                      <th key={h} style={{ textAlign: "left", fontSize: 10, color: DS.lo, letterSpacing: "0.06em", textTransform: "uppercase", padding: "8px 12px", borderBottom: `1px solid ${DS.border}`, position: "sticky", top: 0, background: "#091327" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {listQ.isLoading && (
                    <tr><td colSpan={7} style={{ padding: "10px 12px", fontSize: 12, color: DS.lo }}>Loading inventory records...</td></tr>
                  )}
                  {!listQ.isLoading && filteredRows.length === 0 && (
                    <tr><td colSpan={7} style={{ padding: "10px 12px", fontSize: 12, color: DS.lo }}>No records found for current filters.</td></tr>
                  )}
                  {!listQ.isLoading && filteredRows.map((row: any, idx: number) => {
                    const stock = Number(row.total_available ?? row.stock_quantity ?? 0);
                    const state = stockState(stock);
                    const color = state === "out_of_stock" ? DS.rose : state === "low_stock" ? DS.amber : DS.emerald;
                    return (
                      <tr key={`${row.id ?? row.article_number ?? idx}`}>
                        <td style={{ padding: "8px 12px", fontSize: 12, color: DS.hi, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.product_name || ""}>{shortLabel(String(row.product_name || "-"), 42)}</td>
                        <td style={{ padding: "8px 12px", fontSize: 11, color: DS.lo, fontFamily: DS.mono }}>{row.article_number || "-"}</td>
                        <td style={{ padding: "8px 12px", fontSize: 11, color: DS.mid, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.category_name || "Uncategorized"}</td>
                        <td style={{ padding: "8px 12px", fontSize: 12, color, fontFamily: DS.mono }}>{stock.toLocaleString("en-US")}</td>
                        <td style={{ padding: "8px 12px", fontSize: 12, color: DS.mid, fontFamily: DS.mono }}>{Number(row.total_reserved ?? 0).toLocaleString("en-US")}</td>
                        <td style={{ padding: "8px 12px", fontSize: 12, color: DS.sky, fontFamily: DS.mono }}>{eur(Number(row.list_price_gross ?? row.list_price_net ?? 0))}</td>
                        <td style={{ padding: "8px 12px", fontSize: 11, color }}>
                          {state === "out_of_stock" ? "Out of Stock" : state === "low_stock" ? "Low Stock" : "In Stock"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ padding: "8px 12px", borderTop: `1px solid ${DS.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 11, color: DS.lo }}>
                Page {listQ.data?.page ?? page} / {totalPagesFromServer} - {listQ.data?.total ?? 0} total
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={pagerBtn(page <= 1)}>
                  Prev
                </button>
                <button onClick={() => setPage((p) => Math.min(totalPagesFromServer, p + 1))} disabled={page >= totalPagesFromServer} style={pagerBtn(page >= totalPagesFromServer)}>
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ border: `1px solid ${DS.border}`, borderRadius: 10, background: "rgba(255,255,255,0.015)", padding: "10px 12px" }}>
      <div style={{ fontSize: 11, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 20, color, fontWeight: 700, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
    </div>
  );
}

function RiskPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ border: `1px solid ${DS.border}`, borderRadius: 8, padding: "8px 10px", background: "rgba(255,255,255,0.02)" }}>
      <div style={{ fontSize: 10, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 16, color, fontWeight: 700, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function ChartShell({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", overflow: "hidden" }}>
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${DS.border}` }}>
        <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 11, color: DS.lo, marginTop: 2 }}>{sub}</div>
      </div>
      <div style={{ padding: 8 }}>{children}</div>
    </div>
  );
}

function pagerBtn(disabled: boolean) {
  return {
    fontSize: 11,
    color: disabled ? DS.lo : DS.hi,
    border: `1px solid ${DS.border}`,
    background: "rgba(255,255,255,0.04)",
    borderRadius: 8,
    padding: "5px 9px",
    cursor: disabled ? "not-allowed" : "pointer",
  } as const;
}
