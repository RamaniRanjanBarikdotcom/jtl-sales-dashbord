"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ComposedChart, Area, Line, BarChart, Bar, LineChart, PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { GaugeChart } from "@/components/charts/echarts/GaugeChart";
import { Card } from "@/components/ui/Card";
import { SectionHeader as SH } from "@/components/ui/SectionHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { BarFill } from "@/components/ui/BarFill";
import { Pill } from "@/components/ui/Pill";
import { ChartTip } from "@/components/charts/recharts/ChartTip";
import { DS } from "@/lib/design-system";
import { clamp, eur } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { useSalesKpis, useSalesRevenue, useSalesDaily, useSalesHeatmap, useSalesChannels } from "@/hooks/useSalesData";
import { SalesKpiDrawer, KpiType } from "@/components/sales/SalesKpiDrawer";

const HeatCell = ({ v }: { v: number }) => {
    const t = clamp(v / 100, 0, 1);
    return <div title={`${v} orders`} style={{
        flex: 1, height: 14, borderRadius: 2, cursor: "default",
        background: t < 0.1 ? "rgba(255,255,255,0.04)" : `rgba(56,189,248,${0.1 + t * 0.85})`,
        transition: "background 0.2s",
    }} />;
};

const CHANNEL_COLORS: Record<string, string> = {
    Direct: DS.sky, Marketplace: DS.violet, Email: DS.emerald, Referral: DS.amber
};

// Inner component that reads URL search params — must be wrapped in Suspense
function SalesSearchParamReader({ setDrawerType, setDrawerOrderNum, setDrawerSku }: {
    setDrawerType: (v: KpiType) => void;
    setDrawerOrderNum: (v: string) => void;
    setDrawerSku: (v: string) => void;
}) {
    const searchParams = useSearchParams();
    useEffect(() => {
        const orderSearch = searchParams.get("orderSearch");
        const skuSearch   = searchParams.get("skuSearch");
        if (orderSearch) { setDrawerOrderNum(orderSearch); setDrawerSku(""); setDrawerType("orders"); }
        else if (skuSearch) { setDrawerSku(skuSearch); setDrawerOrderNum(""); setDrawerType("orders"); }
    }, [searchParams, setDrawerType, setDrawerOrderNum, setDrawerSku]);
    return null;
}

export default function SalesTab() {
    const kpis     = useSalesKpis().data ?? { totalRevenue: 0, totalOrders: 0, avgOrderValue: 0, avgMargin: 0, revenueTarget: 0, targetPct: 0, returnRate: 0 };
    const data     = useSalesRevenue().data ?? [];
    const daily    = useSalesDaily().data   ?? [];
    const heatmap  = useSalesHeatmap().data ?? { days: [], cells: [] };
    const channels = useSalesChannels().data ?? { monthly: [], categories: [], radar: [] };
    const CATS: Array<{ name: string; v: number; c: string }> = channels?.categories ?? [];
    const CHANNELS: any[] = channels?.monthly ?? [];
    const RADAR: any[] = channels?.radar ?? [];
    const DAYS7: string[] = heatmap?.days ?? [];
    const HEAT: Array<{ day: string; v: number }> = heatmap?.cells ?? [];
    const { session } = useStore();
    const role = session?.role || "viewer";
    const isViewer = role === "viewer";

    const [drawerType, setDrawerType] = useState<KpiType>(null);
    const [drawerOrderNum, setDrawerOrderNum] = useState("");
    const [drawerSku,      setDrawerSku]      = useState("");

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Suspense fallback={null}>
                <SalesSearchParamReader
                    setDrawerType={setDrawerType}
                    setDrawerOrderNum={setDrawerOrderNum}
                    setDrawerSku={setDrawerSku}
                />
            </Suspense>
            <SalesKpiDrawer
                type={drawerType}
                onClose={() => { setDrawerType(null); setDrawerOrderNum(""); setDrawerSku(""); }}
                initialOrderNum={drawerOrderNum}
                initialSku={drawerSku}
            />

            {/* KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                <KpiCard label="Total Revenue"  value={eur(kpis.totalRevenue)}              delta={18.4} note="vs last year" c={DS.sky}    icon="◈" data={data}  k="revenue" onClick={() => setDrawerType("revenue")} />
                <KpiCard label="Total Orders"   value={kpis.totalOrders.toLocaleString()}   delta={14.2} note="vs last year" c={DS.violet} icon="◉" data={data}  k="orders"  onClick={() => setDrawerType("orders")}  />
                <KpiCard label="Avg Order Value" value={eur(kpis.avgOrderValue)}            delta={3.7}  note="vs last year" c={DS.emerald} icon="◆" data={daily} k="rev"     onClick={() => setDrawerType("aov")}     />
                <KpiCard label="Avg Margin"     value={`${kpis.avgMargin}%`}                delta={2.1}  note="vs last year" c={DS.amber}  icon="◇" data={data}  k="margin"  masked={isViewer} />
            </div>

            {/* Revenue area + Category donut */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                <Card accent={DS.sky}>
                    <SH title="Revenue vs Target" sub="12M · EUR"
                        right={!isViewer && <button style={{
                            fontSize: 10, color: DS.sky, background: "rgba(56,189,248,0.08)",
                            border: "1px solid rgba(56,189,248,0.2)", borderRadius: 6, padding: "4px 10px"
                        }}>↓ Export</button>} />
                    <ResponsiveContainer width="100%" height={220}>
                        <ComposedChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                            <defs>
                                <linearGradient id="revGS" x1="0" y1="0" x2="0" y2="1">
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
                                strokeWidth={2.5} fill="url(#revGS)" dot={false} />
                            <Line type="monotone" dataKey="target" name="Target" stroke={DS.amber}
                                strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </Card>

                <Card accent={DS.violet}>
                    <SH title="Revenue by Category" sub="Share %" />
                    <ResponsiveContainer width="100%" height={145}>
                        <PieChart>
                            <Pie data={CATS} cx="50%" cy="50%" innerRadius={40} outerRadius={64}
                                paddingAngle={3} dataKey="v" strokeWidth={0}>
                                {CATS.map((c, i) => <Cell key={i} fill={c.c} />)}
                            </Pie>
                            <Tooltip content={<ChartTip />} />
                        </PieChart>
                    </ResponsiveContainer>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                        {CATS.map((c, i) => (
                            <div key={i} style={{ display: "grid", gridTemplateColumns: "8px 1fr 44px 24px", alignItems: "center", gap: 7 }}>
                                <div style={{ width: 7, height: 7, borderRadius: 1.5, background: c.c }} />
                                <span style={{ fontSize: 10, color: DS.mid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                                <BarFill v={c.v} max={100} c={c.c} h={3} />
                                <span style={{ fontSize: 10, color: DS.hi, fontFamily: DS.mono, textAlign: "right" }}>{c.v}%</span>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>

            {/* Channel stacked bar + Revenue Target Gauge */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                <Card accent={DS.indigo}>
                    <SH title="Revenue by Channel" sub="Direct · Marketplace · Email · Referral · 12M" />
                    <ResponsiveContainer width="100%" height={210}>
                        <BarChart data={CHANNELS} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barSize={18}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                            <XAxis dataKey="month" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                            <YAxis tickFormatter={v => `€${(v / 1000).toFixed(0)}K`} tick={{ fill: DS.lo, fontSize: 9 }}
                                axisLine={false} tickLine={false} width={42} />
                            <Tooltip content={<ChartTip />} />
                            <Bar dataKey="Direct"      stackId="a" fill={DS.sky}    radius={[0, 0, 0, 0]} />
                            <Bar dataKey="Marketplace" stackId="a" fill={DS.violet} />
                            <Bar dataKey="Email"       stackId="a" fill={DS.emerald} />
                            <Bar dataKey="Referral"    stackId="a" fill={DS.amber}  radius={[3, 3, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                    <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 10 }}>
                        {(["Direct", "Marketplace", "Email", "Referral"] as const).map(k => (
                            <div key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                <div style={{ width: 8, height: 8, borderRadius: 2, background: CHANNEL_COLORS[k] }} />
                                <span style={{ fontSize: 9, color: DS.mid }}>{k}</span>
                            </div>
                        ))}
                    </div>
                </Card>

                <Card accent={DS.lime}>
                    <SH title="Revenue vs Annual Target" sub="YTD Achievement" />
                    <div style={{ height: 190 }}>
                        <GaugeChart val={kpis.targetPct} name="vs Target" color={DS.lime} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                        <span style={{ fontSize: 10, color: DS.lo }}>Target: {eur(kpis.revenueTarget)}</span>
                        <Pill v={kpis.targetPct - 100} />
                    </div>
                </Card>
            </div>

            {/* Orders bar + Radar + Heatmap */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <Card accent={DS.violet}>
                    <SH title="Orders vs Returns" sub="Monthly volume" />
                    <ResponsiveContainer width="100%" height={190}>
                        <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barGap={4} barSize={14}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                            <XAxis dataKey="month" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={34} />
                            <Tooltip content={<ChartTip />} />
                            <Bar dataKey="orders" name="Orders" radius={[3, 3, 0, 0]}>
                                {data.map((_: any, i: number) => <Cell key={i} fill={`rgba(139,92,246,${0.45 + i * 0.05})`} />)}
                            </Bar>
                            <Bar dataKey="returns" name="Returns" radius={[3, 3, 0, 0]} fill={DS.rose} />
                        </BarChart>
                    </ResponsiveContainer>
                </Card>

                <Card accent={DS.amber}>
                    <SH title="KPI Radar" sub="Current vs Target" />
                    <ResponsiveContainer width="100%" height={190}>
                        <RadarChart data={RADAR} margin={{ top: 0, right: 24, bottom: 0, left: 24 }}>
                            <PolarGrid stroke="rgba(255,255,255,0.07)" />
                            <PolarAngleAxis dataKey="k" tick={{ fill: DS.lo, fontSize: 9 }} />
                            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                            <Radar name="Target" dataKey="tgt" stroke={DS.amber} fill={DS.amber} fillOpacity={0.07} strokeWidth={1} strokeDasharray="4 3" />
                            <Radar name="Current" dataKey="cur" stroke={DS.sky} fill={DS.sky} fillOpacity={0.18} strokeWidth={2} />
                            <Tooltip content={<ChartTip />} />
                        </RadarChart>
                    </ResponsiveContainer>
                </Card>

                <Card accent={DS.cyan}>
                    <SH title="Order Volume Heatmap" sub="Hour × Day of Week" />
                    <div style={{ display: "flex", gap: 10 }}>
                        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-around", paddingTop: 4, paddingBottom: 4, minWidth: 28 }}>
                            {DAYS7.map(d => (
                                <span key={d} style={{ fontSize: 9, color: DS.lo, letterSpacing: "0.04em" }}>{d}</span>
                            ))}
                        </div>
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                            <div style={{ display: "flex", gap: 2, marginBottom: 2 }}>
                                {Array.from({ length: 24 }, (_, h) => (
                                    <div key={h} style={{ flex: 1, fontSize: 7, color: h % 6 === 0 ? DS.lo : "transparent", textAlign: "center" }}>{`${h}h`}</div>
                                ))}
                            </div>
                            {DAYS7.map(day => (
                                <div key={day} style={{ display: "flex", gap: 2 }}>
                                    {HEAT.filter(c => c.day === day).map((c, i) => <HeatCell key={i} v={c.v} />)}
                                </div>
                            ))}
                        </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 5, marginTop: 8 }}>
                        <span style={{ fontSize: 8, color: DS.lo }}>Low</span>
                        {[0.08, 0.25, 0.45, 0.65, 0.85].map((t, i) => (
                            <div key={i} style={{ width: 18, height: 5, borderRadius: 1, background: `rgba(56,189,248,${t})` }} />
                        ))}
                        <span style={{ fontSize: 8, color: DS.lo }}>High</span>
                    </div>
                </Card>
            </div>

            {/* Daily line */}
            <Card accent={DS.cyan}>
                <SH title="Daily Revenue — Last 30 Days" sub="Granular day-by-day tracking" />
                <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={daily} margin={{ top: 4, right: 5, bottom: 0, left: 0 }}>
                        <defs>
                            <filter id="glowS">
                                <feGaussianBlur stdDeviation="2.5" result="blur" />
                                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                            </filter>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                        <XAxis dataKey="d" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={v => `€${(v / 1000).toFixed(0)}K`} tick={{ fill: DS.lo, fontSize: 9 }}
                            axisLine={false} tickLine={false} width={38} />
                        <Tooltip content={<ChartTip />} />
                        <Line type="monotone" dataKey="rev" name="Revenue" stroke={DS.cyan}
                            strokeWidth={2} dot={false} filter="url(#glowS)" />
                    </LineChart>
                </ResponsiveContainer>
            </Card>
        </div>
    );
}
