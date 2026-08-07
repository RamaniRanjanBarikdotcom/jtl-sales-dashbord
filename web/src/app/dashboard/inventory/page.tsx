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
import { useFilterStore, useStore, sessionHasPermission } from "@/lib/store";
import { exportInventoryCsv } from "@/lib/export";
import {
    type InventoryAlertRow,
    type InventoryCategoryRow,
    type InventoryListRow,
    useInventoryAlertsPaged,
    useInventoryKpis,
    useInventoryCategories,
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
    sku: string;
    warehouse: string;
    category: string;
    channels: string;
    stock: number;
    status: string;
    dsi: number | null;
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

function alertStatusLabel(status: string) {
    const labels: Record<string, string> = {
        out_of_stock: "Out",
        low_stock: "Low",
        below_reorder_point: "Below reorder",
        high_demand_low_stock: "High demand",
        stockout_risk: "Stockout risk",
    };
    return labels[status] || status.replaceAll("_", " ");
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
    const session = useStore((state) => state.session);
    const canExportInventory = sessionHasPermission(session, "inventory.export");
    const resetGlobalFilters = useFilterStore((state) => state.resetFilters);
    const [drawerType, setDrawerType] = useState<InventoryDrawerType>(null);
    const [selected, setSelected] = useState<AlertItem | null>(null);
    const [availablePage, setAvailablePage] = useState(1);
    const [alertsPage, setAlertsPage] = useState(1);
    const [alertsStatus, setAlertsStatus] = useState<"all" | "out_of_stock" | "low_stock" | "below_reorder_point" | "high_demand_low_stock" | "stockout_risk">("all");
    const [alertsSearch, setAlertsSearch] = useState("");
    const [alertsCategory, setAlertsCategory] = useState("");
    const [alertsWarehouse, setAlertsWarehouse] = useState("");
    const [alertsChannel, setAlertsChannel] = useState("");
    const [dsiPage, setDsiPage] = useState(1);
    const [dsiSearch, setDsiSearch] = useState("");
    const [dsiCategory, setDsiCategory] = useState("");
    const [dsiWarehouse, setDsiWarehouse] = useState("");
    const [dsiChannel, setDsiChannel] = useState("");
    const [dsiPerformance, setDsiPerformance] = useState("all");
    const [dsiMin, setDsiMin] = useState("");
    const [dsiMax, setDsiMax] = useState("");
    const [showDemandDetails, setShowDemandDetails] = useState(false);
    const [categoryPage, setCategoryPage] = useState(1);
    const [search, setSearch] = useState("");
    const [appliedSearch, setAppliedSearch] = useState("");
    const [category, setCategory] = useState("");
    const [warehouse, setWarehouse] = useState("");
    const [appliedWarehouse, setAppliedWarehouse] = useState("");
    const [minStock, setMinStock] = useState("");
    const [maxStock, setMaxStock] = useState("");
    const [minAvailable, setMinAvailable] = useState("");
    const [minReserved, setMinReserved] = useState("");
    const [performanceClass, setPerformanceClass] = useState("all");
    const [stockSort, setStockSort] = useState<"total_stock" | "available_stock" | "reserved_stock" | "product_name" | "category" | "stock_value" | "revenue" | "units" | "days_since_sale">("total_stock");
    const [stockOrder, setStockOrder] = useState<"ASC" | "DESC">("DESC");
    const [isExporting, setIsExporting] = useState(false);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setAppliedSearch(search.trim());
            setAppliedWarehouse(warehouse.trim());
            setAvailablePage(1);
        }, 350);
        return () => window.clearTimeout(timer);
    }, [search, warehouse]);

    useEffect(() => {
        setAlertsPage(1);
    }, [alertsStatus, alertsCategory, alertsWarehouse, alertsChannel]);

    useEffect(() => {
        setDsiPage(1);
    }, [dsiCategory, dsiWarehouse, dsiChannel, dsiPerformance, dsiMin, dsiMax]);

    const kpisQ = useInventoryKpis();
    const availableQ = useInventoryListPaged({
        page: availablePage,
        limit: STOCK_PAGE_SIZE,
        search: appliedSearch,
        status: "available",
        category,
        warehouse: appliedWarehouse,
        minStock: minStock === "" ? undefined : Number(minStock),
        maxStock: maxStock === "" ? undefined : Number(maxStock),
        minAvailable: minAvailable === "" ? undefined : Number(minAvailable),
        minReserved: minReserved === "" ? undefined : Number(minReserved),
        performanceClass,
        sort: stockSort,
        order: stockOrder,
    });
    const alertsQ = useInventoryAlertsPaged({
        page: alertsPage,
        limit: ALERT_PAGE_SIZE,
        status: alertsStatus,
        search: alertsSearch,
        category: alertsCategory,
        warehouse: alertsWarehouse,
        channel: alertsChannel,
    });
    const movementsQ = useInventoryMovementsPaged({
        page: dsiPage,
        limit: DSI_PAGE_SIZE,
        search: dsiSearch,
        category: dsiCategory,
        warehouse: dsiWarehouse,
        channel: dsiChannel,
        performanceClass: dsiPerformance,
        minDaysOfStock: dsiMin === "" ? undefined : Number(dsiMin),
        maxDaysOfStock: dsiMax === "" ? undefined : Number(dsiMax),
        refetchInterval: 60_000,
    });
    const categoriesQ = useProductsCategories();
    const inventoryCategoriesQ = useInventoryCategories(categoryPage, CATEGORY_PAGE_SIZE);

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
    const categoryRows = inventoryCategoriesQ.data?.rows ?? [];

    const availableTotalPages = Math.max(1, Math.ceil((availableQ.data?.total ?? 0) / (availableQ.data?.limit ?? STOCK_PAGE_SIZE)));
    const alertTotalPages = Math.max(1, Math.ceil((alertsQ.data?.total ?? 0) / (alertsQ.data?.limit ?? ALERT_PAGE_SIZE)));
    const dsiTotalPages = Math.max(1, Math.ceil((movementsQ.data?.dsi_total ?? 0) / (movementsQ.data?.dsi_limit ?? DSI_PAGE_SIZE)));
    const categoryTotalPages = Math.max(1, Math.ceil((inventoryCategoriesQ.data?.total ?? 0) / (inventoryCategoriesQ.data?.limit ?? CATEGORY_PAGE_SIZE)));
    const inStockSpark = availableRows.map((row) => ({ stock: stockValue(row) }));
    const alertsSpark = alertsRows.map((row) => ({ stock: row.stock, dsi: row.dsi }));

    return (
        <>
            <InventoryKpiDrawer type={drawerType} onClose={() => setDrawerType(null)} />
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div className="analytics-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12 }}>
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
                            <div className="analytics-header-actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                <input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Search product or SKU..."
                                    style={inputStyle(240)}
                                />
                                {canExportInventory && (
                                    <button
                                        disabled={isExporting}
                                        onClick={async () => {
                                            try {
                                                setIsExporting(true);
                                                await exportInventoryCsv({
                                                    search: appliedSearch,
                                                    status: "available",
                                                    category,
                                                    warehouse: appliedWarehouse,
                                                    minStock: minStock === "" ? undefined : Number(minStock),
                                                    maxStock: maxStock === "" ? undefined : Number(maxStock),
                                                    minAvailable: minAvailable === "" ? undefined : Number(minAvailable),
                                                    minReserved: minReserved === "" ? undefined : Number(minReserved),
                                                    performanceClass,
                                                    sort: stockSort,
                                                    order: stockOrder,
                                                });
                                            } finally {
                                                setIsExporting(false);
                                            }
                                        }}
                                        style={exportButtonStyle(isExporting)}
                                    >
                                        {isExporting ? "Preparing…" : "Download CSV"}
                                    </button>
                                )}
                            </div>
                        }
                    />
                    <div className="analytics-filter-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(135px,1fr))", gap: 8, marginBottom: 12 }}>
                        <select value={category} onChange={(event) => { setCategory(event.target.value); setAvailablePage(1); }} style={inputStyle(0)}>
                            <option value="">All Categories</option>
                            {categories.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                        </select>
                        <input value={warehouse} onChange={(event) => setWarehouse(event.target.value)} placeholder="Warehouse name or ID" style={inputStyle(0)} />
                        <input value={minStock} onChange={(event) => { setMinStock(event.target.value); setAvailablePage(1); }} inputMode="decimal" placeholder="Min stock" style={inputStyle(0)} />
                        <input value={maxStock} onChange={(event) => { setMaxStock(event.target.value); setAvailablePage(1); }} inputMode="decimal" placeholder="Max stock" style={inputStyle(0)} />
                        <input value={minAvailable} onChange={(event) => { setMinAvailable(event.target.value); setAvailablePage(1); }} inputMode="decimal" placeholder="Min available" style={inputStyle(0)} />
                        <input value={minReserved} onChange={(event) => { setMinReserved(event.target.value); setAvailablePage(1); }} inputMode="decimal" placeholder="Min reserved" style={inputStyle(0)} />
                        <select value={performanceClass} onChange={(event) => { setPerformanceClass(event.target.value); setAvailablePage(1); }} style={inputStyle(0)}>
                            <option value="all">All performance</option><option value="fast_moving">Fast moving</option><option value="average_performing">Average performing</option><option value="slow_moving">Slow moving</option><option value="dead_stock">Dead stock</option><option value="overstock">Overstock</option><option value="stockout_risk">Stockout risk</option><option value="below_reorder_point">Below reorder</option><option value="stock_no_sales">Stock with no sales</option><option value="no_demand">No demand</option>
                        </select>
                        <select value={stockSort} onChange={(event) => { setStockSort(event.target.value as typeof stockSort); setAvailablePage(1); }} style={inputStyle(0)}>
                            <option value="total_stock">Total Stock</option>
                            <option value="available_stock">Available Stock</option>
                            <option value="reserved_stock">Reserved Stock</option>
                            <option value="stock_value">Stock Value</option>
                            <option value="revenue">Revenue</option>
                            <option value="units">Units Sold</option>
                            <option value="days_since_sale">Days Since Sale</option>
                            <option value="product_name">Product Name</option>
                            <option value="category">Category</option>
                        </select>
                        <button onClick={() => { setStockOrder((value) => value === "DESC" ? "ASC" : "DESC"); setAvailablePage(1); }} style={exportButtonStyle(false)}>{stockOrder === "DESC" ? "Descending ↓" : "Ascending ↑"}</button>
                        <button className="analytics-clear-button" onClick={() => {
                            resetGlobalFilters();
                            setSearch(""); setAppliedSearch(""); setCategory(""); setWarehouse(""); setAppliedWarehouse("");
                            setMinStock(""); setMaxStock(""); setMinAvailable(""); setMinReserved("");
                            setPerformanceClass("all"); setStockSort("total_stock"); setStockOrder("DESC"); setAvailablePage(1);
                        }}>Clear filters</button>
                    </div>
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

                <div className="analytics-two-column" style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 12 }}>
                    <Card accent={DS.amber}>
                        <SH
                            title="Inventory Alerts"
                            sub="Products requiring immediate action"
                            right={
                                <div className="analytics-header-actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <input value={alertsSearch} onChange={(event) => { setAlertsSearch(event.target.value); setAlertsPage(1); }} placeholder="Product or SKU" style={inputStyle(150)} />
                                    <select value={alertsStatus} onChange={(event) => setAlertsStatus(event.target.value as typeof alertsStatus)} style={inputStyle(170)}>
                                        <option value="all">All Alerts</option>
                                        <option value="out_of_stock">Out of Stock</option>
                                        <option value="low_stock">Low Stock</option>
                                        <option value="below_reorder_point">Below Reorder Point</option>
                                        <option value="high_demand_low_stock">High Demand + Low Stock</option>
                                        <option value="stockout_risk">Stockout Risk</option>
                                    </select>
                                    {canExportInventory && (
                                        <button
                                            disabled={isExporting}
                                            onClick={async () => {
                                                try {
                                                    setIsExporting(true);
                                                    await exportInventoryCsv({
                                                        dataset: "alerts",
                                                        search: alertsSearch,
                                                        status: alertsStatus,
                                                        category: alertsCategory,
                                                        warehouse: alertsWarehouse,
                                                        channel: alertsChannel,
                                                    });
                                                } finally {
                                                    setIsExporting(false);
                                                }
                                            }}
                                            style={exportButtonStyle(isExporting)}
                                        >
                                            Download alerts CSV
                                        </button>
                                    )}
                                </div>
                            }
                        />
                        <div className="analytics-filter-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(120px,1fr))", gap: 8, marginBottom: 10 }}>
                            <select value={alertsCategory} onChange={(event) => setAlertsCategory(event.target.value)} style={inputStyle(0)}>
                                <option value="">All Categories</option>
                                {categories.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                            </select>
                            <input value={alertsWarehouse} onChange={(event) => setAlertsWarehouse(event.target.value)} placeholder="Warehouse name or ID" style={inputStyle(0)} />
                            <input value={alertsChannel} onChange={(event) => setAlertsChannel(event.target.value)} placeholder="Sales channel" style={inputStyle(0)} />
                        </div>
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
                        <SH title="Days of Stock" sub="Reorder planning without fabricated no-demand values" right={<div style={{ display: "flex", gap: 8 }}>
                            <input value={dsiSearch} onChange={(event) => { setDsiSearch(event.target.value); setDsiPage(1); }} placeholder="Product or SKU" style={inputStyle(150)} />
                            {canExportInventory && <button disabled={isExporting} onClick={async () => { try { setIsExporting(true); await exportInventoryCsv({ dataset: "dsi", search: dsiSearch, category: dsiCategory, warehouse: dsiWarehouse, channel: dsiChannel, performanceClass: dsiPerformance, minDaysOfStock: dsiMin === "" ? undefined : Number(dsiMin), maxDaysOfStock: dsiMax === "" ? undefined : Number(dsiMax) }); } finally { setIsExporting(false); } }} style={exportButtonStyle(isExporting)}>Download DSI CSV</button>}
                        </div>} />
                        <div className="analytics-filter-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(105px,1fr))", gap: 8, marginBottom: 10 }}>
                            <select value={dsiCategory} onChange={(event) => setDsiCategory(event.target.value)} style={inputStyle(0)}>
                                <option value="">All Categories</option>
                                {categories.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                            </select>
                            <input value={dsiWarehouse} onChange={(event) => setDsiWarehouse(event.target.value)} placeholder="Warehouse" style={inputStyle(0)} />
                            <input value={dsiChannel} onChange={(event) => setDsiChannel(event.target.value)} placeholder="Sales channel" style={inputStyle(0)} />
                            <select value={dsiPerformance} onChange={(event) => setDsiPerformance(event.target.value)} style={inputStyle(0)}>
                                <option value="all">All cover states</option><option value="critical">Critical</option><option value="low_cover">Low cover</option><option value="watch">Watch</option><option value="healthy">Healthy</option><option value="overstock">Overstock</option><option value="no_demand">No demand</option>
                            </select>
                            <input value={dsiMin} onChange={(event) => setDsiMin(event.target.value)} inputMode="decimal" placeholder="Min DSI days" style={inputStyle(0)} />
                            <input value={dsiMax} onChange={(event) => setDsiMax(event.target.value)} inputMode="decimal" placeholder="Max DSI days" style={inputStyle(0)} />
                        </div>
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

                <div className="analytics-two-column" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Card accent={DS.sky}>
                        <SH title="Recent Demand Activity" sub="Orders and revenue over selected period" right={<div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => setShowDemandDetails((open) => !open)} style={exportButtonStyle(false)}>{showDemandDetails ? "Hide Details" : "Details"}</button>
                            {canExportInventory && <button disabled={isExporting} onClick={async () => { try { setIsExporting(true); await exportInventoryCsv({ dataset: "demand" }); } finally { setIsExporting(false); } }} style={exportButtonStyle(isExporting)}>Download demand CSV</button>}
                        </div>} />
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
                        {showDemandDetails && <DataFrame maxHeight={230}>
                            <table style={tableStyle}><thead><tr>{["Date", "Orders", "Revenue"].map((header) => <HeaderCell key={header} align={header === "Date" ? "left" : "right"}>{header}</HeaderCell>)}</tr></thead><tbody>
                                {daily.map((row: { d: string | number; ord: number; rev: number }) => <tr key={String(row.d)} style={rowStyle}><BodyCell mono>{formatDateTick(row.d)}</BodyCell><BodyCell align="right" mono>{row.ord.toLocaleString()}</BodyCell><BodyCell align="right" mono color={DS.emerald}>{eur(row.rev)}</BodyCell></tr>)}
                            </tbody></table>
                        </DataFrame>}
                    </Card>

                    <Card accent={DS.cyan}>
                        <SH title="Category Stock View" sub="All stock categories with server pagination" right={canExportInventory ? <button disabled={isExporting} onClick={async () => { try { setIsExporting(true); await exportInventoryCsv({ dataset: "categories" }); } finally { setIsExporting(false); } }} style={exportButtonStyle(isExporting)}>Download categories CSV</button> : undefined} />
                        <CategoryList rows={categoryRows} loading={inventoryCategoriesQ.isLoading} onSelect={(selectedCategory) => {
                            setCategory(selectedCategory);
                            setAvailablePage(1);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                        }} />
                        <Pager
                            page={categoryPage}
                            totalPages={categoryTotalPages}
                            total={inventoryCategoriesQ.data?.total ?? 0}
                            label="categories"
                            onPrev={() => setCategoryPage((page) => Math.max(1, page - 1))}
                            onNext={() => setCategoryPage((page) => Math.min(categoryTotalPages, page + 1))}
                        />
                    </Card>
                </div>

                <DetailPanel
                    open={!!selected}
                    title={selected?.product || ""}
                    subtitle={`SKU: ${selected?.sku || ""}`}
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
                        {["Product", "SKU", "Category", "Warehouses", "Total Stock", "Available", "Reserved", "Revenue", "Units", "Sales Channels", "Last Sale", "Class"].map((header) => (
                            <HeaderCell key={header} align={["Total Stock", "Available", "Reserved", "Revenue", "Units", "Last Sale"].includes(header) ? "right" : "left"}>{header}</HeaderCell>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {loading && <LoadingRow colSpan={12} text="Loading available stock..." />}
                    {!loading && rows.length === 0 && <LoadingRow colSpan={12} text={emptyText} />}
                    {!loading && rows.map((row, index) => {
                        const stock = stockValue(row);
                        const state = stockState(stock);
                        const color = stateColor(state);
                        return (
                            <tr key={`${row.id ?? row.article_number ?? index}`} style={rowStyle}>
                                <BodyCell title={String(row.product_name || "")}>
                                    <strong style={{ color: DS.hi }}>{shortLabel(String(row.product_name || "-"), 54)}</strong>
                                </BodyCell>
                                <BodyCell mono muted>{row.article_number || "-"}</BodyCell>
                                <BodyCell title={String(row.category_name || "")}>{shortLabel(row.category_name || "Uncategorized", 28)}</BodyCell>
                                <BodyCell title={String(row.warehouse_names || "")}>{shortLabel(row.warehouse_names || "Not assigned", 30)}</BodyCell>
                                <BodyCell align="right" mono color={color}>{stock.toLocaleString("en-US")}</BodyCell>
                                <BodyCell align="right" mono>{safeFloat(row.available_stock).toLocaleString("en-US")}</BodyCell>
                                <BodyCell align="right" mono>{safeFloat(row.total_reserved).toLocaleString("en-US")}</BodyCell>
                                <BodyCell align="right" mono color={DS.emerald}>{eur(safeFloat(row.revenue))}</BodyCell>
                                <BodyCell align="right" mono>{safeFloat(row.units).toLocaleString("en-US")}</BodyCell>
                                <BodyCell title={String(row.sales_channels || "")}>{shortLabel(row.sales_channels || "No sales", 26)}</BodyCell>
                                <BodyCell align="right" mono>{row.days_since_last_sale == null ? "No sale" : `${row.days_since_last_sale}d`}</BodyCell>
                                <BodyCell><StockBadge label={String(row.classification || stateLabel(state)).replaceAll("_", " ")} color={color} /></BodyCell>
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
                        const active = selected?.product === row.product && selected?.sku === row.sku;
                        return (
                            <tr
                                key={`${row.product}-${row.sku}-${index}`}
                                onClick={() => onSelect(row)}
                                style={{ ...rowStyle, cursor: "pointer", background: active ? DS.panelHi : "transparent" }}
                            >
                                <BodyCell title={`${row.product} · ${row.category} · ${row.warehouse}`}><strong style={{ color: DS.hi }}>{shortLabel(row.product, 42)}</strong></BodyCell>
                                <BodyCell mono muted>{row.sku}</BodyCell>
                                <BodyCell align="right" mono color={color}>{row.stock.toLocaleString("en-US")}</BodyCell>
                                <BodyCell><StockBadge label={alertStatusLabel(row.status)} color={color} /></BodyCell>
                                <BodyCell align="right" mono>{row.dsi == null ? "No demand" : `${row.dsi}d`}</BodyCell>
                                <BodyCell align="right" mono>{row.reorderQty.toLocaleString("en-US")}</BodyCell>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </DataFrame>
    );
}

function DsiTable({ rows, loading }: { rows: Array<{ name?: string; article_number?: string; stock_quantity?: number; avg_daily?: number; dsi?: number | null }>; loading: boolean }) {
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
                        const hasDemand = row.dsi != null && safeFloat(row.avg_daily) > 0;
                        const dsi = hasDemand ? safeInt(row.dsi) : null;
                        const stock = safeInt(row.stock_quantity);
                        const riskColor = dsi == null ? DS.lo : dsi <= 0 ? DS.rose : dsi <= 7 ? DS.amber : dsi <= 30 ? DS.sky : dsi > 90 ? DS.amber : DS.emerald;
                        const riskLabel = dsi == null ? "No demand" : dsi <= 0 ? "Critical" : dsi <= 7 ? "Low cover" : dsi <= 30 ? "Watch" : dsi > 90 ? "Overstock" : "Healthy";
                        return (
                            <tr key={`${row.article_number ?? row.name ?? index}`} style={rowStyle}>
                                <BodyCell title={String(row.name || "")}><strong style={{ color: DS.hi }}>{shortLabel(row.name, 30)}</strong></BodyCell>
                                <BodyCell mono muted>{row.article_number || "-"}</BodyCell>
                                <BodyCell align="right" mono color={stock > 0 ? DS.emerald : DS.rose}>{stock.toLocaleString("en-US")}</BodyCell>
                                <BodyCell align="right" mono>{safeFloat(row.avg_daily).toFixed(2)}</BodyCell>
                                <BodyCell align="right" mono color={riskColor}>{dsi == null ? "No demand" : `${dsi}d`}</BodyCell>
                                <BodyCell><StockBadge label={riskLabel} color={riskColor} /></BodyCell>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </DataFrame>
    );
}

function CategoryList({ rows, loading, onSelect }: { rows: InventoryCategoryRow[]; loading: boolean; onSelect: (category: string) => void }) {
    return (
        <DataFrame maxHeight={230}>
            {loading && <EmptyState text="Loading categories..." />}
            {!loading && rows.length === 0 && <EmptyState text="No category data found." />}
            {!loading && rows.map((row, index) => (
                <button key={`${row.category_name}-${index}`} type="button" onClick={() => onSelect(row.category_name)} style={{ width: "100%", padding: "10px 0", border: 0, borderBottom: `1px solid rgba(255,255,255,0.04)`, background: "transparent", textAlign: "left", cursor: "pointer" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: DS.hi, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.category_name}</span>
                        <span style={{ fontSize: 11, color: DS.cyan, fontFamily: DS.mono }}>{eur(row.stock_value)}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8, color: DS.lo, fontSize: 9, fontFamily: DS.mono }}>
                        <span>{row.products} SKUs</span>
                        <span>{row.total_stock.toLocaleString()} total</span>
                        <span>{row.available_stock.toLocaleString()} available</span>
                        <span style={{ color: row.out_of_stock > 0 ? DS.rose : DS.emerald }}>{row.out_of_stock} out</span>
                    </div>
                </button>
            ))}
        </DataFrame>
    );
}

function AlertDetail({ selected }: { selected: AlertItem }) {
    const statusColor = selected.status === "out_of_stock" ? DS.rose : selected.status === "low_stock" ? DS.amber : DS.sky;
    const dsiColor = selected.dsi == null ? DS.lo : selected.dsi === 0 ? DS.rose : selected.dsi < 10 ? DS.amber : selected.dsi < 30 ? DS.sky : DS.emerald;
    const urgency = selected.status === "out_of_stock" ? "Critical — Reorder Immediately" : "Warning — Reorder Soon";
    return (
        <>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <Badge text={selected.status.replaceAll("_", " ").toUpperCase()} color={statusColor} />
                <Badge text={urgency} color={statusColor} />
            </div>
            <SectionLabel text="Stock Snapshot" />
            <MiniBar value={selected.dsi == null ? 0 : Math.min(selected.dsi, 60)} max={60} color={dsiColor} label={selected.dsi == null ? "No recent demand" : `${selected.dsi} days remaining (target: 30)`} />
            <SectionLabel text="Details" />
            <StatRow label="Product" value={selected.product} />
            <StatRow label="SKU" value={selected.sku} />
            <StatRow label="Category" value={selected.category} />
            <StatRow label="Warehouses" value={selected.warehouse} />
            <StatRow label="Recent Sales Channels" value={selected.channels || "No recent sales"} />
            <StatRow label="Current Stock" value={String(selected.stock)} color={selected.stock === 0 ? DS.rose : DS.hi} />
            <StatRow label="Days of Stock" value={selected.dsi == null ? "No demand" : `${selected.dsi} days`} color={dsiColor} />
            <StatRow label="Recommended Reorder Qty" value={String(selected.reorderQty)} color={DS.sky} />
            <SectionLabel text="Action Required" />
            <div style={{ padding: "12px 14px", borderRadius: 10, background: `${statusColor}10`, border: `1px solid ${statusColor}30`, fontSize: 11, color: DS.mid, lineHeight: 1.6 }}>
                {selected.status === "out_of_stock"
                    ? `Order ${selected.reorderQty} units immediately to avoid lost sales.`
                    : selected.dsi == null
                        ? "Stock is low, but recent demand is unavailable. Review demand history before placing a replenishment order."
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
        width: width > 0 ? width : "100%",
        fontSize: 11,
        color: DS.hi,
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${DS.border}`,
        borderRadius: 9,
        padding: "7px 10px",
        outline: "none",
    } as const;
}

function exportButtonStyle(disabled: boolean) {
    return {
        fontSize: 10,
        color: disabled ? DS.lo : DS.emerald,
        border: `1px solid ${DS.border}`,
        background: "rgba(255,255,255,0.035)",
        borderRadius: 8,
        padding: "7px 10px",
        cursor: disabled ? "not-allowed" : "pointer",
        whiteSpace: "nowrap",
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
