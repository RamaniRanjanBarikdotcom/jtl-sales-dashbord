"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ScatterChart, Scatter, ZAxis, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line } from "recharts";
import dynamic from "next/dynamic";
const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });
import { Card } from "@/components/ui/Card";
import { SectionHeader as SH } from "@/components/ui/SectionHeader";
import { Pill } from "@/components/ui/Pill";
import { KpiCard } from "@/components/ui/KpiCard";
import { BarFill } from "@/components/ui/BarFill";
import { ChartTip } from "@/components/charts/recharts/ChartTip";
import { DetailPanel, StatRow, SectionLabel, Badge, MiniBar } from "@/components/ui/DetailPanel";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import { useFilterStore, useStore, sessionHasPermission } from "@/lib/store";
import { useProductsKpis, useProductsList, useProductsCategories, useProductsTop, useProductTrend, type ProductRow } from "@/hooks/useProductsData";
import { Paginator } from "@/components/ui/Paginator";
import { exportProductsCsv } from "@/lib/export";
const ProductTreemapDrawer = dynamic(
    () => import("@/components/products/ProductTreemapDrawer").then((m) => m.ProductTreemapDrawer),
    { ssr: false },
);
const ProductKpiDrawer = dynamic(
    () => import("@/components/products/ProductKpiDrawer").then((m) => m.ProductKpiDrawer),
    { ssr: false },
);
import type { ProductDrawerType } from "@/components/products/ProductKpiDrawer";

type CategoryShare = { name: string; v: number; revenue: number; productCount: number; c: string };
type ProductSortKey = "rev" | "units" | "margin" | "trend";
type TreemapTooltipPoint = { name?: string; value?: number; data?: { revenue?: number } };
type ProductChartRow = ProductRow & { shortName: string };
type MatrixMetric = "rev" | "units" | "stock" | "trend";
const filterControl = {
    minWidth: 0,
    padding: "8px 10px",
    borderRadius: 7,
    border: `1px solid ${DS.border}`,
    background: "rgba(255,255,255,0.04)",
    color: DS.hi,
    fontSize: 10,
    outline: "none",
};

export default function ProductsTab() {
    const router = useRouter();
    const { session } = useStore();
    const role = session?.role || "viewer";
    const isViewer = role === "viewer";
    const canExportProducts = sessionHasPermission(session, "products.export");
    const resetGlobalFilters = useFilterStore((state) => state.resetFilters);
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [sku, setSku] = useState("");
    const [model, setModel] = useState("");
    const [category, setCategory] = useState("");
    const [catalogStatus, setCatalogStatus] = useState<"all" | "active" | "inactive">("all");
    const [salesStatus, setSalesStatus] = useState<"all" | "with_sales" | "no_sales" | "with_stock" | "without_stock" | "stock_no_sales">("all");
    const [minRevenue, setMinRevenue] = useState("");
    const [maxRevenue, setMaxRevenue] = useState("");
    const [minStock, setMinStock] = useState("");
    const [maxStock, setMaxStock] = useState("");
    const [sort, setSort] = useState<ProductSortKey>("rev");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [isExporting, setIsExporting] = useState(false);
    const kpisQ = useProductsKpis();
    const serverSort = sort === "rev" ? "total_revenue" : sort === "units" ? "total_units" : sort === "margin" ? "margin_pct" : "revenue_change";
    const productFilters = {
        search: search || undefined,
        sku: sku || undefined,
        model: model || undefined,
        category: category || undefined,
        catalogStatus,
        salesStatus,
        minRevenue: minRevenue === "" ? undefined : Number(minRevenue),
        maxRevenue: maxRevenue === "" ? undefined : Number(maxRevenue),
        minStock: minStock === "" ? undefined : Number(minStock),
        maxStock: maxStock === "" ? undefined : Number(maxStock),
        sort: serverSort,
        order: sortOrder,
    } as const;
    const listQ = useProductsList({ page, limit: 30, ...productFilters });
    const categoriesQ = useProductsCategories();
    const topQ = useProductsTop(25);
    const kpis = kpisQ.data ?? { totalSkus: 0, activeSkus: 0, avgMargin: 0, topCategoryRev: 0, topRevDelta: null, avgMarginDelta: null, marginAvailable: false, marginCoveragePct: 0, noSalesProducts: 0 };
    const productsData = listQ.data ?? { rows: [], total: 0, page: 1, limit: 30 };
    const PRODUCTS = productsData.rows as ProductRow[];
    const CATS = (categoriesQ.data ?? []) as CategoryShare[];
    const TREEMAP_OPT = useMemo(() => ({
        backgroundColor: 'transparent',
        tooltip: { formatter: (p: TreemapTooltipPoint) => `${p.name ?? "Unknown"}: ${eur(p.data?.revenue || 0)} (${p.value ?? 0}%)` },
        series: [{
            type: 'treemap',
            left: 0, right: 0, top: 0, bottom: 0,
            data: CATS.map((c: CategoryShare) => ({
                name: c.name,
                value: c.v,
                revenue: c.revenue,
                itemStyle: { color: c.c, borderWidth: 2, borderColor: 'rgba(2,5,8,0.6)', gapWidth: 2 }
            })),
            label: {
                show: true,
                formatter: (p: TreemapTooltipPoint) => `{name|${p.name ?? "Unknown"}}\n{val|${p.value ?? 0}% · ${eur(p.data?.revenue || 0)}}`,
                rich: {
                    name: { color: '#e2f0ff', fontSize: 11, fontWeight: 600 },
                    val:  { color: 'rgba(226,240,255,0.6)', fontSize: 10 },
                }
            },
            breadcrumb: { show: false },
            roam: false,
            nodeClick: false,
        }]
    }), [CATS]);
    const sorted = PRODUCTS;
    const maxRev = useMemo(() => Math.max(...PRODUCTS.map((p) => Number(p.rev) || 0), 1), [PRODUCTS]);
    const revenueRankingData = topQ.data ?? [];
    const performanceMatrixData = useMemo<ProductChartRow[]>(
        () => [...(PRODUCTS.length ? PRODUCTS : revenueRankingData)]
            .filter((p) => p.units > 0 && p.rev > 0)
            .sort((a, b) => b.rev - a.rev)
            .slice(0, 20)
            .map((p) => ({ ...p, shortName: p.name.length > 16 ? `${p.name.slice(0, 16)}…` : p.name })),
        [PRODUCTS, revenueRankingData],
    );
    const [matrixX, setMatrixX] = useState<MatrixMetric>("units");
    const [matrixY, setMatrixY] = useState<MatrixMetric>("rev");
    const [matrixSize, setMatrixSize] = useState<MatrixMetric>("stock");

    const [drawerType, setDrawerType] = useState<ProductDrawerType>(null);
    const [selected, setSelected] = useState<ProductRow | null>(null);
    const [treemapOpen, setTreemapOpen] = useState(false);
    const [treemapInitialCategory, setTreemapInitialCategory] = useState("");
    const trendQ = useProductTrend(selected?.jtl_product_id || undefined);
    const monthlyData = useMemo(() => {
        const rows = trendQ.data ?? [];
        return rows.map((r) => ({
            month: new Date(r.year_month).toLocaleDateString('en-US', { month: 'short' }),
            rev: r.revenue,
        }));
    }, [trendQ.data]);
    const isInitialLoading =
        ((kpisQ.isLoading || kpisQ.isPending) && !kpisQ.data) ||
        ((listQ.isLoading || listQ.isPending) && !listQ.data);

    if (isInitialLoading) {
        const shimmer = {
            background: "linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.08) 40%, rgba(255,255,255,0.03) 100%)",
            backgroundSize: "240% 100%",
            animation: "productsShimmer 1.1s linear infinite",
            border: `1px solid ${DS.border}`,
            borderRadius: 14,
        } as const;
        return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <style>{`@keyframes productsShimmer { 0% { background-position: 200% 0; } 100% { background-position: -40% 0; } }`}</style>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} style={{ ...shimmer, height: 128 }} />
                    ))}
                </div>
                <div style={{ ...shimmer, height: 220 }} />
                <div style={{ ...shimmer, height: 420 }} />
            </div>
        );
    }

    const treemapEvents = useMemo(() => ({
        click: (p: { name?: string }) => {
            if (p?.name) setTreemapInitialCategory(String(p.name));
            setTreemapOpen(true);
        },
    }), []);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <ProductKpiDrawer type={drawerType} onClose={() => setDrawerType(null)} />
            <ProductTreemapDrawer
                open={treemapOpen}
                onClose={() => { setTreemapOpen(false); setTreemapInitialCategory(""); }}
                initialCategory={treemapInitialCategory}
            />
            <div className="analytics-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                <KpiCard label="Active Products" value={kpis.activeSkus.toLocaleString()} delta={null}                note="active in catalog" c={DS.sky}    icon="📦" data={PRODUCTS} k="rev" onClick={() => setDrawerType("skus")} />
                <KpiCard label="Total SKUs"      value={kpis.totalSkus.toLocaleString()}  delta={null}                note="total catalog"     c={DS.emerald} icon="💎" data={PRODUCTS} k="units" masked={isViewer} onClick={() => setDrawerType("skus")} />
                <KpiCard label="Top Product Rev" value={eur(kpis.topCategoryRev)}         delta={kpis.topRevDelta}    note="vs prev period" c={DS.violet} icon="🏆" data={PRODUCTS} k="rev" onClick={() => setDrawerType("top_rev")} />
                <KpiCard
                    label={kpis.marginAvailable ? "Avg Margin" : "No-Sales Products"}
                    value={kpis.marginAvailable ? `${kpis.avgMargin}%` : kpis.noSalesProducts.toLocaleString()}
                    delta={kpis.marginAvailable ? kpis.avgMarginDelta : null}
                    note={kpis.marginAvailable ? `${kpis.marginCoveragePct}% cost coverage` : "real products without sales"}
                    c={DS.amber}
                    icon="◇"
                    data={PRODUCTS}
                    k={kpis.marginAvailable ? "margin" : "units"}
                    masked={isViewer && kpis.marginAvailable}
                    onClick={() => setDrawerType(kpis.marginAvailable ? "avg_margin" : "skus")}
                />
            </div>

            {/* Revenue Treemap */}
            <Card accent={DS.violet} onClick={() => setTreemapOpen(true)} style={{ cursor: "pointer" }}>
                <SH title="Revenue Treemap by Category" sub="Share of total revenue · proportional area" />
                <div style={{ height: 180 }}>
                    <ReactECharts option={TREEMAP_OPT} style={{ height: "100%", width: "100%" }} onEvents={treemapEvents} />
                </div>
            </Card>

            <Card accent={DS.cyan}>
                <SH title="Product Filters" sub="Server-side filters shared by the table and CSV export" right={
                    <button className="analytics-clear-button" onClick={() => {
                        resetGlobalFilters();
                        setSearch(""); setSku(""); setModel(""); setCategory("");
                        setCatalogStatus("all"); setSalesStatus("all");
                        setMinRevenue(""); setMaxRevenue(""); setMinStock(""); setMaxStock("");
                        setPage(1);
                    }}>Clear filters</button>
                } />
                <div className="analytics-filter-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 8 }}>
                    <input value={sku} onChange={(event) => { setSku(event.target.value); setPage(1); }} placeholder="SKU / article number" style={filterControl} />
                    <input value={model} onChange={(event) => { setModel(event.target.value); setPage(1); }} placeholder="Model / product name" style={filterControl} />
                    <select value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }} style={filterControl}>
                        <option value="">All categories</option>
                        {CATS.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                    </select>
                    <select value={catalogStatus} onChange={(event) => { setCatalogStatus(event.target.value as typeof catalogStatus); setPage(1); }} style={filterControl}>
                        <option value="all">Active + inactive</option><option value="active">Active only</option><option value="inactive">Inactive only</option>
                    </select>
                    <select value={salesStatus} onChange={(event) => { setSalesStatus(event.target.value as typeof salesStatus); setPage(1); }} style={filterControl}>
                        <option value="all">All sales/stock</option><option value="with_sales">Products with sales</option><option value="no_sales">Products without sales</option><option value="with_stock">Products with stock</option><option value="without_stock">Products without stock</option><option value="stock_no_sales">Stock with no sales</option>
                    </select>
                    <input type="number" value={minRevenue} onChange={(event) => { setMinRevenue(event.target.value); setPage(1); }} placeholder="Min revenue" style={filterControl} />
                    <input type="number" value={maxRevenue} onChange={(event) => { setMaxRevenue(event.target.value); setPage(1); }} placeholder="Max revenue" style={filterControl} />
                    <input type="number" value={minStock} onChange={(event) => { setMinStock(event.target.value); setPage(1); }} placeholder="Min total stock" style={filterControl} />
                    <input type="number" value={maxStock} onChange={(event) => { setMaxStock(event.target.value); setPage(1); }} placeholder="Max total stock" style={filterControl} />
                </div>
                <p style={{ margin: "8px 0 0", color: DS.lo, fontSize: 10 }}>Manufacturer/brand is unavailable because JTL manufacturer data is not currently synced; no value is fabricated.</p>
            </Card>

            <div className="analytics-two-column" style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 12, alignItems: "start" }}>
                <Card accent={DS.sky} style={{ display: "flex", flexDirection: "column" }}>
                    <SH title="Product Performance"
                        sub={productsData.total > 0 ? `${productsData.total.toLocaleString()} products · page ${productsData.page} · scroll &amp; paginate` : "Click any row for details · JTL-Wawi"}
                        right={
                            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                                <input
                                    value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                                    placeholder="Search products…"
                                    aria-label="Search products"
                                    style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: "rgba(255,255,255,0.06)", border: `1px solid ${DS.border}`, color: DS.hi, outline: "none", width: 160 }}
                                />
                                {canExportProducts && (
                                    <button
                                        onClick={async () => {
                                            try {
                                                setIsExporting(true);
                                                await exportProductsCsv(productFilters);
                                            } finally {
                                                setIsExporting(false);
                                            }
                                        }}
                                        disabled={isExporting}
                                        aria-label="Export products as CSV"
                                        className="analytics-download-button"
                                        style={{ fontSize: 9, padding: "3px 9px", borderRadius: 5, cursor: isExporting ? "not-allowed" : "pointer", opacity: isExporting ? 0.75 : 1 }}
                                    >
                                        {isExporting ? "Preparing…" : "Download CSV"}
                                    </button>
                                )}
                                {(Object.entries({ rev: "Revenue", units: "Units", margin: "Margin", trend: "Trend" }) as [ProductSortKey, string][]).map(([k, l]) => (
                                    <button key={k} onClick={() => { if (sort === k) setSortOrder((value) => value === "desc" ? "asc" : "desc"); else { setSort(k); setSortOrder("desc"); } setPage(1); }} style={{
                                        fontSize: 9, padding: "3px 9px", borderRadius: 5, cursor: "pointer",
                                        border: `1px solid ${sort === k ? DS.borderHi : DS.border}`,
                                        background: sort === k ? "rgba(56,189,248,0.1)" : "transparent",
                                        color: sort === k ? DS.sky : DS.lo,
                                    }}>{l}{sort === k ? (sortOrder === "desc" ? " ↓" : " ↑") : ""}</button>
                                ))}
                            </div>
                        } />

                    <div style={{
                        border: `1px solid ${DS.border}`,
                        borderRadius: 12,
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "column",
                        height: 480,
                    }}>
                        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: `rgba(56,189,248,0.3) transparent` }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                                <colgroup>
                                    <col style={{ width: "5%" }} />
                                    <col style={{ width: "42%" }} />
                                    <col style={{ width: "16%" }} />
                                    <col style={{ width: "11%" }} />
                                    <col style={{ width: "9%" }} />
                                    <col style={{ width: "8%" }} />
                                    <col style={{ width: "9%" }} />
                                    <col style={{ width: "9%" }} />
                                </colgroup>
                                <thead>
                                    <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                                        {["#", "Product", "Cat", "Revenue", "Units", "Margin", "Trend", "—"].map((h, i) => (
                                            <th key={i} style={{
                                                textAlign: i > 2 ? "right" : "left",
                                                fontSize: 9,
                                                color: DS.lo,
                                                letterSpacing: "0.07em",
                                                textTransform: "uppercase",
                                                padding: "8px 7px 10px",
                                                fontWeight: 500,
                                                position: "sticky",
                                                top: 0,
                                                zIndex: 1,
                                                background: "rgba(6,13,24,0.96)",
                                            }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {listQ.isError && (
                                        <tr><td colSpan={8} style={{ padding: "34px 12px", textAlign: "center", color: DS.rose }}>Product data could not be loaded. Clear filters and retry.</td></tr>
                                    )}
                                    {!listQ.isError && listQ.isFetching && sorted.length === 0 && (
                                        <tr><td colSpan={8} style={{ padding: "34px 12px", textAlign: "center", color: DS.lo }}>Loading filtered products…</td></tr>
                                    )}
                                    {!listQ.isError && !listQ.isFetching && sorted.length === 0 && (
                                        <tr><td colSpan={8} style={{ padding: "34px 12px", textAlign: "center", color: DS.lo }}>No products match the current filters.</td></tr>
                                    )}
                                    {sorted.map((p, i) => (
                                        <tr key={String(p.id ?? `${p.article_number ?? 'sku'}-${i}`)}
                                            onClick={() => setSelected(p)}
                                            style={{
                                                borderBottom: `1px solid rgba(255,255,255,0.03)`,
                                                transition: "background 0.15s", cursor: "pointer",
                                                background: selected?.id === p.id ? DS.panelHi : "transparent",
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.background = DS.panelHi}
                                            onMouseLeave={e => e.currentTarget.style.background = selected?.id === p.id ? DS.panelHi : "transparent"}>
                                            <td style={{ padding: "10px 7px", fontSize: 10, color: DS.lo, fontFamily: DS.mono }}>{String(i + 1 + (productsData.page - 1) * productsData.limit).padStart(2, "0")}</td>
                                            <td style={{
                                                padding: "10px 7px",
                                                fontSize: 12,
                                                color: DS.hi,
                                                fontWeight: 500,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                whiteSpace: "nowrap",
                                            }}>{p.name}</td>
                                            <td style={{ padding: "10px 7px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 20, background: "rgba(255,255,255,0.06)", color: DS.mid }}>{p.cat}</span>
                                            </td>
                                            <td style={{ padding: "10px 7px", textAlign: "right", fontSize: 12, color: DS.sky, fontFamily: DS.mono, fontWeight: 600 }}>{eur(p.rev)}</td>
                                            <td style={{ padding: "10px 7px", textAlign: "right", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{p.units.toLocaleString()}</td>
                                            <td style={{ padding: "10px 7px", textAlign: "right" }}>
                                                {isViewer ? <span style={{ fontSize: 10, color: DS.lo }}>🔒</span> : !p.marginAvailable ? <span style={{ fontSize: 9, color: DS.lo }}>Unavailable</span> : (
                                                    <span style={{
                                                        fontSize: 10, padding: "2px 7px", borderRadius: 20, fontWeight: 600,
                                                        background: p.margin > 50 ? "rgba(16,185,129,0.12)" : p.margin > 35 ? "rgba(56,189,248,0.1)" : "rgba(245,158,11,0.1)",
                                                        color: p.margin > 50 ? DS.emerald : p.margin > 35 ? DS.sky : DS.amber,
                                                    }}>{p.margin}%</span>
                                                )}
                                            </td>
                                            <td style={{ padding: "10px 7px", textAlign: "right" }}><Pill v={p.trend} size={9} /></td>
                                            <td style={{ padding: "10px 7px", textAlign: "right", width: 64 }}><BarFill v={p.rev} max={maxRev} c={DS.sky} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div style={{ paddingTop: 8 }}>
                        <Paginator page={productsData.page} total={productsData.total} limit={productsData.limit} onPageChange={setPage} />
                    </div>
                </Card>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <Card accent={DS.violet}>
                        <SH title="Revenue Ranking" sub="Top 10 · all products · real revenue" />
                        {topQ.isLoading ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 6 }}>
                                {Array.from({ length: 8 }).map((_, i) => (
                                    <div key={i} style={{ height: 32, borderRadius: 6, background: "rgba(255,255,255,0.04)", backgroundImage: "linear-gradient(90deg,rgba(255,255,255,0.03) 0%,rgba(255,255,255,0.08) 40%,rgba(255,255,255,0.03) 100%)", backgroundSize: "240% 100%", animation: "productsShimmer 1.1s linear infinite" }} />
                                ))}
                            </div>
                        ) : revenueRankingData.length === 0 ? (
                            <div style={{ padding: "28px 0", textAlign: "center", color: DS.lo, fontSize: 12 }}>No revenue data — sync orders from JTL</div>
                        ) : (() => {
                            const maxRev = revenueRankingData[0]?.rev || 1;
                            const RANK_COLORS = [DS.violet, DS.sky, DS.emerald];
                            return (
                                <div style={{ maxHeight: 420, overflowY: "auto", paddingRight: 2, marginTop: 8, scrollbarWidth: "thin", scrollbarColor: "rgba(139,92,246,0.3) transparent" }}>
                                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                                    {revenueRankingData.map((p, i) => {
                                        const pct = Math.max(3, Math.round((p.rev / maxRev) * 100));
                                        const accent = RANK_COLORS[i] ?? DS.violet;
                                        const name = p.name.length > 28 ? `${p.name.slice(0, 28)}…` : p.name;
                                        return (
                                            <div key={p.id ?? i} style={{ padding: "7px 0", borderBottom: i < revenueRankingData.length - 1 ? `1px solid rgba(255,255,255,0.04)` : "none" }}>
                                                {/* Row: rank · name · revenue */}
                                                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                                    <span style={{
                                                        flexShrink: 0,
                                                        width: 20, height: 20, borderRadius: 5,
                                                        background: i < 3 ? `${accent}22` : "rgba(255,255,255,0.05)",
                                                        border: `1px solid ${i < 3 ? accent : "rgba(255,255,255,0.08)"}`,
                                                        display: "flex", alignItems: "center", justifyContent: "center",
                                                        fontSize: 9, fontFamily: DS.mono, fontWeight: 700,
                                                        color: i < 3 ? accent : DS.lo,
                                                    }}>{i + 1}</span>
                                                    <span style={{
                                                        flex: 1, minWidth: 0,
                                                        fontSize: 11, color: DS.hi, fontWeight: i < 3 ? 600 : 400,
                                                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                                    }}>{name}</span>
                                                    <span style={{
                                                        flexShrink: 0,
                                                        fontSize: 11, fontFamily: DS.mono, fontWeight: 700,
                                                        color: i < 3 ? accent : DS.mid,
                                                    }}>{eur(p.rev)}</span>
                                                </div>
                                                {/* Bar */}
                                                <div style={{ marginTop: 5, marginLeft: 28, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                                                    <div style={{
                                                        height: "100%", width: `${pct}%`, borderRadius: 3,
                                                        background: i < 3
                                                            ? `linear-gradient(90deg, ${accent}, ${accent}88)`
                                                            : `linear-gradient(90deg, rgba(139,92,246,0.7), rgba(139,92,246,0.3))`,
                                                        transition: "width 0.5s ease",
                                                    }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                </div>
                            );
                        })()}
                    </Card>

                    <Card accent={DS.emerald}>
                        <SH title="Stock vs Sales Performance" sub="X = units sold · Y = current total stock · bubble = revenue" />
                        {performanceMatrixData.length === 0 ? <div style={{ height: 210, display: "grid", placeItems: "center", color: DS.lo, fontSize: 11 }}>No product sales data for the selected filters.</div> : <ResponsiveContainer width="100%" height={210}>
                            <ScatterChart margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                                <XAxis type="number" dataKey="units" name="Units sold" tick={{ fill: DS.lo, fontSize: 8 }} axisLine={false} tickLine={false} />
                                <YAxis type="number" dataKey="stock" name="Total stock" tick={{ fill: DS.lo, fontSize: 8 }} axisLine={false} tickLine={false} width={36} />
                                <ZAxis type="number" dataKey="rev" range={[45, 360]} name="Revenue" />
                                <Tooltip content={<ChartTip />} cursor={{ strokeDasharray: "3 3", stroke: DS.lo }} />
                                <Scatter name="Products" data={performanceMatrixData} opacity={0.8} onClick={(point) => { const id = Number((point as unknown as { payload?: { id?: number | string } })?.payload?.id || 0); if (id) router.push(`/dashboard/products/${id}/intelligence`); }}>
                                    {performanceMatrixData.map((product, index) => <Cell key={index} fill={product.units > 0 && product.stock <= 5 ? DS.rose : product.stock > product.units * 3 ? DS.amber : DS.emerald} />)}
                                </Scatter>
                            </ScatterChart>
                        </ResponsiveContainer>}
                    </Card>

                    <Card accent={DS.cyan}>
                        <SH
                            title="Product Performance Matrix"
                            sub="Select real metrics · current filtered products"
                            right={<div style={{ display: "flex", gap: 5 }}>
                                <MetricSelect label="X" value={matrixX} onChange={setMatrixX} />
                                <MetricSelect label="Y" value={matrixY} onChange={setMatrixY} />
                                <MetricSelect label="Size" value={matrixSize} onChange={setMatrixSize} />
                            </div>}
                        />
                        {performanceMatrixData.length === 0 ? <div style={{ height: 210, display: "grid", placeItems: "center", color: DS.lo, fontSize: 11 }}>No product metrics for the selected filters.</div> : <ResponsiveContainer width="100%" height={210}>
                            <ScatterChart margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                                <XAxis type="number" dataKey={matrixX} name={matrixLabel(matrixX)} tick={{ fill: DS.lo, fontSize: 8 }} axisLine={false} tickLine={false} />
                                <YAxis type="number" dataKey={matrixY} name={matrixLabel(matrixY)} tick={{ fill: DS.lo, fontSize: 8 }} axisLine={false} tickLine={false} width={36} />
                                <ZAxis type="number" dataKey={matrixSize} range={[45, 360]} name={matrixLabel(matrixSize)} />
                                <Tooltip content={<ChartTip />} cursor={{ strokeDasharray: "3 3", stroke: DS.lo }} />
                                <Scatter name="Products" data={performanceMatrixData} opacity={0.8} onClick={(point) => { const id = Number((point as unknown as { payload?: { id?: number | string } })?.payload?.id || 0); if (id) router.push(`/dashboard/products/${id}/intelligence`); }}>
                                    {performanceMatrixData.map((product, index) => <Cell key={index} fill={product.trend > 0 ? DS.emerald : product.trend < 0 ? DS.rose : DS.sky} />)}
                                </Scatter>
                            </ScatterChart>
                        </ResponsiveContainer>}
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: DS.lo }}>
                            <span>X: {matrixLabel(matrixX)}</span>
                            <span>Y: {matrixLabel(matrixY)} · Bubble: {matrixLabel(matrixSize)}</span>
                        </div>
                    </Card>
                </div>
            </div>

            {/* Product Detail Panel */}
            <DetailPanel
                open={!!selected}
                title={selected?.name || ""}
                subtitle={`Category: ${selected?.cat || ""} · Rank #${selected?.rank || ""}`}
                onClose={() => setSelected(null)}
            >
                {selected && (() => {
                    const marginColor = selected.margin > 50 ? DS.emerald : selected.margin > 35 ? DS.sky : DS.amber;
                    return (
                        <>
                            {/* Status badges */}
                            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                                <Badge text={selected.cat} color={DS.sky} />
                                {selected.marginAvailable && <Badge
                                    text={selected.margin > 50 ? "High Margin" : selected.margin > 35 ? "Good Margin" : "Low Margin"}
                                    color={marginColor}
                                />}
                                <Badge
                                    text={selected.trend >= 0 ? `↑ ${selected.trend}%` : `↓ ${Math.abs(selected.trend)}%`}
                                    color={selected.trend >= 0 ? DS.emerald : DS.rose}
                                />
                            </div>

                            {/* KPI grid */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 4 }}>
                                {[
                                    { l: "Total Revenue", v: eur(selected.rev), c: DS.sky },
                                    { l: "Units Sold", v: selected.units.toLocaleString(), c: DS.violet },
                                    { l: "Margin", v: selected.marginAvailable ? `${selected.margin}%` : "Unavailable", c: selected.marginAvailable ? marginColor : DS.lo },
                                    { l: "Trend Points", v: monthlyData.length.toLocaleString(), c: DS.amber },
                                ].map((item, i) => (
                                    <div key={i} style={{
                                        padding: "12px 14px", borderRadius: 10,
                                        background: DS.panel,
                                        border: `1px solid ${DS.border}`,
                                    }}>
                                        <div style={{ fontSize: 9, color: DS.lo, marginBottom: 4, letterSpacing: "0.06em", textTransform: "uppercase" }}>{item.l}</div>
                                        <div style={{ fontSize: 18, color: item.c, fontFamily: DS.mono, fontWeight: 700 }}>{item.v}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Revenue trend chart */}
                            <SectionLabel text="Revenue Trend — Last 12 Months" />
                            <div style={{ height: 120, marginBottom: 4 }}>
                                {monthlyData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={monthlyData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                            <XAxis dataKey="month" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                                            <YAxis tickFormatter={v => `€${(v / 1000).toFixed(0)}K`} tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={38} />
                                            <Tooltip content={<ChartTip />} />
                                            <Line type="monotone" dataKey="rev" name="Revenue" stroke={DS.sky} strokeWidth={2} dot={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: DS.lo }}>
                                        {trendQ.isFetching ? "Loading trend..." : "No real trend data for this product and period."}
                                    </div>
                                )}
                            </div>

                            {/* Performance bars */}
                            <SectionLabel text="Performance Indicators" />
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                <MiniBar value={selected.rev} max={maxRev} color={DS.sky} label="Revenue share vs top product" />
                                {selected.marginAvailable && <MiniBar value={selected.margin} max={70} color={marginColor} label={`Margin ${selected.margin}% (target: 40%)`} />}
                                <MiniBar value={selected.units} max={Math.max(...PRODUCTS.map((p) => p.units || 0), 1)} color={DS.violet} label="Units vs best seller" />
                            </div>

                            {/* Details */}
                            <SectionLabel text="Product Details" />
                            <StatRow label="Article Number" value={selected.article_number || `SKU-${String(selected.id).padStart(4, "0")}`} />
                            <StatRow label="Category" value={selected.cat} />
                            <StatRow label="Revenue" value={eur(selected.rev)} color={DS.sky} />
                            <StatRow label="Units Sold" value={selected.units.toLocaleString()} color={DS.violet} />
                            {!isViewer && <StatRow label="Gross Margin" value={selected.marginAvailable ? `${selected.margin}%` : "Margin unavailable"} color={selected.marginAvailable ? marginColor : DS.lo} />}
                            <StatRow label="Trend Samples" value={monthlyData.length.toLocaleString()} color={DS.amber} />
                            <StatRow label="Trend vs Last Year" value={selected.trend >= 0 ? `+${selected.trend}%` : `${selected.trend}%`} color={selected.trend >= 0 ? DS.emerald : DS.rose} />
                            <button onClick={() => router.push(`/dashboard/products/${selected.id}/intelligence`)} style={{ marginTop: 14, width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${DS.sky}55`, background: `${DS.sky}12`, color: DS.sky, cursor: "pointer" }}>Open Product Intelligence</button>
                        </>
                    );
                })()}
            </DetailPanel>
        </div>
    );
}

function matrixLabel(metric: MatrixMetric) {
    return metric === "rev" ? "Revenue" : metric === "units" ? "Units" : metric === "stock" ? "Total stock" : "Growth %";
}

function MetricSelect({ label, value, onChange }: { label: string; value: MatrixMetric; onChange: (value: MatrixMetric) => void }) {
    return (
        <label style={{ display: "flex", alignItems: "center", gap: 3, color: DS.lo, fontSize: 9 }}>
            {label}
            <select value={value} onChange={(event) => onChange(event.target.value as MatrixMetric)} style={{ background: "#0b1528", color: DS.hi, border: `1px solid ${DS.border}`, borderRadius: 6, fontSize: 9, padding: "3px 5px" }}>
                <option value="rev">Revenue</option>
                <option value="units">Units</option>
                <option value="stock">Stock</option>
                <option value="trend">Growth</option>
            </select>
        </label>
    );
}
