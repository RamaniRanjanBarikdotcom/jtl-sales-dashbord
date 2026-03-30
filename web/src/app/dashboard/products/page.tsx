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
import { MONTHLY } from "@/lib/mock-data";
import { eur } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { useProductsKpis, useProductsList, useProductsCategories } from "@/hooks/useProductsData";
import { Paginator } from "@/components/ui/Paginator";
import { exportProductsCsv } from "@/lib/export";

// Simulated monthly revenue per product using trend
function buildProductMonthly(p: any) {
    return MONTHLY.map((m, i) => ({
        month: m.month,
        rev: Math.round((p.rev / 12) * (0.7 + (i / 11) * 0.6) * (1 + Math.sin(i) * 0.08)),
    }));
}

export default function ProductsTab() {
    const { session } = useStore();
    const role = session?.role || "viewer";
    const isViewer = role === "viewer";
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const kpis = useProductsKpis().data ?? { totalSkus: 0, activeSkus: 0, avgMargin: 0, topCategoryRev: 0 };
    const productsData = useProductsList({ page, search: search || undefined }).data ?? { rows: [], total: 0, page: 1, limit: 50 };
    const PRODUCTS = productsData.rows;
    const CATS = useProductsCategories().data ?? [];
    const TREEMAP_OPT = useMemo(() => ({
        backgroundColor: 'transparent',
        tooltip: { formatter: (p: any) => `${p.name}: ${p.value}%` },
        series: [{
            type: 'treemap',
            left: 0, right: 0, top: 0, bottom: 0,
            data: (CATS ?? []).map((c: any) => ({
                name: c.name,
                value: c.v,
                itemStyle: { color: c.c, borderWidth: 2, borderColor: 'rgba(2,5,8,0.6)', gapWidth: 2 }
            })),
            label: {
                show: true,
                formatter: (p: any) => `{name|${p.name}}\n{val|${p.value}%}`,
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
    const [sort, setSort] = useState<string>("rev");
    const sorted = useMemo(() => [...(PRODUCTS ?? [])].sort((a: any, b: any) => b[sort] - a[sort]), [sort, PRODUCTS]);
    const maxRev = (PRODUCTS ?? [])[0]?.rev ?? 1;

    const [selected, setSelected] = useState<any>(null);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                <KpiCard label="Active Products" value={kpis.activeSkus.toLocaleString()} delta={6.1} note="vs last month" c={DS.sky} icon="📦" data={PRODUCTS} k="margin" />
                <KpiCard label="Total SKUs" value={kpis.totalSkus.toLocaleString()} delta={3.2} note="vs last month" c={DS.emerald} icon="💎" data={PRODUCTS} k="units" masked={isViewer} />
                <KpiCard label="Top Product Rev" value={eur(kpis.topCategoryRev)} delta={12.4} note="vs last month" c={DS.violet} icon="🏆" data={PRODUCTS} k="rev" />
                <KpiCard label="Avg Margin" value={`${kpis.avgMargin}%`} delta={2.1} note="all products" c={DS.amber} icon="◇" data={PRODUCTS} k="margin" masked={isViewer} />
            </div>

            {/* Revenue Treemap */}
            <Card accent={DS.violet}>
                <SH title="Revenue Treemap by Category" sub="Share of total revenue · proportional area" />
                <div style={{ height: 180 }}>
                    <ReactECharts option={TREEMAP_OPT} style={{ height: "100%", width: "100%" }} />
                </div>
            </Card>

            <div style={{ display: "grid", gridTemplateColumns: "1.7fr 1fr", gap: 12 }}>
                <Card accent={DS.sky}>
                    <SH title="Product Performance" sub="Click any row for details · JTL-Wawi"
                        right={
                            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                                <input
                                    value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                                    placeholder="Search products…"
                                    style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: "rgba(255,255,255,0.06)", border: `1px solid ${DS.border}`, color: DS.hi, outline: "none", width: 160 }}
                                />
                                {(role === "manager" || role === "admin" || role === "super_admin") && (
                                    <button onClick={() => exportProductsCsv({ search })} style={{ fontSize: 9, padding: "3px 9px", borderRadius: 5, cursor: "pointer", border: `1px solid ${DS.border}`, background: "transparent", color: DS.emerald }}>↓ CSV</button>
                                )}
                                {(Object.entries({ rev: "Revenue", units: "Units", margin: "Margin", trend: "Trend" }) as [string, string][]).map(([k, l]) => (
                                    <button key={k} onClick={() => setSort(k)} style={{
                                        fontSize: 9, padding: "3px 9px", borderRadius: 5, cursor: "pointer",
                                        border: `1px solid ${sort === k ? DS.borderHi : DS.border}`,
                                        background: sort === k ? "rgba(56,189,248,0.1)" : "transparent",
                                        color: sort === k ? DS.sky : DS.lo,
                                    }}>{l}</button>
                                ))}
                            </div>
                        } />
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                                {["#", "Product", "Cat", "Revenue", "Units", "Margin", "Trend", "—"].map((h, i) => (
                                    <th key={i} style={{
                                        textAlign: i > 2 ? "right" : "left", fontSize: 9, color: DS.lo,
                                        letterSpacing: "0.07em", textTransform: "uppercase",
                                        padding: "0 7px 10px", fontWeight: 500
                                    }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((p, i) => (
                                <tr key={i}
                                    onClick={() => setSelected(p)}
                                    style={{
                                        borderBottom: `1px solid rgba(255,255,255,0.03)`,
                                        transition: "background 0.15s", cursor: "pointer",
                                        background: selected?.id === p.id ? DS.panelHi : "transparent",
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = DS.panelHi}
                                    onMouseLeave={e => e.currentTarget.style.background = selected?.id === p.id ? DS.panelHi : "transparent"}>
                                    <td style={{ padding: "10px 7px", fontSize: 10, color: DS.lo, fontFamily: DS.mono }}>{String(i + 1).padStart(2, "0")}</td>
                                    <td style={{ padding: "10px 7px", fontSize: 12, color: DS.hi, fontWeight: 500 }}>{p.name}</td>
                                    <td style={{ padding: "10px 7px" }}>
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
                    <Paginator page={productsData.page} total={productsData.total} limit={productsData.limit} onPageChange={setPage} />
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
                                <MiniBar value={selected.units} max={1420} color={DS.violet} label="Units vs best seller" />
                            </div>

                            {/* Details */}
                            <SectionLabel text="Product Details" />
                            <StatRow label="Article Number" value={`SKU-${String(selected.id).padStart(4, "0")}`} />
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
