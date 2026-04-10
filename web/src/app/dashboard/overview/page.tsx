"use client";

import { ComposedChart, AreaChart, Area, Line, BarChart, Bar, LineChart, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { GaugeChart } from "@/components/charts/echarts/GaugeChart";
import { Card } from "@/components/ui/Card";
import { SectionHeader as SH } from "@/components/ui/SectionHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { BarFill } from "@/components/ui/BarFill";
import { ChartTip } from "@/components/charts/recharts/ChartTip";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import { useMarketingCampaigns } from "@/hooks/useMarketingData";
import { useOverviewKpis, useOverviewRevenue, useOverviewDaily, useOverviewCategories, useOverviewTopProducts } from "@/hooks/useOverviewData";

const SHIMMER = {
    background: "linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0.04) 75%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.6s infinite",
} as const;

export default function OverviewTab() {
    const kpisQ      = useOverviewKpis();
    const revenueQ   = useOverviewRevenue();
    const dailyQ     = useOverviewDaily();
    const catsQ      = useOverviewCategories();
    const topProdsQ  = useOverviewTopProducts();
    const campaignsQ = useMarketingCampaigns();

    const kpis       = kpisQ.data ?? { totalRevenue: 0, totalOrders: 0, totalProducts: 0, totalCustomers: 0, lowStockCount: 0 };
    const monthly    = revenueQ.data ?? [];
    const daily      = dailyQ.data ?? [];
    const categories = catsQ.data ?? [];
    const topProds   = topProdsQ.data ?? [];
    const loading    = kpisQ.isLoading;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
            {/* Multi-Domain KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
                {loading ? (
                    [DS.sky, DS.violet, DS.orange, DS.amber, DS.emerald].map((c, i) => (
                        <div key={i} style={{ ...SHIMMER, borderRadius: 16, height: 130, border: `1px solid ${DS.border}` }} />
                    ))
                ) : (
                    <>
                        <KpiCard label="Total Revenue (Sales)" value={eur(kpis.totalRevenue)} delta={0} note="all time" c={DS.sky} icon="◈" data={monthly} k="revenue" />
                        <KpiCard label="Active Products" value={kpis.totalProducts.toLocaleString()} delta={0} note="in catalog" c={DS.violet} icon="📦" data={monthly} k="orders" />
                        <KpiCard label="Total Customers" value={kpis.totalCustomers.toLocaleString()} delta={0} note="total" c={DS.orange} icon="👥" data={daily} k="rev" />
                        <KpiCard label="Inv. Alerts" value={String(kpis.lowStockCount)} delta={0} note={kpis.lowStockCount > 0 ? "need attention" : "all good"} c={DS.amber} icon="⚠️" data={daily} k="ord" />
                        <KpiCard label="Total Orders" value={kpis.totalOrders.toLocaleString()} delta={0} note="all time" c={DS.emerald} icon="📋" data={daily} k="ord" />
                    </>
                )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                {/* Global Revenue vs Target */}
                <Card accent={DS.sky}>
                    <SH title="Global Revenue vs Target" sub="12M · EUR"
                        right={<button style={{
                            fontSize: 10, color: DS.sky, background: "rgba(56,189,248,0.08)",
                            border: "1px solid rgba(56,189,248,0.2)", borderRadius: 6, padding: "4px 10px"
                        }}>↓ Export Report</button>} />
                    {revenueQ.isLoading ? (
                        <div style={{ ...SHIMMER, height: 220, borderRadius: 8 }} />
                    ) : monthly.length === 0 ? (
                        <div style={{ height: 220, display: "flex", alignItems: "center", justifyContent: "center", color: DS.lo, fontSize: 12 }}>No revenue data yet — sync orders from JTL</div>
                    ) : (
                        <ResponsiveContainer width="100%" height={220}>
                            <ComposedChart data={monthly} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                                <defs>
                                    <linearGradient id="revG" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={DS.sky} stopOpacity={0.35} />
                                        <stop offset="100%" stopColor={DS.sky} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                <XAxis dataKey="month" tick={{ fill: DS.lo, fontSize: 10 }} axisLine={false} tickLine={false} />
                                <YAxis tickFormatter={v => `€${(v / 1000).toFixed(0)}K`} tick={{ fill: DS.lo, fontSize: 10 }}
                                    axisLine={false} tickLine={false} width={42} />
                                <Tooltip content={<ChartTip />} />
                                <Area type="monotone" dataKey="revenue" name="Revenue" stroke={DS.sky}
                                    strokeWidth={2.5} fill="url(#revG)" dot={false} />
                                <Line type="monotone" dataKey="target" name="Target" stroke={DS.amber}
                                    strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    )}
                </Card>

                {/* Revenue by Category */}
                <Card accent={DS.amber}>
                    <SH title="Revenue by Category" sub="Share %" />
                    {catsQ.isLoading ? (
                        <div style={{ ...SHIMMER, height: 200, borderRadius: 8 }} />
                    ) : categories.length === 0 ? (
                        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: DS.lo, fontSize: 12 }}>No category data yet</div>
                    ) : (
                        <>
                            <ResponsiveContainer width="100%" height={145}>
                                <PieChart>
                                    <Pie data={categories} cx="50%" cy="50%" innerRadius={40} outerRadius={64}
                                        paddingAngle={3} dataKey="v" strokeWidth={0}>
                                        {categories.map((c: any, i: number) => <Cell key={i} fill={c.c} />)}
                                    </Pie>
                                    <Tooltip content={<ChartTip />} />
                                </PieChart>
                            </ResponsiveContainer>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                                {categories.map((c: any, i: number) => (
                                    <div key={i} style={{
                                        display: "grid", gridTemplateColumns: "8px 1fr 44px 24px",
                                        alignItems: "center", gap: 7
                                    }}>
                                        <div style={{ width: 7, height: 7, borderRadius: 1.5, background: c.c }} />
                                        <span style={{ fontSize: 10, color: DS.mid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                                        <BarFill v={c.v} max={100} c={c.c} h={3} />
                                        <span style={{ fontSize: 10, color: DS.hi, fontFamily: DS.mono, textAlign: "right" }}>{c.v}%</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </Card>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 }}>
                {/* Top Marketing Campaigns */}
                <Card accent={DS.orange}>
                    <SH title="Top Marketing Campaigns" sub="Google Ads & Meta Ads" />
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                                {["Campaign", "Platform", "Spend", "ROAS"].map((h, i) => (
                                    <th key={i} style={{
                                        textAlign: i > 1 ? "right" : "left", fontSize: 9, color: DS.lo,
                                        letterSpacing: "0.07em", textTransform: "uppercase", padding: "0 7px 10px", fontWeight: 500
                                    }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {(campaignsQ.data ?? []).slice(0, 4).map((c: any, i: number) => (
                                <tr key={i} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)`, transition: "background 0.15s" }}>
                                    <td style={{ padding: "11px 7px", fontSize: 12, color: DS.hi, fontWeight: 500 }}>{c.name}</td>
                                    <td style={{ padding: "11px 7px" }}>
                                        <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 20, background: "rgba(255,255,255,0.06)", color: DS.mid }}>{c.platform}</span>
                                    </td>
                                    <td style={{ padding: "11px 7px", textAlign: "right", fontSize: 12, color: DS.orange, fontFamily: DS.mono, fontWeight: 600 }}>{eur(c.spend)}</td>
                                    <td style={{ padding: "11px 7px", textAlign: "right", fontSize: 12, color: c.roas > 3 ? DS.emerald : DS.amber, fontFamily: DS.mono, fontWeight: 600 }}>{c.roas}x</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>

                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                    {/* Inventory Stock Movements */}
                    <Card accent={DS.violet}>
                        <SH title="Inventory Stock Movements" sub="Incoming vs Outgoing 30D" />
                        <div style={{ height: 160, marginTop: 10 }}>
                            {dailyQ.isLoading ? (
                                <div style={{ ...SHIMMER, height: "100%", borderRadius: 8 }} />
                            ) : daily.length === 0 ? (
                                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: DS.lo, fontSize: 12 }}>No movement data yet</div>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={daily} margin={{ top: 5, right: 0, bottom: 0, left: 0 }}>
                                        <defs>
                                            <linearGradient id="movInG" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor={DS.emerald} stopOpacity={0.3} />
                                                <stop offset="100%" stopColor={DS.emerald} stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="movOutG" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor={DS.sky} stopOpacity={0.3} />
                                                <stop offset="100%" stopColor={DS.sky} stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                        <XAxis dataKey="d" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                                        <YAxis tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={34} />
                                        <Tooltip content={<ChartTip />} />
                                        <Area type="monotone" dataKey="ord" name="Out" stroke={DS.sky} fill="url(#movOutG)" dot={false} />
                                        <Area type="monotone" dataKey="rev" name="In" stroke={DS.emerald} fill="url(#movInG)" dot={false} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </Card>
                </div>
            </div>

            {/* Top Products */}
            <Card accent={DS.emerald}>
                <SH title="Top Products by Revenue" sub="From synced order items" />
                {topProdsQ.isLoading ? (
                    <div style={{ ...SHIMMER, height: 120, borderRadius: 8 }} />
                ) : topProds.length === 0 ? (
                    <div style={{ padding: "28px 0", textAlign: "center", color: DS.lo, fontSize: 12 }}>No product data yet — sync orders from JTL to see top performers</div>
                ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                                {["#", "Product", "Revenue", "Units"].map((h, i) => (
                                    <th key={i} style={{ textAlign: i > 1 ? "right" : "left", fontSize: 9, color: DS.lo, letterSpacing: "0.07em", textTransform: "uppercase", padding: "0 7px 10px", fontWeight: 500 }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {topProds.map((p: any, i: number) => (
                                <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                                    <td style={{ padding: "11px 7px", fontSize: 11, color: DS.lo, fontFamily: DS.mono }}>{p.rank}</td>
                                    <td style={{ padding: "11px 7px", fontSize: 12, color: DS.hi, fontWeight: 500 }}>{p.name}</td>
                                    <td style={{ padding: "11px 7px", textAlign: "right", fontSize: 12, color: DS.sky, fontFamily: DS.mono, fontWeight: 600 }}>{eur(p.rev)}</td>
                                    <td style={{ padding: "11px 7px", textAlign: "right", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{p.units.toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </Card>
        </div>
    );
}
