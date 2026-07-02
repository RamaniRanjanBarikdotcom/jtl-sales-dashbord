"use client";

import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { InventoryDrawerType } from "@/components/inventory/InventoryKpiDrawer";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/Card";
import { SectionHeader as SH } from "@/components/ui/SectionHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { ChartTip } from "@/components/charts/recharts/ChartTip";
import { DetailPanel, StatRow, SectionLabel, Badge, MiniBar } from "@/components/ui/DetailPanel";
import { DS } from "@/lib/design-system";
import { eur, safeFloat, safeInt } from "@/lib/utils";
import {
    type InventoryAlertRow,
    type InventoryListRow,
    useInventoryAlertsPaged,
    useInventoryKpis,
    useInventoryListPaged,
    useInventoryMovementsPaged,
} from "@/hooks/useInventoryData";
import { useProductsCategories } from "@/hooks/useProductsData";

const InventoryKpiDrawer = dynamic(
    () => import("@/components/inventory/InventoryKpiDrawer").then(m => m.InventoryKpiDrawer),
    { ssr: false },
);

type AlertItem = {
    product: string;
    warehouse: string;
    stock: number;
    status: string;
    dsi: number;
    reorderQty: number;
};

type StockState = "out_of_stock" | "low_stock" | "in_stock";

const STOCK_PAGE_SIZE = 12;
const ALERT_PAGE_SIZE = 8;
const DSI_PAGE_SIZE = 8;
const CATEGORY_PAGE_SIZE = 8;

function stockValue(row: InventoryListRow): number {
    return safeFloat(row.total_available ?? row.stock_quantity ?? 0);
}

function stockState(stock: number): StockState {
    if (stock <= 0) return "out_of_stock";
    if (stock <= 5) return "low_stock";
    return "in_stock";
}

function stateColor(state: StockState) {
    return state === "out_of_stock" ? DS.rose : state === "low_stock" ? DS.amber : DS.emerald;
}

function stateLabel(state: StockState) {
    return state === "out_of_stock" ? "Out of Stock" : state === "low_stock" ? "Low Stock" : "In Stock";
}

function shortLabel(value: string | undefined | null, max = 46): string {
    const text = String(value || "-");
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatDateTick(raw: string | number): string {
    const date = new Date(String(raw));
    if (Number.isNaN(date.getTime())) return String(raw).slice(0, 10);
    return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export default function InventoryTab() {
    const [drawerType, setDrawerType] = useState<InventoryDrawerType>(null);
    const [selected, setSelected] = useState<AlertItem | null>(null);
    const [availablePage, setAvailablePage] = useState(1);
    const [alertsPage, setAlertsPage] = useState(1);
    const [alertsStatus, setAlertsStatus] = useState<"all" | "out_of_stock" | "low_stock">("all");
    const [dsiPage, setDsiPage] = useState(1);
    const [categoryPage, setCategoryPage] = useState(1);
    const [search, setSearch] = useState("");
    const [appliedSearch, setAppliedSearch] = useState("");

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setAppliedSearch(search.trim());
            setAvailablePage(1);
        }, 350);
        return () => window.clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        setAlertsPage(1);
    }, [alertsStatus]);

    const kpisQ = useInventoryKpis();
    const availableQ = useInventoryListPaged({
        page: availablePage,
        limit: STOCK_PAGE_SIZE,
        search: appliedSearch,
        status: "available",
    });
    const alertsQ = useInventoryAlertsPaged({
        page: alertsPage,
        limit: ALERT_PAGE_SIZE,
        status: alertsStatus,
    });
    const movementsQ = useInventoryMovementsPaged({
        page: dsiPage,
        limit: DSI_PAGE_SIZE,
        refetchInterval: 60_000,
    });
    const categoriesQ = useProductsCategories();

    const kpis = kpisQ.data ?? {
        totalValue: 0,
        lowStockCount: 0,
        outOfStock: 0,
        avgSellThrough: 0,
        warehouseFillPct: 0,
        valueLabel: "at list price",
    };
    const availableRows = availableQ.data?.rows ?? [];
    const alertsRows = alertsQ.data?.rows ?? [];
    const dsiRows = movementsQ.data?.dsi ?? [];
    const daily = movementsQ.data?.daily ?? [];
    const categories = categoriesQ.data ?? [];
    const categoryRows = categories.slice((categoryPage - 1) * CATEGORY_PAGE_SIZE, categoryPage * CATEGORY_PAGE_SIZE);

    const availableTotalPages = Math.max(1, Math.ceil((availableQ.data?.total ?? 0) / (availableQ.data?.limit ?? STOCK_PAGE_SIZE)));
    const alertTotalPages = Math.max(1, Math.ceil((alertsQ.data?.total ?? 0) / (alertsQ.data?.limit ?? ALERT_PAGE_SIZE)));
    const dsiTotalPages = Math.max(1, Math.ceil((movementsQ.data?.dsi_total ?? 0) / (movementsQ.data?.dsi_limit ?? DSI_PAGE_SIZE)));
    const categoryTotalPages = Math.max(1, Math.ceil(categories.length / CATEGORY_PAGE_SIZE));
    const inStockSpark = availableRows.map((row) => ({ stock: stockValue(row) }));
    const alertsSpark = alertsRows.map((row) => ({ stock: row.stock, dsi: row.dsi }));

    return (
        <>
            <InventoryKpiDrawer type={drawerType} onClose={() => setDrawerType(null)} />
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12 }}>
                    <KpiCard label={kpis.valueLabel === "catalog (list price)" ? "Catalog Value" : "Total Value in Stock"} value={eur(kpis.totalValue)} delta={null} note={kpis.valueLabel} c={DS.sky} icon="🏭" data={inStockSpark} k="stock" onClick={() => setDrawerType("value")} />
                    <KpiCard label="Items Low Stock" value={String(kpis.lowStockCount)} delta={null} note="stock ≤ 5" c={DS.amber} icon="⚠️" data={alertsSpark} k="stock" onClick={() => setDrawerType("low_stock")} />
                    <KpiCard label="Items Out of Stock" value={String(kpis.outOfStock)} delta={null} note="zero stock" c={DS.rose} icon="🚨" data={alertsSpark} k="dsi" onClick={() => setDrawerType("out_of_stock")} />
                    <KpiCard label="In-Stock Rate" value={`${kpis.avgSellThrough}%`} delta={null} note="of all SKUs" c={DS.emerald} icon="📈" data={inStockSpark} k="stock" onClick={() => setDrawerType("in_stock")} />
                </div>

                <Card accent={DS.emerald}>
                    <SH
                        title="Available Stock"
                        sub="Products with stock available · sorted highest stock first"
                        right={
                            <input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Search product or SKU..."
                                style={inputStyle(240)}
                            />
                        }
                    />
                    <InventoryTable
                        rows={availableRows}
                        loading={availableQ.isLoading}
                        emptyText={appliedSearch ? "No available stock found for this search." : "No products currently have stock available."}
                    />
                    <Pager
                        page={availableQ.data?.page ?? availablePage}
                        totalPages={availableTotalPages}
                        total={availableQ.data?.total ?? 0}
                        label="available products"
                        onPrev={() => setAvailablePage((page) => Math.max(1, page - 1))}
                        onNext={() => setAvailablePage((page) => Math.min(availableTotalPages, page + 1))}
                    />
                </Card>

                <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 12 }}>
                    <Card accent={DS.amber}>
                        <SH
                            title="Inventory Alerts"
                            sub="Products requiring immediate action"
                            right={
                                <select value={alertsStatus} onChange={(event) => setAlertsStatus(event.target.value as "all" | "out_of_stock" | "low_stock")} style={inputStyle(150)}>
                                    <option value="all">All Alerts</option>
                                    <option value="out_of_stock">Out of Stock</option>
                                    <option value="low_stock">Low Stock</option>
                                </select>
                            }
                        />
                        <AlertsTable rows={alertsRows} loading={alertsQ.isLoading} onSelect={setSelected} selected={selected} />
                        <Pager
                            page={alertsQ.data?.page ?? alertsPage}
                            totalPages={alertTotalPages}
                            total={alertsQ.data?.total ?? 0}
                            label="alerts"
                            onPrev={() => setAlertsPage((page) => Math.max(1, page - 1))}
                            onNext={() => setAlertsPage((page) => Math.min(alertTotalPages, page + 1))}
                        />
                    </Card>

                    <Card accent={DS.violet}>
                        <SH title="Days of Stock" sub="Reorder planning without chart clutter" />
                        <DsiTable rows={dsiRows} loading={movementsQ.isLoading} />
                        <Pager
                            page={movementsQ.data?.dsi_page ?? dsiPage}
                            totalPages={dsiTotalPages}
                            total={movementsQ.data?.dsi_total ?? 0}
                            label="SKUs"
                            onPrev={() => setDsiPage((page) => Math.max(1, page - 1))}
                            onNext={() => setDsiPage((page) => Math.min(dsiTotalPages, page + 1))}
                        />
                    </Card>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Card accent={DS.sky}>
                        <SH title="Recent Demand Activity" sub="Orders and revenue over selected period" />
                        <div style={{ height: 230 }}>
                            {daily.length === 0 ? (
                                <EmptyState text="No recent order activity found for this filter." />
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={daily} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                                        <defs>
                                            <linearGradient id="inventoryDemandRevenue" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor={DS.emerald} stopOpacity={0.28} />
                                                <stop offset="100%" stopColor={DS.emerald} stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="inventoryDemandOrders" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor={DS.sky} stopOpacity={0.28} />
                                                <stop offset="100%" stopColor={DS.sky} stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                        <XAxis dataKey="d" tick={{ fill: DS.lo, fontSize: 10 }} tickFormatter={formatDateTick} minTickGap={24} axisLine={false} tickLine={false} />
                                        <YAxis tick={{ fill: DS.lo, fontSize: 10 }} axisLine={false} tickLine={false} width={42} />
                                        <Tooltip content={<ChartTip />} />
                                        <Area type="monotone" dataKey="ord" name="Orders" stroke={DS.sky} fill="url(#inventoryDemandOrders)" dot={false} />
                                        <Area type="monotone" dataKey="rev" name="Revenue" stroke={DS.emerald} fill="url(#inventoryDemandRevenue)" dot={false} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </Card>

                    <Card accent={DS.cyan}>
                        <SH title="Category Stock View" sub="Clean paginated category snapshot" />
                        <CategoryList rows={categoryRows} loading={categoriesQ.isLoading} />
                        <Pager
                            page={categoryPage}
                            totalPages={categoryTotalPages}
                            total={categories.length}
                            label="categories"
                            onPrev={() => setCategoryPage((page) => Math.max(1, page - 1))}
                            onNext={() => setCategoryPage((page) => Math.min(categoryTotalPages, page + 1))}
                        />
                    </Card>
                </div>

                <DetailPanel
                    open={!!selected}
                    title={selected?.product || ""}
                    subtitle={`SKU: ${selected?.warehouse || ""}`}
                    onClose={() => setSelected(null)}
                >
                    {selected && <AlertDetail selected={selected} />}
                </DetailPanel>
            </div>
        </>
    );
}

function InventoryTable({ rows, loading, emptyText }: { rows: InventoryListRow[]; loading: boolean; emptyText: string }) {
    return (
        <DataFrame maxHeight={460}>
            <table style={tableStyle}>
                <thead>
                    <tr>
                        {["Product", "SKU", "Category", "Available", "Reserved", "Unit Value", "Stock Value", "Status"].map((header) => (
                            <HeaderCell key={header} align={["Available", "Reserved", "Unit Value", "Stock Value"].includes(header) ? "right" : "left"}>{header}</HeaderCell>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {loading && <LoadingRow colSpan={8} text="Loading available stock..." />}
                    {!loading && rows.length === 0 && <LoadingRow colSpan={8} text={emptyText} />}
                    {!loading && rows.map((row, index) => {
                        const stock = stockValue(row);
                        const unit = safeFloat(row.unit_cost || row.list_price_net || row.list_price_gross || 0);
                        const state = stockState(stock);
                        const color = stateColor(state);
                        return (
                            <tr key={`${row.id ?? row.article_number ?? index}`} style={rowStyle}>
                                <BodyCell title={String(row.product_name || "")}>
                                    <strong style={{ color: DS.hi }}>{shortLabel(String(row.product_name || "-"), 54)}</strong>
                                </BodyCell>
                                <BodyCell mono muted>{row.article_number || "-"}</BodyCell>
                                <BodyCell title={String(row.category_name || "")}>{shortLabel(row.category_name || "Uncategorized", 28)}</BodyCell>
                                <BodyCell align="right" mono color={color}>{stock.toLocaleString("en-US")}</BodyCell>
                                <BodyCell align="right" mono>{safeFloat(row.total_reserved).toLocaleString("en-US")}</BodyCell>
                                <BodyCell align="right" mono color={DS.sky}>{eur(unit)}</BodyCell>
                                <BodyCell align="right" mono color={DS.emerald}>{eur(stock * unit)}</BodyCell>
                                <BodyCell><StockBadge label={stateLabel(state)} color={color} /></BodyCell>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </DataFrame>
    );
}

function AlertsTable({ rows, loading, onSelect, selected }: { rows: InventoryAlertRow[]; loading: boolean; onSelect: (row: AlertItem) => void; selected: AlertItem | null }) {
    return (
        <DataFrame maxHeight={340}>
            <table style={tableStyle}>
                <thead>
                    <tr>
                        {["Product", "SKU", "Stock", "Status", "DSI", "Reorder"].map((header) => (
                            <HeaderCell key={header} align={["Stock", "DSI", "Reorder"].includes(header) ? "right" : "left"}>{header}</HeaderCell>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {loading && <LoadingRow colSpan={6} text="Loading inventory alerts..." />}
                    {!loading && rows.length === 0 && <LoadingRow colSpan={6} text="No alerts found." />}
                    {!loading && rows.map((row, index) => {
                        const color = row.status === "out_of_stock" ? DS.rose : DS.amber;
                        const active = selected?.product === row.product && selected?.warehouse === row.warehouse;
                        return (
                            <tr
                                key={`${row.product}-${row.warehouse}-${index}`}
                                onClick={() => onSelect(row)}
                                style={{ ...rowStyle, cursor: "pointer", background: active ? DS.panelHi : "transparent" }}
                            >
                                <BodyCell title={row.product}><strong style={{ color: DS.hi }}>{shortLabel(row.product, 42)}</strong></BodyCell>
                                <BodyCell mono muted>{row.warehouse}</BodyCell>
                                <BodyCell align="right" mono color={color}>{row.stock.toLocaleString("en-US")}</BodyCell>
                                <BodyCell><StockBadge label={row.status === "out_of_stock" ? "Out" : "Low"} color={color} /></BodyCell>
                                <BodyCell align="right" mono>{row.dsi}d</BodyCell>
                                <BodyCell align="right" mono>{row.reorderQty.toLocaleString("en-US")}</BodyCell>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </DataFrame>
    );
}

function DsiTable({ rows, loading }: { rows: Array<{ name?: string; article_number?: string; stock_quantity?: number; avg_daily?: number; dsi?: number }>; loading: boolean }) {
    return (
        <DataFrame maxHeight={340}>
            <table style={tableStyle}>
                <thead>
                    <tr>
                        {["Product", "SKU", "Stock", "Avg/Day", "DSI", "Risk"].map((header) => (
                            <HeaderCell key={header} align={["Stock", "Avg/Day", "DSI"].includes(header) ? "right" : "left"}>{header}</HeaderCell>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {loading && <LoadingRow colSpan={6} text="Loading DSI records..." />}
                    {!loading && rows.length === 0 && <LoadingRow colSpan={6} text="No DSI records found." />}
                    {!loading && rows.map((row, index) => {
                        const dsi = safeInt(row.dsi);
                        const stock = safeInt(row.stock_quantity);
                        const riskColor = dsi <= 0 ? DS.rose : dsi <= 7 ? DS.amber : dsi <= 30 ? DS.sky : DS.emerald;
                        const riskLabel = dsi <= 0 ? "Critical" : dsi <= 7 ? "Low" : dsi <= 30 ? "Watch" : "Healthy";
                        return (
                            <tr key={`${row.article_number ?? row.name ?? index}`} style={rowStyle}>
                                <BodyCell title={String(row.name || "")}><strong style={{ color: DS.hi }}>{shortLabel(row.name, 30)}</strong></BodyCell>
                                <BodyCell mono muted>{row.article_number || "-"}</BodyCell>
                                <BodyCell align="right" mono color={stock > 0 ? DS.emerald : DS.rose}>{stock.toLocaleString("en-US")}</BodyCell>
                                <BodyCell align="right" mono>{safeFloat(row.avg_daily).toFixed(2)}</BodyCell>
                                <BodyCell align="right" mono color={riskColor}>{dsi}d</BodyCell>
                                <BodyCell><StockBadge label={riskLabel} color={riskColor} /></BodyCell>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </DataFrame>
    );
}

function CategoryList({ rows, loading }: { rows: Array<{ name: string; v: number; c: string }>; loading: boolean }) {
    return (
        <DataFrame maxHeight={230}>
            {loading && <EmptyState text="Loading categories..." />}
            {!loading && rows.length === 0 && <EmptyState text="No category data found." />}
            {!loading && rows.map((row, index) => (
                <div key={`${row.name}-${index}`} style={{ padding: "10px 0", borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: DS.hi, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name || "Uncategorized"}</span>
                        <span style={{ fontSize: 11, color: row.c, fontFamily: DS.mono }}>{safeFloat(row.v).toFixed(1)}%</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                        <div style={{ width: `${Math.max(2, Math.min(100, safeFloat(row.v)))}%`, height: "100%", background: row.c }} />
                    </div>
                </div>
            ))}
        </DataFrame>
    );
}

function AlertDetail({ selected }: { selected: AlertItem }) {
    const statusColor = selected.status === "out_of_stock" ? DS.rose : selected.status === "low_stock" ? DS.amber : DS.sky;
    const dsiColor = selected.dsi === 0 ? DS.rose : selected.dsi < 10 ? DS.amber : selected.dsi < 30 ? DS.sky : DS.emerald;
    const urgency = selected.status === "out_of_stock" ? "Critical — Reorder Immediately" : "Warning — Reorder Soon";
    return (
        <>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <Badge text={selected.status.replace("_", " ").toUpperCase()} color={statusColor} />
                <Badge text={urgency} color={statusColor} />
            </div>
            <SectionLabel text="Stock Snapshot" />
            <MiniBar value={Math.min(selected.dsi, 60)} max={60} color={dsiColor} label={`${selected.dsi} days remaining (target: 30)`} />
            <SectionLabel text="Details" />
            <StatRow label="Product" value={selected.product} />
            <StatRow label="SKU" value={selected.warehouse} />
            <StatRow label="Current Stock" value={String(selected.stock)} color={selected.stock === 0 ? DS.rose : DS.hi} />
            <StatRow label="Days of Stock" value={`${selected.dsi} days`} color={dsiColor} />
            <StatRow label="Recommended Reorder Qty" value={String(selected.reorderQty)} color={DS.sky} />
            <SectionLabel text="Action Required" />
            <div style={{ padding: "12px 14px", borderRadius: 10, background: `${statusColor}10`, border: `1px solid ${statusColor}30`, fontSize: 11, color: DS.mid, lineHeight: 1.6 }}>
                {selected.status === "out_of_stock"
                    ? `Order ${selected.reorderQty} units immediately to avoid lost sales.`
                    : `Place an order within the next ${selected.dsi} days to maintain stock continuity.`}
            </div>
        </>
    );
}

function Pager({ page, totalPages, total, label, onPrev, onNext }: { page: number; totalPages: number; total: number; label: string; onPrev: () => void; onNext: () => void }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: `1px solid rgba(255,255,255,0.04)` }}>
            <span style={{ fontSize: 11, color: DS.lo }}>
                Page {page} / {totalPages} · {total.toLocaleString("en-US")} {label}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
                <button onClick={onPrev} disabled={page <= 1} style={pagerBtn(page <= 1)}>Prev</button>
                <button onClick={onNext} disabled={page >= totalPages} style={pagerBtn(page >= totalPages)}>Next</button>
            </div>
        </div>
    );
}

function StockBadge({ label, color }: { label: string; color: string }) {
    return (
        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 999, fontWeight: 700, color, background: `${color}1f`, whiteSpace: "nowrap" }}>
            {label}
        </span>
    );
}

function HeaderCell({ children, align = "left" }: { children: ReactNode; align?: "left" | "right" }) {
    return (
        <th style={{ textAlign: align, fontSize: 9, color: DS.lo, letterSpacing: "0.07em", textTransform: "uppercase", padding: "0 8px 10px", fontWeight: 600, borderBottom: `1px solid ${DS.border}`, position: "sticky", top: 0, background: "#050b12", zIndex: 1 }}>
            {children}
        </th>
    );
}

function BodyCell({ children, align = "left", mono, muted, color, title }: { children: ReactNode; align?: "left" | "right"; mono?: boolean; muted?: boolean; color?: string; title?: string }) {
    return (
        <td title={title} style={{ padding: "10px 8px", textAlign: align, fontSize: 12, color: color ?? (muted ? DS.lo : DS.mid), fontFamily: mono ? DS.mono : DS.body, verticalAlign: "middle" }}>
            {children}
        </td>
    );
}

function LoadingRow({ colSpan, text }: { colSpan: number; text: string }) {
    return (
        <tr>
            <td colSpan={colSpan} style={{ padding: "18px 8px", fontSize: 12, color: DS.lo, textAlign: "center" }}>{text}</td>
        </tr>
    );
}

function DataFrame({ children, maxHeight }: { children: ReactNode; maxHeight: number }) {
    return (
        <div style={{ maxHeight, overflow: "auto", border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.012)" }}>
            {children}
        </div>
    );
}

function EmptyState({ text }: { text: string }) {
    return <div style={{ minHeight: 120, display: "grid", placeItems: "center", fontSize: 12, color: DS.lo }}>{text}</div>;
}

function inputStyle(width: number) {
    return {
        width,
        fontSize: 11,
        color: DS.hi,
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${DS.border}`,
        borderRadius: 9,
        padding: "7px 10px",
        outline: "none",
    } as const;
}

function pagerBtn(disabled: boolean) {
    return {
        fontSize: 11,
        color: disabled ? DS.lo : DS.hi,
        border: `1px solid ${DS.border}`,
        background: "rgba(255,255,255,0.04)",
        borderRadius: 8,
        padding: "6px 10px",
        cursor: disabled ? "not-allowed" : "pointer",
    } as const;
}

const tableStyle = {
    width: "100%",
    borderCollapse: "collapse",
} as const;

const rowStyle = {
    borderBottom: "1px solid rgba(255,255,255,0.035)",
} as const;
