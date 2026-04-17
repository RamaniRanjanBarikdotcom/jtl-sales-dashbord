"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { ComposedChart, Area, Line, BarChart, Bar, LineChart, PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
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
import type { KpiType } from "@/components/sales/SalesKpiDrawer";

const GaugeChart = dynamic(
    () => import("@/components/charts/echarts/GaugeChart").then((m) => m.GaugeChart),
    { ssr: false, loading: () => <div style={{ height: 180 }} /> },
);
const SalesKpiDrawer = dynamic(
    () => import("@/components/sales/SalesKpiDrawer").then((m) => m.SalesKpiDrawer),
    { ssr: false },
);

type SalesMonthlyPoint = {
    month: string;
    revenue: number;
    orders: number;
    target: number | null;
    margin: number;
    returns: number;
    newCust: number;
};

type SalesDailyPoint = {
    d: number;
    date: string;
    rev: number;
    ord: number;
    returns: number;
};

type SalesChannelPoint = { name: string; v: number; c: string };
type SalesHeatCell = { day: string; v: number };
type RadarPoint = { k: string; cur: number; tgt: number };
type ForecastPoint = {
    label: string;
    rev?: number;
    trendLine?: number;
    forecast?: number;
    bandLow?: number;
    bandSize?: number;
    divider?: boolean;
};

const FORECAST_DAYS = 14;
const CHANNEL_BAR_SIZE = 22;

const HeatCell = ({ v }: { v: number }) => {
    const t = clamp(v / 100, 0, 1);
    return <div title={`${v} orders`} style={{
        flex: 1, height: 18, borderRadius: 3, cursor: "default",
        background: t < 0.05 ? "rgba(255,255,255,0.03)"
            : t < 0.3 ? `linear-gradient(135deg, rgba(56,189,248,${0.08 + t * 0.4}), rgba(99,102,241,${0.06 + t * 0.3}))`
            : `linear-gradient(135deg, rgba(56,189,248,${0.15 + t * 0.75}), rgba(139,92,246,${0.1 + t * 0.5}))`,
        boxShadow: t > 0.5 ? `0 0 ${Math.round(t * 8)}px rgba(56,189,248,${t * 0.3})` : "none",
        transition: "all 0.3s ease",
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
    const kpisQ = useSalesKpis();
    const revenueQ = useSalesRevenue();
    const dailyQ = useSalesDaily();
    const heatmapQ = useSalesHeatmap();
    const channelsQ = useSalesChannels();

    const kpis     = kpisQ.data ?? { totalRevenue: 0, totalOrders: 0, avgOrderValue: 0, avgMargin: 0, revenueTarget: 0, targetPct: 0, returnRate: 0, cancelledOrders: 0, cancelledRevenue: 0, returnedOrders: 0, returnedRevenue: 0, revenueDelta: null, ordersDelta: null, aovDelta: null, marginDelta: null };
    const data     = (revenueQ.data ?? []) as SalesMonthlyPoint[];
    const daily    = (dailyQ.data   ?? []) as SalesDailyPoint[];
    const heatmap  = heatmapQ.data ?? { days: [], cells: [] };
    const channels = channelsQ.data ?? { monthly: [], categories: [], radar: [] };
    const CATS: SalesChannelPoint[] = channels?.categories ?? [];
    // Channel bar uses per-channel categories directly (monthly stacked data not available)
    const CHANNEL_BARS = CATS.map(c => ({ name: c.name, revenue: c.v, fill: c.c }));
    const DAYS7: string[] = heatmap?.days ?? [];
    const HEAT: SalesHeatCell[] = heatmap?.cells ?? [];
    const { session } = useStore();
    const role = session?.role || "viewer";
    const isViewer = role === "viewer";

    // KPI Radar — computed from real KPI values against sensible targets
    const RADAR: RadarPoint[] = useMemo(() => {
        if (!kpis.totalOrders) return [];
        return [
            { k: 'Revenue',  cur: Math.min(100, Math.round(kpis.targetPct || 0)),                                    tgt: 100 },
            { k: 'Margin',   cur: Math.min(100, Math.round((kpis.avgMargin || 0) / 40 * 100)),                       tgt: 100 },
            { k: 'AOV',      cur: Math.min(100, Math.round((kpis.avgOrderValue || 0) / 120 * 100)),                   tgt: 100 },
            { k: 'Returns',  cur: Math.max(0, Math.round(100 - (kpis.returnRate || 0) * 20)),                         tgt: 100 },
            { k: 'Growth',   cur: kpis.ordersDelta != null ? Math.min(100, Math.max(0, 50 + kpis.ordersDelta)) : 50,  tgt: 100 },
        ];
    }, [kpis]);

    // ── Revenue Forecast (linear regression on daily data) ─────────────────────
    const forecast = useMemo(() => {
        if (daily.length < 5) return null;

        // Ordinary least squares over points (x = day index, y = revenue).
        // We derive slope/intercept directly from closed-form sums.
        const n   = daily.length;
        const ys  = daily.map(d => d.rev);
        const sumX  = (n * (n - 1)) / 2;
        const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
        const sumY  = ys.reduce((s, y) => s + y, 0);
        const sumXY = ys.reduce((s, y, i) => s + i * y, 0);
        const denom = n * sumX2 - sumX * sumX;
        const slope     = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
        const intercept = (sumY - slope * sumX) / n;

        // Residual standard error is used to build an uncertainty band.
        const residuals = ys.map((y, i) => y - (intercept + slope * i));
        const sse    = residuals.reduce((s, r) => s + r * r, 0);
        const stdErr = Math.sqrt(sse / Math.max(n - 2, 1));

        // R² — how well the line fits
        const meanY  = sumY / n;
        const sst    = ys.reduce((s, y) => s + (y - meanY) ** 2, 0);
        const rSq    = sst > 0 ? Math.max(0, 1 - sse / sst) : 0;

        const confidence = rSq > 0.65 ? "High" : rSq > 0.35 ? "Medium" : "Low";
        const confColor  = rSq > 0.65 ? DS.emerald : rSq > 0.35 ? DS.amber : DS.rose;

        // Build combined chart dataset of actual + projected horizon.
        const chartData: ForecastPoint[] = daily.map((d, i) => ({
            label:  d.date,
            rev:    d.rev,
            trendLine: Math.max(0, Math.round(intercept + slope * i)),
        }));
        // Today divider label
        chartData[n - 1] = { ...chartData[n - 1], divider: true };

        for (let f = 1; f <= FORECAST_DAYS; f++) {
            const xi  = n - 1 + f;
            const val = Math.max(0, intercept + slope * xi);
            // Widen band the further out we project
            const band = stdErr * (1 + f * 0.12);
            chartData.push({
                label:      `+${f}d`,
                forecast:   Math.round(val),
                bandLow:    Math.max(0, Math.round(val - band)),
                bandSize:   Math.round(band * 2),
            });
        }

        const proj7  = Array.from({ length: 7  }, (_, f) => Math.max(0, intercept + slope * (n + f))).reduce((s, v) => s + v, 0);
        const proj30 = Array.from({ length: 30 }, (_, f) => Math.max(0, intercept + slope * (n + f))).reduce((s, v) => s + v, 0);
        const dailyGrowthPct = meanY > 0 ? (slope / meanY) * 100 : 0;

        return { chartData, slope, proj7, proj30, dailyGrowthPct, rSq, confidence, confColor, dividerLabel: chartData[n - 1]?.label };
    }, [daily]);

    const [drawerType, setDrawerType] = useState<KpiType>(null);
    const [drawerOrderNum, setDrawerOrderNum] = useState("");
    const [drawerSku,      setDrawerSku]      = useState("");
    const isInitialLoading =
        ((kpisQ.isLoading || kpisQ.isPending) && !kpisQ.data) ||
        ((revenueQ.isLoading || revenueQ.isPending) && !revenueQ.data) ||
        ((dailyQ.isLoading || dailyQ.isPending) && !dailyQ.data);

    if (isInitialLoading) {
        const shimmer = {
            background: "linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.08) 40%, rgba(255,255,255,0.03) 100%)",
            backgroundSize: "240% 100%",
            animation: "salesShimmer 1.1s linear infinite",
            border: `1px solid ${DS.border}`,
            borderRadius: 14,
        } as const;
        return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <style>{`@keyframes salesShimmer { 0% { background-position: 200% 0; } 100% { background-position: -40% 0; } }`}</style>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} style={{ ...shimmer, height: 128 }} />
                    ))}
                </div>
                <div style={{ ...shimmer, height: 280 }} />
                <div style={{ ...shimmer, height: 360 }} />
            </div>
        );
    }

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
                <KpiCard label="Total Revenue"   value={eur(kpis.totalRevenue)}            delta={kpis.revenueDelta} note="vs prev period" c={DS.sky}    icon="◈" data={data}  k="revenue" onClick={() => setDrawerType("revenue")} />
                <KpiCard label="Total Orders"    value={kpis.totalOrders.toLocaleString()} delta={kpis.ordersDelta}  note="vs prev period" c={DS.violet} icon="◉" data={data}  k="orders"  onClick={() => setDrawerType("orders")}  />
                <KpiCard label="Avg Order Value" value={eur(kpis.avgOrderValue)}           delta={kpis.aovDelta}     note="vs prev period" c={DS.emerald} icon="◆" data={daily} k="rev"     onClick={() => setDrawerType("aov")}     />
                <KpiCard label="Avg Margin"      value={`${kpis.avgMargin}%`}              delta={kpis.marginDelta}  note="vs prev period" c={DS.amber}  icon="◇" data={data}  k="margin"  masked={isViewer} />
            </div>

            {/* Cancelled & Returned */}
            {(kpis.cancelledOrders > 0 || kpis.returnedOrders > 0) && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                    <KpiCard label="Cancelled Orders"  value={kpis.cancelledOrders.toLocaleString()} delta={null} note="excluded from totals" c={DS.rose}   icon="✕" />
                    <KpiCard label="Cancelled Revenue" value={eur(kpis.cancelledRevenue)}            delta={null} note="not counted in revenue" c={DS.rose}   icon="✕" />
                    <KpiCard label="Returned Orders"   value={kpis.returnedOrders.toLocaleString()}  delta={null} note="included in totals" c="#f59e0b"       icon="↩" />
                    <KpiCard label="Returned Revenue"  value={eur(kpis.returnedRevenue)}             delta={null} note="included in revenue" c="#f59e0b"      icon="↩" />
                </div>
            )}

            {/* Revenue area + Category donut */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                {(() => {
                    const totalRev   = data.reduce((s: number, m: SalesMonthlyPoint) => s + m.revenue, 0);
                    const hasPrior   = data.some((m: SalesMonthlyPoint) => m.target != null && m.target > 0);
                    const totalPrior = hasPrior ? data.reduce((s: number, m: SalesMonthlyPoint) => s + (m.target ?? 0), 0) : 0;
                    const yoyPct     = totalPrior > 0 ? ((totalRev - totalPrior) / totalPrior) * 100 : null;
                    return (
                        <Card accent={DS.sky}>
                            {/* Hero header */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                                <div>
                                    <div style={{ fontSize: 10, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8, fontWeight: 500 }}>
                                        Revenue Trend
                                    </div>
                                    <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                                        <span style={{ fontSize: 32, fontWeight: 800, color: DS.hi, fontFamily: DS.mono, letterSpacing: "-0.03em", lineHeight: 1 }}>
                                            {eur(totalRev)}
                                        </span>
                                        {yoyPct != null && (
                                            <span style={{
                                                fontSize: 12, fontWeight: 700, fontFamily: DS.mono,
                                                color: yoyPct >= 0 ? DS.emerald : DS.rose,
                                                background: yoyPct >= 0 ? "rgba(16,185,129,0.08)" : "rgba(244,63,94,0.08)",
                                                border: `1px solid ${yoyPct >= 0 ? "rgba(16,185,129,0.2)" : "rgba(244,63,94,0.2)"}`,
                                                borderRadius: 20, padding: "3px 10px",
                                            }}>
                                                {yoyPct >= 0 ? "▲ " : "▼ "}{Math.abs(yoyPct).toFixed(1)}% YoY
                                            </span>
                                        )}
                                    </div>
                                    {hasPrior && totalPrior > 0 && (
                                        <div style={{ fontSize: 10, color: DS.lo, marginTop: 6, fontFamily: DS.mono }}>
                                            Prior year: {eur(totalPrior)}
                                        </div>
                                    )}
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                                    <div style={{ display: "flex", gap: 16 }}>
                                        {[
                                            { c: DS.sky, label: "Current", dash: false },
                                            ...(hasPrior ? [{ c: DS.amber, label: "Prior Year", dash: true }] : []),
                                        ].map(l => (
                                            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                <div style={{
                                                    width: 20, height: 0,
                                                    borderTop: l.dash ? `2px dashed ${l.c}` : `2.5px solid ${l.c}`,
                                                    opacity: l.dash ? 0.6 : 1,
                                                    boxShadow: l.dash ? "none" : `0 0 6px ${l.c}44`,
                                                }} />
                                                <span style={{ fontSize: 10, color: DS.mid, fontWeight: 500 }}>{l.label}</span>
                                            </div>
                                        ))}
                                    </div>
                                    {!isViewer && (
                                        <button style={{
                                            fontSize: 9, color: DS.mid, background: "rgba(255,255,255,0.03)",
                                            border: `1px solid ${DS.border}`, borderRadius: 6,
                                            padding: "4px 12px", cursor: "pointer", letterSpacing: "0.05em", textTransform: "uppercase",
                                        }}>Export</button>
                                    )}
                                </div>
                            </div>

                            {/* Chart — bleeds to card edges */}
                            <div style={{ margin: "0 -24px -22px -24px", position: "relative" }}>
                                <ResponsiveContainer width="100%" height={260}>
                                    <ComposedChart data={data} margin={{ top: 8, right: 28, bottom: 16, left: 28 }}>
                                        <defs>
                                            <linearGradient id="revGS" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%"   stopColor={DS.sky} stopOpacity={0.28} />
                                                <stop offset="40%"  stopColor={DS.sky} stopOpacity={0.12} />
                                                <stop offset="70%"  stopColor="#6366f1" stopOpacity={0.06} />
                                                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="revStroke" x1="0" y1="0" x2="1" y2="0">
                                                <stop offset="0%"   stopColor={DS.sky} stopOpacity={0.4} />
                                                <stop offset="30%"  stopColor={DS.sky} stopOpacity={1} />
                                                <stop offset="70%"  stopColor="#818cf8" stopOpacity={0.9} />
                                                <stop offset="100%" stopColor={DS.violet} stopOpacity={0.6} />
                                            </linearGradient>
                                            <linearGradient id="priorStroke" x1="0" y1="0" x2="1" y2="0">
                                                <stop offset="0%"   stopColor={DS.amber} stopOpacity={0.3} />
                                                <stop offset="50%"  stopColor={DS.amber} stopOpacity={0.7} />
                                                <stop offset="100%" stopColor={DS.amber} stopOpacity={0.4} />
                                            </linearGradient>
                                            <filter id="lineGlow">
                                                <feGaussianBlur stdDeviation="4" result="blur" />
                                                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                                            </filter>
                                            <filter id="dotGlow">
                                                <feGaussianBlur stdDeviation="6" result="blur" />
                                                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                                            </filter>
                                        </defs>
                                        <CartesianGrid stroke="rgba(255,255,255,0.025)" vertical={false} strokeDasharray="none" />
                                        <XAxis
                                            dataKey="month"
                                            tick={{ fill: DS.lo, fontSize: 10, fontFamily: DS.mono }}
                                            axisLine={false} tickLine={false}
                                            interval="preserveStartEnd"
                                            dy={6}
                                        />
                                        <YAxis
                                            tickFormatter={v => v >= 1000 ? `€${(v / 1000).toFixed(0)}K` : `€${v}`}
                                            tick={{ fill: "rgba(42,64,96,0.5)", fontSize: 9, fontFamily: DS.mono }}
                                            axisLine={false} tickLine={false} width={48}
                                        />
                                        <Tooltip
                                            cursor={{ stroke: "rgba(56,189,248,0.12)", strokeWidth: 1, strokeDasharray: "4 4" }}
                                            content={({ active, payload, label }) => {
                                                if (!active || !payload?.length) return null;
                                                const rev   = payload.find((p) => p.dataKey === "revenue");
                                                const prior = payload.find((p) => p.dataKey === "target");
                                                const revValue = Number(rev?.value ?? 0);
                                                const priorValue = Number(prior?.value ?? 0);
                                                const diff  = rev && prior?.value != null ? revValue - priorValue : null;
                                                return (
                                                    <div style={{
                                                        background: "rgba(6,13,24,0.92)",
                                                        backdropFilter: "blur(16px) saturate(1.5)",
                                                        border: `1px solid rgba(56,189,248,0.15)`,
                                                        borderRadius: 14, padding: "14px 18px", minWidth: 180,
                                                        boxShadow: "0 16px 48px rgba(0,0,0,0.55), 0 0 1px rgba(56,189,248,0.2), inset 0 1px 0 rgba(255,255,255,0.04)",
                                                    }}>
                                                        <div style={{ fontSize: 13, color: DS.hi, fontWeight: 700, marginBottom: 12, fontFamily: DS.body }}>{String(label ?? "")}</div>
                                                        {rev && (
                                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24, marginBottom: 8 }}>
                                                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: `linear-gradient(135deg, ${DS.sky}, #818cf8)`, boxShadow: `0 0 8px ${DS.sky}55` }} />
                                                                    <span style={{ fontSize: 11, color: DS.mid }}>Revenue</span>
                                                                </div>
                                                                <span style={{ fontSize: 14, color: DS.sky, fontFamily: DS.mono, fontWeight: 700 }}>{eur(revValue)}</span>
                                                            </div>
                                                        )}
                                                        {priorValue > 0 && (
                                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24, marginBottom: 8 }}>
                                                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: DS.amber, opacity: 0.8 }} />
                                                                    <span style={{ fontSize: 11, color: DS.mid }}>Prior Year</span>
                                                                </div>
                                                                <span style={{ fontSize: 14, color: DS.amber, fontFamily: DS.mono, fontWeight: 600 }}>{eur(priorValue)}</span>
                                                            </div>
                                                        )}
                                                        {diff != null && priorValue > 0 && (
                                                            <div style={{
                                                                marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)",
                                                                display: "flex", justifyContent: "space-between", alignItems: "center",
                                                            }}>
                                                                <span style={{ fontSize: 10, color: DS.lo }}>Change</span>
                                                                <span style={{
                                                                    fontSize: 12, fontFamily: DS.mono, fontWeight: 700,
                                                                    color: diff >= 0 ? DS.emerald : DS.rose,
                                                                    background: diff >= 0 ? "rgba(16,185,129,0.1)" : "rgba(244,63,94,0.1)",
                                                                    borderRadius: 12, padding: "2px 8px",
                                                                }}>
                                                                    {diff >= 0 ? "+" : ""}{((diff / priorValue) * 100).toFixed(1)}%
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            }}
                                        />
                                        <Area
                                            type="monotone" dataKey="revenue" name="Revenue"
                                            stroke="url(#revStroke)" strokeWidth={2.5}
                                            fill="url(#revGS)" filter="url(#lineGlow)"
                                            dot={false}
                                            activeDot={{ r: 5, fill: DS.sky, stroke: "#fff", strokeWidth: 2, filter: "url(#dotGlow)" }}
                                        />
                                        {hasPrior && (
                                            <Line
                                                type="monotone" dataKey="target" name="Prior Year"
                                                stroke="url(#priorStroke)" strokeWidth={1.5}
                                                strokeDasharray="6 4" dot={false}
                                                connectNulls={false}
                                                activeDot={{ r: 4, fill: DS.amber, stroke: "#fff", strokeWidth: 1.5 }}
                                            />
                                        )}
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </Card>
                    );
                })()}

                <Card accent={DS.violet}>
                    <SH title="Revenue by Category" sub="Share % · selected period" />
                    {/* Donut with center metric */}
                    <div style={{ position: "relative" }}>
                        <ResponsiveContainer width="100%" height={140}>
                            <PieChart>
                                <defs>
                                    {CATS.map((c, i) => (
                                        <linearGradient key={i} id={`catGrad${i}`} x1="0" y1="0" x2="1" y2="1">
                                            <stop offset="0%" stopColor={c.c} stopOpacity={1} />
                                            <stop offset="100%" stopColor={c.c} stopOpacity={0.65} />
                                        </linearGradient>
                                    ))}
                                    <filter id="pieGlow">
                                        <feGaussianBlur stdDeviation="2" result="blur" />
                                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                                    </filter>
                                </defs>
                                <Pie data={CATS} cx="50%" cy="50%" innerRadius={38} outerRadius={60}
                                    paddingAngle={4} dataKey="v" strokeWidth={0} cornerRadius={3}>
                                    {CATS.map((_c, i) => <Cell key={i} fill={`url(#catGrad${i})`} />)}
                                </Pie>
                                <Tooltip content={<ChartTip />} />
                            </PieChart>
                        </ResponsiveContainer>
                        {/* Center label */}
                        <div style={{
                            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                            textAlign: "center", pointerEvents: "none",
                        }}>
                            <div style={{ fontSize: 18, fontWeight: 800, color: DS.hi, fontFamily: DS.mono, lineHeight: 1 }}>
                                {CATS.length}
                            </div>
                            <div style={{ fontSize: 8, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 2 }}>
                                categories
                            </div>
                        </div>
                    </div>

                    {/* Channel list — scrollable */}
                    <div style={{ maxHeight: 155, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                        {CATS.map((c, i) => (
                            <div key={i} style={{
                                display: "grid", gridTemplateColumns: "10px 1fr 40px 30px", alignItems: "center", gap: 8,
                                padding: "4px 6px", borderRadius: 6,
                                background: i === 0 ? "rgba(255,255,255,0.03)" : "transparent",
                                transition: "background 0.2s",
                            }}>
                                <div style={{ width: 8, height: 8, borderRadius: 2, background: c.c, boxShadow: `0 0 6px ${c.c}33`, flexShrink: 0 }} />
                                <span style={{ fontSize: 10, color: i === 0 ? DS.hi : DS.mid, fontWeight: i === 0 ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                                <BarFill v={c.v} max={100} c={c.c} h={4} />
                                <span style={{ fontSize: 10, color: DS.hi, fontFamily: DS.mono, textAlign: "right", fontWeight: 600 }}>{c.v}%</span>
                            </div>
                        ))}
                    </div>

                    {/* Channel summary footer */}
                    {CATS.length > 0 && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${DS.border}`, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                            {[
                                { label: "Top Channel", value: CATS[0]?.name ?? "—", c: DS.sky },
                                { label: "Top 3 Share", value: `${CATS.slice(0,3).reduce((s,c) => s + c.v, 0)}%`, c: DS.emerald },
                            ].map(s => (
                                <div key={s.label} style={{ background: "rgba(255,255,255,0.025)", borderRadius: 8, padding: "8px 10px" }}>
                                    <div style={{ fontSize: 8, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>{s.label}</div>
                                    <div style={{ fontSize: 12, color: s.c, fontFamily: DS.mono, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.value}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </div>

            {/* Channel bar + Revenue Target Gauge */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                <Card accent={DS.indigo}>
                    <SH title="Revenue Share by Channel" sub="% of total revenue · selected period" />
                    {CHANNEL_BARS.length > 0 ? (
                        <ResponsiveContainer width="100%" height={210}>
                            <BarChart data={CHANNEL_BARS} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }} barSize={CHANNEL_BAR_SIZE}>
                                <defs>
                                    {CHANNEL_BARS.map((c, i) => (
                                        <linearGradient key={i} id={`chGrad${i}`} x1="0" y1="0" x2="1" y2="0">
                                            <stop offset="0%" stopColor={c.fill} stopOpacity={0.85} />
                                            <stop offset="100%" stopColor={c.fill} stopOpacity={0.45} />
                                        </linearGradient>
                                    ))}
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" horizontal={false} />
                                <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fill: DS.lo, fontSize: 9, fontFamily: DS.mono }} axisLine={false} tickLine={false} />
                                <YAxis type="category" dataKey="name" tick={{ fill: DS.mid, fontSize: 10, fontWeight: 500 }} axisLine={false} tickLine={false} width={90} />
                                <Tooltip
                                    cursor={{ fill: "rgba(255,255,255,0.02)" }}
                                    content={({ active, payload }) => {
                                        if (!active || !payload?.length) return null;
                                        const d = payload[0];
                                        const payloadData = d?.payload as { name?: string; fill?: string } | undefined;
                                        return (
                                            <div style={{
                                                background: "rgba(6,13,24,0.92)", backdropFilter: "blur(12px)",
                                                border: `1px solid ${DS.border}`, borderRadius: 10, padding: "10px 14px",
                                                boxShadow: "0 12px 36px rgba(0,0,0,0.5)",
                                            }}>
                                                <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600, marginBottom: 4 }}>{payloadData?.name || "Unknown"}</div>
                                                <div style={{ fontSize: 14, color: payloadData?.fill || DS.sky, fontFamily: DS.mono, fontWeight: 700 }}>{Number(d?.value ?? 0)}%</div>
                                            </div>
                                        );
                                    }}
                                />
                                <Bar dataKey="revenue" name="Share %" radius={[0, 6, 6, 0]}>
                                    {CHANNEL_BARS.map((_c, i) => <Cell key={i} fill={`url(#chGrad${i})`} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ height: 210, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <span style={{ fontSize: 12, color: DS.lo }}>No channel data for this period</span>
                        </div>
                    )}
                </Card>

                <Card accent={DS.lime}>
                    <SH title="Revenue vs Previous Period" sub="Current ÷ Previous period revenue" />
                    <div style={{ height: 190 }}>
                        <GaugeChart val={kpis.targetPct} name="vs Prev" color={DS.lime} />
                    </div>
                    <div style={{
                        display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6,
                        background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: "8px 12px",
                    }}>
                        <div>
                            <div style={{ fontSize: 8, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>Prev Period</div>
                            <div style={{ fontSize: 13, color: DS.hi, fontFamily: DS.mono, fontWeight: 700 }}>{eur(kpis.revenueTarget)}</div>
                        </div>
                        <Pill v={kpis.targetPct - 100} />
                    </div>
                </Card>
            </div>

            {/* Orders bar + Radar + Heatmap */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <Card accent={DS.violet}>
                    <SH title="Daily Orders & Returns" sub="Per-day volume · selected period" />
                    {daily.length > 0 ? (
                        <ResponsiveContainer width="100%" height={195}>
                            <BarChart data={daily} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={1} barSize={daily.length > 60 ? 4 : daily.length > 30 ? 7 : 12}>
                                <defs>
                                    <linearGradient id="ordGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={DS.violet} stopOpacity={0.95} />
                                        <stop offset="100%" stopColor={DS.violet} stopOpacity={0.35} />
                                    </linearGradient>
                                    <linearGradient id="retGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={DS.rose} stopOpacity={0.9} />
                                        <stop offset="100%" stopColor={DS.rose} stopOpacity={0.3} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid stroke="rgba(255,255,255,0.03)" vertical={false} strokeDasharray="none" />
                                <XAxis dataKey="date" tick={{ fill: DS.lo, fontSize: 8, fontFamily: DS.mono }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                                <YAxis tick={{ fill: DS.lo, fontSize: 8, fontFamily: DS.mono }} axisLine={false} tickLine={false} width={32} />
                                <Tooltip
                                    cursor={{ fill: "rgba(255,255,255,0.02)" }}
                                    content={({ active, payload, label }) => {
                                        if (!active || !payload?.length) return null;
                                        return (
                                            <div style={{
                                                background: "rgba(6,13,24,0.92)", backdropFilter: "blur(12px)",
                                                border: `1px solid ${DS.border}`, borderRadius: 10, padding: "10px 14px",
                                                boxShadow: "0 12px 36px rgba(0,0,0,0.5)",
                                            }}>
                                                <div style={{ fontSize: 11, color: DS.hi, fontWeight: 600, marginBottom: 6 }}>{String(label ?? "")}</div>
                                                {payload.map((p, idx) => (
                                                    <div key={`${String(p.dataKey)}-${idx}`} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                                                        <div style={{ width: 6, height: 6, borderRadius: 2, background: p.dataKey === "ord" ? DS.violet : DS.rose }} />
                                                        <span style={{ fontSize: 10, color: DS.mid }}>{p.name}:</span>
                                                        <span style={{ fontSize: 11, color: DS.hi, fontFamily: DS.mono, fontWeight: 600 }}>{Number(p.value ?? 0)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    }}
                                />
                                <Bar dataKey="ord" name="Orders" radius={[4, 4, 0, 0]} fill="url(#ordGrad)" />
                                <Bar dataKey="returns" name="Returns" radius={[4, 4, 0, 0]} fill="url(#retGrad)" />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ height: 195, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <span style={{ fontSize: 12, color: DS.lo }}>No order data for this period</span>
                        </div>
                    )}
                </Card>

                <Card accent={DS.amber}>
                    <SH title="KPI Performance" sub="Score vs target (Revenue·Margin·AOV·Returns·Growth)" />
                    {RADAR.length > 0 ? (
                        <ResponsiveContainer width="100%" height={195}>
                            <RadarChart data={RADAR} margin={{ top: 4, right: 28, bottom: 4, left: 28 }}>
                                <defs>
                                    <linearGradient id="radarFill" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={DS.sky} stopOpacity={0.3} />
                                        <stop offset="100%" stopColor={DS.violet} stopOpacity={0.1} />
                                    </linearGradient>
                                </defs>
                                <PolarGrid stroke="rgba(255,255,255,0.06)" gridType="circle" />
                                <PolarAngleAxis dataKey="k" tick={{ fill: DS.mid, fontSize: 9, fontWeight: 500 }} />
                                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                                <Radar name="Target" dataKey="tgt" stroke={DS.amber} fill={DS.amber} fillOpacity={0.05} strokeWidth={1} strokeDasharray="4 3" />
                                <Radar name="Current" dataKey="cur" stroke={DS.sky} fill="url(#radarFill)" strokeWidth={2.5}
                                    dot={{ r: 3, fill: DS.sky, stroke: "#fff", strokeWidth: 1 }} />
                                <Tooltip
                                    content={({ active, payload }) => {
                                        if (!active || !payload?.length) return null;
                                        const cur = payload.find((p) => p.dataKey === "cur");
                                        const curPayload = cur?.payload as { k?: string } | undefined;
                                        return (
                                            <div style={{
                                                background: "rgba(6,13,24,0.92)", backdropFilter: "blur(12px)",
                                                border: `1px solid ${DS.border}`, borderRadius: 10, padding: "8px 12px",
                                                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                                            }}>
                                                <div style={{ fontSize: 11, color: DS.hi, fontWeight: 600, marginBottom: 4 }}>{curPayload?.k || "KPI"}</div>
                                                <div style={{ fontSize: 13, color: DS.sky, fontFamily: DS.mono, fontWeight: 700 }}>{Number(cur?.value ?? 0)}/100</div>
                                            </div>
                                        );
                                    }}
                                />
                            </RadarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ height: 195, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <span style={{ fontSize: 12, color: DS.lo }}>No data for this period</span>
                        </div>
                    )}
                </Card>

                <Card accent={DS.cyan}>
                    <SH title="Order Volume Heatmap" sub="Hour × Day of Week" />
                    <div style={{ display: "flex", gap: 10 }}>
                        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-around", paddingTop: 4, paddingBottom: 4, minWidth: 30 }}>
                            {DAYS7.map(d => (
                                <span key={d} style={{ fontSize: 9, color: DS.mid, letterSpacing: "0.04em", fontWeight: 500, fontFamily: DS.mono }}>{d}</span>
                            ))}
                        </div>
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                            <div style={{ display: "flex", gap: 2, marginBottom: 3 }}>
                                {Array.from({ length: 24 }, (_, h) => (
                                    <div key={h} style={{ flex: 1, fontSize: 7, color: h % 6 === 0 ? DS.lo : "transparent", textAlign: "center", fontFamily: DS.mono }}>{`${h}h`}</div>
                                ))}
                            </div>
                            {DAYS7.map(day => (
                                <div key={day} style={{ display: "flex", gap: 2 }}>
                                    {HEAT.filter(c => c.day === day).map((c, i) => <HeatCell key={i} v={c.v} />)}
                                </div>
                            ))}
                        </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4, marginTop: 10 }}>
                        <span style={{ fontSize: 8, color: DS.lo, fontFamily: DS.mono }}>Low</span>
                        {[0.06, 0.2, 0.4, 0.6, 0.8, 0.95].map((t, i) => (
                            <div key={i} style={{
                                width: 16, height: 8, borderRadius: 2,
                                background: `linear-gradient(135deg, rgba(56,189,248,${t}), rgba(139,92,246,${t * 0.6}))`,
                            }} />
                        ))}
                        <span style={{ fontSize: 8, color: DS.lo, fontFamily: DS.mono }}>High</span>
                    </div>
                </Card>
            </div>

            {/* Daily line */}
            <Card accent={DS.cyan}>
                <SH title="Daily Revenue" sub="Day-by-day tracking for selected period" />
                <ResponsiveContainer width="100%" height={170}>
                    <ComposedChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                        <defs>
                            <linearGradient id="dailyRevFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={DS.cyan} stopOpacity={0.2} />
                                <stop offset="50%" stopColor={DS.cyan} stopOpacity={0.06} />
                                <stop offset="100%" stopColor={DS.cyan} stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="dailyRevStroke" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stopColor={DS.cyan} stopOpacity={0.5} />
                                <stop offset="40%" stopColor={DS.cyan} stopOpacity={1} />
                                <stop offset="80%" stopColor="#818cf8" stopOpacity={0.8} />
                                <stop offset="100%" stopColor={DS.violet} stopOpacity={0.5} />
                            </linearGradient>
                            <filter id="glowS">
                                <feGaussianBlur stdDeviation="3" result="blur" />
                                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                            </filter>
                        </defs>
                        <CartesianGrid stroke="rgba(255,255,255,0.025)" vertical={false} strokeDasharray="none" />
                        <XAxis dataKey="date" tick={{ fill: DS.lo, fontSize: 8, fontFamily: DS.mono }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                        <YAxis tickFormatter={v => `€${(v / 1000).toFixed(0)}K`} tick={{ fill: DS.lo, fontSize: 8, fontFamily: DS.mono }}
                            axisLine={false} tickLine={false} width={40} />
                        <Tooltip
                            cursor={{ stroke: "rgba(34,211,238,0.12)", strokeWidth: 1, strokeDasharray: "4 4" }}
                            content={({ active, payload, label }) => {
                                if (!active || !payload?.length) return null;
                                return (
                                    <div style={{
                                        background: "rgba(6,13,24,0.92)", backdropFilter: "blur(12px)",
                                        border: `1px solid rgba(34,211,238,0.15)`, borderRadius: 10, padding: "10px 14px",
                                        boxShadow: "0 12px 36px rgba(0,0,0,0.5)",
                                    }}>
                                        <div style={{ fontSize: 11, color: DS.hi, fontWeight: 600, marginBottom: 6 }}>{String(label ?? "")}</div>
                                        <div style={{ fontSize: 14, color: DS.cyan, fontFamily: DS.mono, fontWeight: 700 }}>{eur(Number(payload[0]?.value ?? 0))}</div>
                                    </div>
                                );
                            }}
                        />
                        <Area type="monotone" dataKey="rev" name="Revenue"
                            stroke="url(#dailyRevStroke)" strokeWidth={2}
                            fill="url(#dailyRevFill)" filter="url(#glowS)"
                            dot={false}
                            activeDot={{ r: 4, fill: DS.cyan, stroke: "#fff", strokeWidth: 2 }}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </Card>

            {/* Revenue Forecast */}
            {forecast ? (
                <Card accent={DS.violet}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                        <div>
                            <div style={{ fontSize: 10, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4, fontWeight: 500 }}>Revenue Forecast</div>
                            <div style={{ fontSize: 10, color: DS.lo }}>Linear trend · 14-day projection with confidence band</div>
                        </div>
                        <div style={{
                            display: "flex", alignItems: "center", gap: 8,
                            background: `${forecast.confColor}11`, border: `1px solid ${forecast.confColor}33`,
                            borderRadius: 20, padding: "4px 12px",
                        }}>
                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: forecast.confColor, boxShadow: `0 0 8px ${forecast.confColor}66` }} />
                            <span style={{ fontSize: 10, color: forecast.confColor, fontWeight: 600 }}>{forecast.confidence}</span>
                            <span style={{ fontSize: 9, color: DS.lo, fontFamily: DS.mono }}>R²={forecast.rSq.toFixed(2)}</span>
                        </div>
                    </div>

                    {/* Forecast KPI strip */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 18 }}>
                        {[
                            { label: "Next 7-Day Rev",   value: eur(forecast.proj7),   c: DS.violet, note: "projected" },
                            { label: "Next 30-Day Rev",  value: eur(forecast.proj30),  c: DS.sky,    note: "projected" },
                            { label: "Daily Trend",      value: `${forecast.dailyGrowthPct >= 0 ? "+" : ""}${forecast.dailyGrowthPct.toFixed(2)}%`, c: forecast.dailyGrowthPct >= 0 ? DS.emerald : DS.rose, note: "per day avg" },
                            { label: "Daily Δ Revenue",  value: `${forecast.slope >= 0 ? "+" : ""}${eur(Math.abs(forecast.slope))}`, c: forecast.slope >= 0 ? DS.emerald : DS.rose, note: "slope per day" },
                        ].map(s => (
                            <div key={s.label} style={{
                                background: `${s.c}08`, borderRadius: 10, padding: "10px 14px",
                                borderLeft: `3px solid ${s.c}55`,
                            }}>
                                <div style={{ fontSize: 8, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>{s.label}</div>
                                <div style={{ fontSize: 17, color: s.c, fontFamily: DS.mono, fontWeight: 800, letterSpacing: "-0.02em" }}>{s.value}</div>
                                <div style={{ fontSize: 8, color: DS.lo, marginTop: 3 }}>{s.note}</div>
                            </div>
                        ))}
                    </div>

                    {/* Forecast chart */}
                    <ResponsiveContainer width="100%" height={200}>
                        <ComposedChart data={forecast.chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                            <defs>
                                <linearGradient id="fcActualGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={DS.sky} stopOpacity={0.25} />
                                    <stop offset="60%" stopColor={DS.sky} stopOpacity={0.06} />
                                    <stop offset="100%" stopColor={DS.sky} stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="fcBandGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={DS.violet} stopOpacity={0.2} />
                                    <stop offset="100%" stopColor={DS.violet} stopOpacity={0.05} />
                                </linearGradient>
                                <linearGradient id="fcStroke" x1="0" y1="0" x2="1" y2="0">
                                    <stop offset="0%" stopColor={DS.sky} stopOpacity={0.5} />
                                    <stop offset="50%" stopColor={DS.sky} stopOpacity={1} />
                                    <stop offset="100%" stopColor={DS.sky} stopOpacity={0.7} />
                                </linearGradient>
                                <filter id="fcGlow">
                                    <feGaussianBlur stdDeviation="3" result="blur" />
                                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                                </filter>
                            </defs>
                            <CartesianGrid stroke="rgba(255,255,255,0.025)" vertical={false} strokeDasharray="none" />
                            <XAxis dataKey="label" tick={{ fill: DS.lo, fontSize: 8, fontFamily: DS.mono }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                            <YAxis tickFormatter={v => `€${(v / 1000).toFixed(0)}K`} tick={{ fill: DS.lo, fontSize: 8, fontFamily: DS.mono }} axisLine={false} tickLine={false} width={44} />
                            <Tooltip
                                cursor={{ stroke: "rgba(139,92,246,0.12)", strokeWidth: 1, strokeDasharray: "4 4" }}
                                content={({ active, payload, label }) => {
                                    if (!active || !payload?.length) return null;
                                    const labelText = String(label ?? "");
                                    const isFc = labelText.startsWith("+");
                                    return (
                                        <div style={{
                                            background: "rgba(6,13,24,0.92)", backdropFilter: "blur(12px)",
                                            border: `1px solid rgba(139,92,246,0.15)`, borderRadius: 10, padding: "10px 14px",
                                            boxShadow: "0 12px 36px rgba(0,0,0,0.5)",
                                        }}>
                                            <div style={{ fontSize: 11, color: DS.hi, fontWeight: 600, marginBottom: 6 }}>{isFc ? `Forecast ${labelText}` : labelText}</div>
                                            {payload.map((p, idx) => p.value != null && p.dataKey !== "bandLow" && p.dataKey !== "bandSize" && (
                                                <div key={`${String(p.dataKey)}-${idx}`} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                                                    <div style={{ width: 6, height: 6, borderRadius: 2, background: p.color ?? DS.hi }} />
                                                    <span style={{ fontSize: 10, color: DS.mid }}>{p.name}:</span>
                                                    <span style={{ fontSize: 11, color: DS.hi, fontFamily: DS.mono, fontWeight: 600 }}>{eur(Number(p.value ?? 0))}</span>
                                                </div>
                                            ))}
                                            {isFc && (() => {
                                                const low  = Number(payload.find((p) => p.dataKey === "bandLow")?.value ?? 0);
                                                const size = Number(payload.find((p) => p.dataKey === "bandSize")?.value ?? 0);
                                                return <div style={{ fontSize: 9, color: DS.lo, marginTop: 4, fontFamily: DS.mono }}>Range: {eur(low)} – {eur(low + size)}</div>;
                                            })()}
                                        </div>
                                    );
                                }}
                            />
                            {/* Today divider */}
                            <ReferenceLine x={forecast.dividerLabel} stroke="rgba(139,92,246,0.4)" strokeDasharray="6 4" strokeWidth={1.5}
                                label={{ value: "Today", position: "insideTopRight", fill: DS.violet, fontSize: 9, fontWeight: 600 }} />
                            {/* Actual revenue area */}
                            <Area type="monotone" dataKey="rev" name="Revenue" stroke="url(#fcStroke)" strokeWidth={2} fill="url(#fcActualGrad)" dot={false} connectNulls={false} filter="url(#fcGlow)"
                                activeDot={{ r: 4, fill: DS.sky, stroke: "#fff", strokeWidth: 2 }} />
                            {/* Trend line through actuals */}
                            <Line type="monotone" dataKey="trendLine" name="Trend" stroke={DS.sky} strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.35} dot={false} connectNulls={false} />
                            {/* Confidence band base (invisible stack base) */}
                            <Area type="monotone" dataKey="bandLow" stackId="band" stroke="none" fill="transparent" dot={false} connectNulls={false} legendType="none" />
                            {/* Confidence band fill */}
                            <Area type="monotone" dataKey="bandSize" stackId="band" name="Confidence Band" stroke="none" fill="url(#fcBandGrad)" dot={false} connectNulls={false} />
                            {/* Forecast center line */}
                            <Line type="monotone" dataKey="forecast" name="Forecast" stroke={DS.violet} strokeWidth={2} strokeDasharray="6 3" dot={false} connectNulls={false}
                                activeDot={{ r: 4, fill: DS.violet, stroke: "#fff", strokeWidth: 2 }} />
                        </ComposedChart>
                    </ResponsiveContainer>

                    {/* Legend */}
                    <div style={{ display: "flex", gap: 18, marginTop: 12, flexWrap: "wrap" as const }}>
                        {[
                            { color: DS.sky,    dash: false, label: "Actual Revenue", glow: true },
                            { color: DS.sky,    dash: true,  label: "Trend Line", glow: false },
                            { color: DS.violet, dash: true,  label: "14-Day Forecast", glow: false },
                            { color: DS.violet, dash: false, label: "Confidence Band", opacity: 0.4, glow: false },
                        ].map(l => (
                            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <div style={{
                                    width: 22, height: l.dash ? 0 : 3, borderRadius: 2,
                                    background: l.dash ? "none" : l.color, opacity: l.opacity ?? 1,
                                    borderTop: l.dash ? `2px dashed ${l.color}` : undefined,
                                    boxShadow: l.glow ? `0 0 6px ${l.color}44` : "none",
                                }} />
                                <span style={{ fontSize: 9, color: DS.mid, fontWeight: 500 }}>{l.label}</span>
                            </div>
                        ))}
                    </div>
                </Card>
            ) : null}
        </div>
    );
}
