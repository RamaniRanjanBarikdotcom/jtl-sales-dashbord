"use client";

import { useState, useMemo } from "react";
import { BarChart, Bar, ScatterChart, Scatter, ZAxis, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine, LineChart, Line } from "recharts";
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
import { useStore } from "@/lib/store";
import { useProductsKpis, useProductsList, useProductsCategories, type ProductRow } from "@/hooks/useProductsData";
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

type CategoryShare = { name: string; v: number; c: string };
type ProductSortKey = "rev" | "units" | "margin" | "trend";
type TreemapTooltipPoint = { name?: string; value?: number };

// Build a simple sparkline from a single total revenue figure
// (12 synthetic monthly points scaled to the real total — cosmetic only)
function buildProductMonthly(p: ProductRow) {
    const factors = [0.06,0.07,0.07,0.08,0.08,0.09,0.09,0.08,0.09,0.09,0.10,0.10];
    return factors.map((f, i) => ({
        month: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i],
        rev: Math.round(p.rev * f),
    }));
}

export default function ProductsTab() {
    const { session } = useStore();
    const role = session?.role || "viewer";
    const isViewer = role === "viewer";
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [isExporting, setIsExporting] = useState(false);
    const kpisQ = useProductsKpis();
    const listQ = useProductsList({ page, limit: 30, search: search || undefined });
    const categoriesQ = useProductsCategories();
    const kpis = kpisQ.data ?? { totalSkus: 0, activeSkus: 0, avgMargin: 0, topCategoryRev: 0, topRevDelta: null, avgMarginDelta: null };
    const productsData = listQ.data ?? { rows: [], total: 0, page: 1, limit: 30 };
    const PRODUCTS = productsData.rows as ProductRow[];
    const CATS = (categoriesQ.data ?? []) as CategoryShare[];
    const TREEMAP_OPT = useMemo(() => ({
        backgroundColor: 'transparent',
        tooltip: { formatter: (p: TreemapTooltipPoint) => `${p.name ?? "Unknown"}: ${p.value ?? 0}%` },
        series: [{
            type: 'treemap',
            left: 0, right: 0, top: 0, bottom: 0,
            data: CATS.map((c: CategoryShare) => ({
                name: c.name,
                value: c.v,
                itemStyle: { color: c.c, borderWidth: 2, borderColor: 'rgba(2,5,8,0.6)', gapWidth: 2 }
            })),
            label: {
                show: true,
                formatter: (p: TreemapTooltipPoint) => `{name|${p.name ?? "Unknown"}}\n{val|${p.value ?? 0}%}`,
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
    const [sort, setSort] = useState<ProductSortKey>("rev");
    const sorted = useMemo(() => [...PRODUCTS].sort((a, b) => Number(b[sort]) - Number(a[sort])), [sort, PRODUCTS]);
    const maxRev = PRODUCTS[0]?.rev ?? 1;

    const [drawerType, setDrawerType] = useState<ProductDrawerType>(null);
    const [selected, setSelected] = useState<ProductRow | null>(null);
    const [treemapOpen, setTreemapOpen] = useState(false);
    const [treemapInitialCategory, setTreemapInitialCategory] = useState("");
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                <KpiCard label="Active Products" value={kpis.activeSkus.toLocaleString()} delta={null}                note="catalog size"   c={DS.sky}    icon="📦" data={PRODUCTS} k="margin" onClick={() => setDrawerType("skus")} />
                <KpiCard label="Total SKUs"      value={kpis.totalSkus.toLocaleString()}  delta={null}                note="catalog size"   c={DS.emerald} icon="💎" data={PRODUCTS} k="units" masked={isViewer} onClick={() => setDrawerType("skus")} />
                <KpiCard label="Top Product Rev" value={eur(kpis.topCategoryRev)}         delta={kpis.topRevDelta}    note="vs prev period" c={DS.violet} icon="🏆" data={PRODUCTS} k="rev" onClick={() => setDrawerType("top_rev")} />
                <KpiCard label="Avg Margin"      value={`${kpis.avgMargin}%`}             delta={kpis.avgMarginDelta} note="vs prev period" c={DS.amber}  icon="◇" data={PRODUCTS} k="margin" masked={isViewer} onClick={() => setDrawerType("avg_margin")} />
            </div>

            {/* Revenue Treemap */}
            <Card accent={DS.violet} onClick={() => setTreemapOpen(true)} style={{ cursor: "pointer" }}>
                <SH title="Revenue Treemap by Category" sub="Share of total revenue · proportional area" />
                <div style={{ height: 180 }}>
                    <ReactECharts option={TREEMAP_OPT} style={{ height: "100%", width: "100%" }} onEvents={treemapEvents} />
                </div>
            </Card>

            <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 12, alignItems: "stretch" }}>
                <Card accent={DS.sky} style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
                    <SH title="Product Performance" sub="Click any row for details · JTL-Wawi"
                        right={
                            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                                <input
                                    value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                                    placeholder="Search products…"
                                    aria-label="Search products"
                                    style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: "rgba(255,255,255,0.06)", border: `1px solid ${DS.border}`, color: DS.hi, outline: "none", width: 160 }}
                                />
                                {(role === "manager" || role === "admin" || role === "super_admin") && (
                                    <button
                                        onClick={async () => {
                                            try {
                                                setIsExporting(true);
                                                await exportProductsCsv({ search });
                                            } finally {
                                                setIsExporting(false);
                                            }
                                        }}
                                        disabled={isExporting}
                                        aria-label="Export products as CSV"
                                        style={{ fontSize: 9, padding: "3px 9px", borderRadius: 5, cursor: isExporting ? "not-allowed" : "pointer", border: `1px solid ${DS.border}`, background: "transparent", color: isExporting ? DS.lo : DS.emerald, opacity: isExporting ? 0.75 : 1 }}
                                    >
                                        {isExporting ? "Exporting..." : "↓ CSV"}
                                    </button>
                                )}
                                {(Object.entries({ rev: "Revenue", units: "Units", margin: "Margin", trend: "Trend" }) as [ProductSortKey, string][]).map(([k, l]) => (
                                    <button key={k} onClick={() => setSort(k)} style={{
                                        fontSize: 9, padding: "3px 9px", borderRadius: 5, cursor: "pointer",
                                        border: `1px solid ${sort === k ? DS.borderHi : DS.border}`,
                                        background: sort === k ? "rgba(56,189,248,0.1)" : "transparent",
                                        color: sort === k ? DS.sky : DS.lo,
                                    }}>{l}</button>
                                ))}
                            </div>
                        } />

                    <div style={{
                        border: `1px solid ${DS.border}`,
                        borderRadius: 12,
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "column",
                        minHeight: 360,
                        flex: 1,
                    }}>
                        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
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
                                                {isViewer ? <span style={{ fontSize: 10, color: DS.lo }}>🔒</span> : (
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
                        <SH title="Revenue Ranking" sub="By Product" />
                        <ResponsiveContainer width="100%" height={150}>
                            <BarChart data={sorted} layout="vertical" margin={{ top: 0, right: 5, bottom: 0, left: 0 }} barSize={9}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                                <XAxis type="number" tickFormatter={v => eur(v)} tick={{ fill: DS.lo, fontSize: 8 }} axisLine={false} tickLine={false} />
                                <YAxis type="category" dataKey="name" tick={{ fill: DS.lo, fontSize: 8 }} axisLine={false} tickLine={false} width={80} />
                                <Tooltip content={<ChartTip />} />
                                <Bar dataKey="rev" name="Revenue" radius={[0, 3, 3, 0]}>
                                    {sorted.map((_, i) => <Cell key={i} fill={`rgba(139,92,246,${1 - i * 0.09})`} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </Card>

                    <Card accent={DS.emerald}>
                        <SH title="Margin by Product" sub="Target: 40%" />
                        <ResponsiveContainer width="100%" height={150}>
                            <BarChart data={sorted} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barSize={18}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                <XAxis dataKey="name" tick={false} axisLine={false} tickLine={false} />
                                <YAxis domain={[0, 70]} tick={{ fill: DS.lo, fontSize: 8 }} axisLine={false} tickLine={false} width={22} />
                                <Tooltip content={<ChartTip />} />
                                <ReferenceLine y={40} stroke={DS.amber} strokeDasharray="4 3" strokeWidth={1} />
                                <Bar dataKey="margin" name="Margin %" radius={[3, 3, 0, 0]}>
                                    {sorted.map((p, i) => <Cell key={i} fill={p.margin > 50 ? DS.emerald : p.margin > 35 ? DS.sky : DS.amber} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </Card>

                    <Card accent={DS.cyan}>
                        <SH title="Margin vs Units vs Revenue" sub="Bubble matrix" />
                        <ResponsiveContainer width="100%" height={160}>
                            <ScatterChart margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                                <XAxis type="number" dataKey="margin" name="Margin %" tick={{ fill: DS.lo, fontSize: 8 }} axisLine={false} tickLine={false} />
                                <YAxis type="number" dataKey="units" name="Units" tick={{ fill: DS.lo, fontSize: 8 }} axisLine={false} tickLine={false} width={28} />
                                <ZAxis type="number" dataKey="rev" range={[40, 400]} name="Revenue" />
                                <Tooltip content={<ChartTip />} cursor={{ strokeDasharray: '3 3', stroke: DS.lo }} />
                                <Scatter name="SKUs" data={sorted} fill={DS.cyan} opacity={0.7}>
                                    {sorted.map((p, i) => <Cell key={i} fill={p.margin > 50 ? DS.emerald : p.margin > 35 ? DS.sky : DS.amber} />)}
                                </Scatter>
                            </ScatterChart>
                        </ResponsiveContainer>
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
                    const monthlyData = buildProductMonthly(selected);
                    const marginColor = selected.margin > 50 ? DS.emerald : selected.margin > 35 ? DS.sky : DS.amber;
                    return (
                        <>
                            {/* Status badges */}
                            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                                <Badge text={selected.cat} color={DS.sky} />
                                <Badge
                                    text={selected.margin > 50 ? "High Margin" : selected.margin > 35 ? "Good Margin" : "Low Margin"}
                                    color={marginColor}
                                />
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
                                    { l: "Margin", v: `${selected.margin}%`, c: marginColor },
                                    { l: "Rating", v: `★ ${selected.rating}`, c: DS.amber },
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
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={monthlyData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                        <XAxis dataKey="month" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                                        <YAxis tickFormatter={v => `€${(v / 1000).toFixed(0)}K`} tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={38} />
                                        <Tooltip content={<ChartTip />} />
                                        <Line type="monotone" dataKey="rev" name="Revenue" stroke={DS.sky} strokeWidth={2} dot={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Performance bars */}
                            <SectionLabel text="Performance Indicators" />
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                <MiniBar value={selected.rev} max={maxRev} color={DS.sky} label="Revenue share vs top product" />
                                <MiniBar value={selected.margin} max={70} color={marginColor} label={`Margin ${selected.margin}% (target: 40%)`} />
                                <MiniBar value={selected.units} max={Math.max(...PRODUCTS.map((p) => p.units || 0), 1)} color={DS.violet} label="Units vs best seller" />
                            </div>

                            {/* Details */}
                            <SectionLabel text="Product Details" />
                            <StatRow label="Article Number" value={selected.article_number || `SKU-${String(selected.id).padStart(4, "0")}`} />
                            <StatRow label="Category" value={selected.cat} />
                            <StatRow label="Revenue" value={eur(selected.rev)} color={DS.sky} />
                            <StatRow label="Units Sold" value={selected.units.toLocaleString()} color={DS.violet} />
                            {!isViewer && <StatRow label="Gross Margin" value={`${selected.margin}%`} color={marginColor} />}
                            <StatRow label="Customer Rating" value={`${selected.rating} / 5.0`} color={DS.amber} />
                            <StatRow label="Trend vs Last Year" value={selected.trend >= 0 ? `+${selected.trend}%` : `${selected.trend}%`} color={selected.trend >= 0 ? DS.emerald : DS.rose} />
                        </>
                    );
                })()}
            </DetailPanel>
        </div>
    );
}
