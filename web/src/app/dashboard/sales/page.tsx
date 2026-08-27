"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { ComposedChart, Area, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { MouseHandlerDataParam } from "recharts";
import { Card } from "@/components/ui/Card";
import { SectionHeader as SH } from "@/components/ui/SectionHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { BarFill } from "@/components/ui/BarFill";
import { Pill } from "@/components/ui/Pill";
import { ChartTip } from "@/components/charts/recharts/ChartTip";
import { DS } from "@/lib/design-system";
import { clamp, eur } from "@/lib/utils";
import { useFilterStore, useStore, sessionHasPermission } from "@/lib/store";
import { exportSalesCsv } from "@/lib/export";
import { useSalesKpis, useSalesRevenue, useSalesDaily, useSalesHeatmap, useSalesChannels, useSalesPaymentShipping } from "@/hooks/useSalesData";
import type { KpiType } from "@/components/sales/SalesKpiDrawer";
import { CancelledOrdersTrendModal } from "@/components/sales/CancelledOrdersTrendModal";
import { useProductsList } from "@/hooks/useProductsData";
import { SalesOrdersBroadView } from "@/components/analytics/SalesOrdersBroadView";
import type { OrderFilters } from "@/hooks/useSalesData";
import { downloadClientCsv } from "@/lib/csv";

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
    margin: number | null;
    returns: number;
    newCust: number;
};

type SalesDailyPoint = {
    d: number;
    date: string;
    isoDate: string | null;
    rev: number;
    ord: number;
    returns: number;
    cancelledOrders: number;
    cancelledRevenue: number;
};

type SalesChannelPoint = { name: string; v: number; revenue: number; orders: number; c: string };
type SalesHeatCell = { day: string; hour: number; orders: number; revenue: number };
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

const HEAT_COLORS = [
    "rgba(255,255,255,0.03)",
    "rgba(56,189,248,0.18)",
    "rgba(56,189,248,0.32)",
    "rgba(99,102,241,0.45)",
    "rgba(139,92,246,0.62)",
    "rgba(129,140,248,0.78)",
];

const heatLevelLabel = (level: number) =>
    level <= 1 ? "Low"
    : level <= 3 ? "Medium"
    : "High";

export function formatEuroAxis(value: number): string {
    const numeric = Number(value || 0);
    if (Math.abs(numeric) < 1000) return `€${Math.round(numeric)}`;
    if (Math.abs(numeric) < 10000) return `€${(numeric / 1000).toFixed(1)}K`;
    return `€${Math.round(numeric / 1000)}K`;
}

const HeatCell = ({ title, level, onClick }: { title: string; level: number; onClick?: () => void }) => {
    const bg = HEAT_COLORS[Math.max(0, Math.min(level, HEAT_COLORS.length - 1))];
    return <div title={title} style={{
        flex: 1, height: 18, borderRadius: 3, cursor: onClick ? "pointer" : "default",
        background: `linear-gradient(135deg, ${bg}, rgba(20,30,52,0.5))`,
        boxShadow: level >= 4 ? `0 0 ${level + 3}px rgba(129,140,248,0.25)` : "none",
        transition: "all 0.3s ease",
    }} onClick={onClick} role={onClick ? "button" : undefined} />;
};

type BroadSelection = {
    title: string;
    subtitle: string;
    definition: string;
    filters?: Omit<OrderFilters, "page" | "limit" | "enabled" | "sort" | "order">;
};

function DetailAction({ label = "Details", onClick }: { label?: string; onClick: () => void }) {
    return <button onClick={onClick} style={{ fontSize: 9, color: DS.sky, background: `${DS.sky}0c`, border: `1px solid ${DS.sky}38`, borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}>{label} ↗</button>;
}

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
    const [cancelledTrendModalOpen, setCancelledTrendModalOpen] = useState(false);
    const [forecastDetailsOpen, setForecastDetailsOpen] = useState(false);
    const [broadView, setBroadView] = useState<BroadSelection | null>(null);
    const [isSalesExporting, setIsSalesExporting] = useState(false);
    const resetGlobalFilters = useFilterStore((state) => state.resetFilters);
    const kpisQ = useSalesKpis();
    const revenueQ = useSalesRevenue();
    const dailyQ = useSalesDaily();
    const heatmapQ = useSalesHeatmap();
    const channelsQ = useSalesChannels();
    const payShipQ = useSalesPaymentShipping();

    const kpis     = kpisQ.data ?? { totalRevenue: 0, totalOrders: 0, avgOrderValue: 0, avgMargin: null, marginAvailable: false, marginCoveragePct: 0, revenueTarget: null, targetPct: null, returnRate: 0, cancelledOrders: 0, cancelledRevenue: 0, returnedOrders: 0, returnedRevenue: 0, revenueDelta: null, ordersDelta: null, aovDelta: null, marginDelta: null };
    const payShip  = payShipQ.data ?? { payment_methods: [], shipping_methods: [] };
    const data     = (revenueQ.data ?? []) as SalesMonthlyPoint[];
    const daily    = (dailyQ.data   ?? []) as SalesDailyPoint[];
    const heatmap  = heatmapQ.data ?? { days: [], cells: [] };
    const channels = channelsQ.data;
    const CATS: SalesChannelPoint[] = channels?.compactCategories ?? [];
    const ALL_CATS: SalesChannelPoint[] = channels?.categories ?? [];
    const [performanceMode, setPerformanceMode] = useState<"top" | "low" | "no_sales">("top");
    const performanceQ = useProductsList({ page: 1, limit: 12, sort: "total_revenue", order: performanceMode === "top" ? "DESC" : "ASC" });
    const productPerformanceRows = (performanceQ.data?.rows ?? []).filter((row) => performanceMode !== "no_sales" || row.rev === 0);
    const DAYS7: string[] = heatmap?.days ?? [];
    const HEAT: SalesHeatCell[] = heatmap?.cells ?? [];
    const { session } = useStore();
    const role = session?.role || "viewer";
    const isViewer = role === "viewer";
    const canExportSales = sessionHasPermission(session, "sales.export");

    const performanceRows = useMemo(() => {
        const totalWithCancelled = kpis.totalOrders + kpis.cancelledOrders;
        const cancelRate = totalWithCancelled > 0 ? (kpis.cancelledOrders / totalWithCancelled) * 100 : 0;
        return [
            {
                label: "Revenue (Current)",
                value: eur(kpis.totalRevenue),
                note: kpis.revenueDelta != null
                    ? `${kpis.revenueDelta >= 0 ? "+" : ""}${kpis.revenueDelta.toFixed(1)}% vs previous period`
                    : "No previous-period baseline",
            },
            {
                label: "Average Margin",
                value: kpis.marginAvailable && kpis.avgMargin != null ? `${kpis.avgMargin.toFixed(2)}%` : "Unavailable",
                note: kpis.marginAvailable && kpis.marginDelta != null
                    ? `${kpis.marginDelta >= 0 ? "+" : ""}${kpis.marginDelta.toFixed(1)}% vs previous period`
                    : `Cost coverage ${kpis.marginCoveragePct.toFixed(1)}% · 80% required`,
            },
            {
                label: "Average Order Value",
                value: eur(kpis.avgOrderValue),
                note: kpis.aovDelta != null
                    ? `${kpis.aovDelta >= 0 ? "+" : ""}${kpis.aovDelta.toFixed(1)}% vs previous period`
                    : "No previous-period baseline",
            },
            {
                label: "Return Rate",
                value: `${kpis.returnRate.toFixed(2)}%`,
                note: `${kpis.returnedOrders.toLocaleString()} returned orders`,
            },
            {
                label: "Cancel Rate",
                value: `${cancelRate.toFixed(2)}%`,
                note: `${kpis.cancelledOrders.toLocaleString()} cancelled orders`,
            },
        ];
    }, [kpis]);

    const heatMeta = useMemo(() => {
        const values = HEAT.map(c => c.orders).filter(v => v > 0).sort((a, b) => a - b);
        const quantile = (q: number) => {
            if (values.length === 0) return 0;
            const idx = Math.min(values.length - 1, Math.floor((values.length - 1) * q));
            return values[idx];
        };
        const thresholds = [
            quantile(0.20),
            quantile(0.40),
            quantile(0.60),
            quantile(0.80),
            quantile(0.95),
        ];
        const levelFor = (orders: number) => {
            if (orders <= 0) return 0;
            if (orders <= thresholds[0]) return 1;
            if (orders <= thresholds[1]) return 2;
            if (orders <= thresholds[2]) return 3;
            if (orders <= thresholds[3]) return 4;
            if (orders <= thresholds[4]) return 5;
            return 6;
        };

        const cellsWithLevel = HEAT.map((c) => ({ ...c, level: levelFor(c.orders) }));
        const dayTotals = DAYS7.map((day) => ({
            day,
            orders: cellsWithLevel
                .filter((c) => c.day === day)
                .reduce((s, c) => s + c.orders, 0),
        })).sort((a, b) => b.orders - a.orders);
        const peakCell = cellsWithLevel.reduce((best, c) => (c.orders > best.orders ? c : best), {
            day: "",
            hour: 0,
            orders: 0,
            revenue: 0,
            level: 0,
        });
        return {
            cellsWithLevel,
            dayTotals,
            peakCell,
        };
    }, [HEAT, DAYS7]);

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
    const hasSalesError =
        (kpisQ.isError && !kpisQ.data) ||
        (revenueQ.isError && !revenueQ.data) ||
        (dailyQ.isError && !dailyQ.data) ||
        (heatmapQ.isError && !heatmapQ.data) ||
        (channelsQ.isError && !channelsQ.data) ||
        (payShipQ.isError && !payShipQ.data);
    const isInitialLoading =
        ((kpisQ.isLoading || kpisQ.isPending) && !kpisQ.data) ||
        ((revenueQ.isLoading || revenueQ.isPending) && !revenueQ.data) ||
        ((dailyQ.isLoading || dailyQ.isPending) && !dailyQ.data);

    const openDailyPoint = (state: MouseHandlerDataParam) => {
        const index = Number(state.activeIndex);
        const point = Number.isInteger(index) ? daily[index] : undefined;
        if (!point?.isoDate) return;
        setBroadView({
            title: `${point.isoDate} Sales`,
            subtitle: `${point.ord.toLocaleString()} orders · ${eur(point.rev)}`,
            definition: "Underlying orders are restricted to the selected calendar date and current dashboard filters.",
            filters: { from: point.isoDate, to: point.isoDate },
        });
    };

    if (hasSalesError) {
        return (
            <Card accent={DS.rose}>
                <SH title="Sales Data Error" sub="Could not load live sales data from backend." />
                <p style={{ margin: 0, fontSize: 12, color: DS.lo }}>
                    Refresh the page after backend/database is reachable. Dummy fallback data is disabled for this section.
                </p>
            </Card>
        );
    }

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
            <CancelledOrdersTrendModal
                open={cancelledTrendModalOpen}
                onClose={() => setCancelledTrendModalOpen(false)}
            />
            <SalesOrdersBroadView
                open={Boolean(broadView)}
                title={broadView?.title || "Sales Details"}
                subtitle={broadView?.subtitle}
                definition={broadView?.definition || "Underlying sales orders for the current dashboard filters."}
                filters={broadView?.filters}
                canExport={canExportSales}
                onClose={() => setBroadView(null)}
            />
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

            <div className="analytics-module-toolbar">
                <div>
                    <strong>Filtered Sales Dataset</strong>
                    <p>Uses the active period, order status, invoice, platform, channel, and payment filters.</p>
                </div>
                <div className="analytics-header-actions">
                    <button className="analytics-clear-button" onClick={resetGlobalFilters}>Clear all filters</button>
                    {canExportSales && <button className="analytics-download-button" disabled={isSalesExporting} onClick={async () => {
                        try {
                            setIsSalesExporting(true);
                            await exportSalesCsv();
                        } finally {
                            setIsSalesExporting(false);
                        }
                    }}>{isSalesExporting ? "Preparing…" : "Download filtered CSV"}</button>}
                </div>
            </div>

            {/* KPIs */}
            <div className="analytics-kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                <KpiCard label="Total Revenue"   value={eur(kpis.totalRevenue)}            delta={kpis.revenueDelta} note="vs prev period" c={DS.sky}    icon="◈" data={data}  k="revenue" onClick={() => setDrawerType("revenue")} />
                <KpiCard label="Total Orders"    value={kpis.totalOrders.toLocaleString()} delta={kpis.ordersDelta}  note="vs prev period" c={DS.violet} icon="◉" data={data}  k="orders"  onClick={() => setDrawerType("orders")}  />
                <KpiCard label="Avg Order Value" value={eur(kpis.avgOrderValue)}           delta={kpis.aovDelta}     note="vs prev period" c={DS.emerald} icon="◆" data={daily} k="rev"     onClick={() => setDrawerType("aov")}     />
                <KpiCard label="Avg Margin" value={kpis.marginAvailable && kpis.avgMargin != null ? `${kpis.avgMargin}%` : "Unavailable"} delta={kpis.marginDelta} note={kpis.marginAvailable ? "vs prev period" : `cost coverage ${kpis.marginCoveragePct.toFixed(1)}%`} c={DS.amber} icon="◇" data={data} k="margin" masked={isViewer} onClick={() => setDrawerType("margin")} />
            </div>

            {/* Cancelled Orders */}
            {(kpis.cancelledOrders > 0 || kpis.cancelledRevenue > 0) && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
                    <KpiCard
                        label="Cancelled Orders"
                        value={kpis.cancelledOrders.toLocaleString()}
                        delta={null}
                        note="of total orders · click for full view"
                        c={DS.rose}
                        icon="✕"
                        data={daily}
                        k="cancelledOrders"
                        onClick={() => setCancelledTrendModalOpen(true)}
                    />
                    <KpiCard
                        label="Cancelled Revenue"
                        value={eur(kpis.cancelledRevenue)}
                        delta={null}
                        note="lost revenue · click for full view"
                        c={DS.amber}
                        icon="✕"
                        data={daily}
                        k="cancelledRevenue"
                        onClick={() => setCancelledTrendModalOpen(true)}
                    />
                </div>
            )}

            {/* Revenue area + Category donut */}
            <div className="analytics-two-column" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                {(() => {
                    const totalRev   = data.reduce((s: number, m: SalesMonthlyPoint) => s + m.revenue, 0);
                    const hasPrior   = data.some((m: SalesMonthlyPoint) => m.target != null && m.target > 0);
                    const totalPrior = hasPrior ? data.reduce((s: number, m: SalesMonthlyPoint) => s + (m.target ?? 0), 0) : 0;
                    const yoyPct     = totalPrior > 0 ? ((totalRev - totalPrior) / totalPrior) * 100 : null;
                    return (
                        <Card
                            accent={DS.sky}
                            onClick={() => setDrawerType("revenue")}
                            style={{ cursor: "zoom-in" }}
                        >
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
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setDrawerType("revenue"); }}
                                        style={{
                                            marginTop: 8,
                                            fontSize: 10,
                                            color: DS.sky,
                                            background: "rgba(56,189,248,0.08)",
                                            border: "1px solid rgba(56,189,248,0.22)",
                                            borderRadius: 7,
                                            padding: "4px 10px",
                                            cursor: "pointer",
                                            letterSpacing: "0.04em",
                                        }}
                                        aria-label="Open Revenue Trend full-screen view"
                                    >
                                        Open Full View ⤢
                                    </button>
                                    {hasPrior && totalPrior > 0 && (
                                        <div style={{ fontSize: 10, color: DS.lo, marginTop: 6, fontFamily: DS.mono }}>
                                            Prior year: {eur(totalPrior)}
                                        </div>
                                    )}
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
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
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setDrawerType("revenue"); }}
                                            style={{
                                                fontSize: 9, color: DS.sky, background: "rgba(56,189,248,0.08)",
                                                border: "1px solid rgba(56,189,248,0.2)", borderRadius: 6,
                                                padding: "4px 9px", cursor: "pointer", letterSpacing: "0.03em",
                                            }}
                                        >
                                            ⤢ Expand
                                        </button>
                                    </div>
                                    {canExportSales && (
                                        <button
                                            className="analytics-download-button"
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                await exportSalesCsv();
                                            }}
                                            style={{
                                            fontSize: 9, borderRadius: 6,
                                            padding: "4px 12px", letterSpacing: "0.05em", textTransform: "uppercase",
                                        }}
                                        >Download CSV</button>
                                    )}
                                </div>
                            </div>

                            {/* Chart — bleeds to card edges */}
                            <div
                                onClick={() => setDrawerType("revenue")}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        setDrawerType("revenue");
                                    }
                                }}
                                role="button"
                                tabIndex={0}
                                aria-label="Open Revenue Trend full-screen chart"
                                style={{ margin: "0 -24px -22px -24px", position: "relative", cursor: "pointer" }}
                            >
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
                    <SH title="Revenue by Channel" sub="Share % · actual revenue · selected period" right={<DetailAction onClick={() => setBroadView({ title: "Revenue by Channel", subtitle: "All channels for the selected period", definition: "Revenue and order counts are grouped from tenant-scoped orders by normalized sales channel." })} />} />
                    {CATS.length === 0 ? (
                        <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <span style={{ fontSize: 12, color: DS.lo }}>No channel data for this period</span>
                        </div>
                    ) : (
                        <>
                        {/* Donut with center metric */}
                        <div style={{ position: "relative" }}>
                            <ResponsiveContainer width="100%" height={130}>
                                <PieChart>
                                    <defs>
                                        {CATS.map((c, i) => (
                                            <linearGradient key={i} id={`catGrad${i}`} x1="0" y1="0" x2="1" y2="1">
                                                <stop offset="0%" stopColor={c.c} stopOpacity={1} />
                                                <stop offset="100%" stopColor={c.c} stopOpacity={0.65} />
                                            </linearGradient>
                                        ))}
                                    </defs>
                                    <Pie data={CATS} cx="50%" cy="50%" innerRadius={34} outerRadius={54}
                                        paddingAngle={4} dataKey="v" strokeWidth={0} cornerRadius={3}>
                                        {CATS.map((_c, i) => <Cell key={i} fill={`url(#catGrad${i})`} />)}
                                    </Pie>
                                    <Tooltip
                                        content={({ active, payload }) => {
                                            if (!active || !payload?.length) return null;
                                            const d = payload[0]?.payload as SalesChannelPoint;
                                            return (
                                                <div style={{ background: "rgba(6,13,24,0.92)", backdropFilter: "blur(12px)", border: `1px solid ${DS.border}`, borderRadius: 10, padding: "8px 12px" }}>
                                                    <div style={{ fontSize: 11, color: DS.hi, fontWeight: 600, marginBottom: 4 }}>{d.name}</div>
                                                    <div style={{ fontSize: 12, color: d.c, fontFamily: DS.mono, fontWeight: 700 }}>{eur(d.revenue)}</div>
                                                    <div style={{ fontSize: 10, color: DS.lo, fontFamily: DS.mono }}>{d.orders.toLocaleString()} orders · {d.v}%</div>
                                                </div>
                                            );
                                        }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                            <div style={{
                                position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                                textAlign: "center", pointerEvents: "none",
                            }}>
                                <div style={{ fontSize: 16, fontWeight: 800, color: DS.hi, fontFamily: DS.mono, lineHeight: 1 }}>{ALL_CATS.length}</div>
                                <div style={{ fontSize: 8, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 2 }}>channels</div>
                            </div>
                        </div>

                        {/* Channel list with actual revenue */}
                        <div style={{ maxHeight: 140, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5, marginTop: 6 }}>
                            {ALL_CATS.map((c, i) => (
                                <div key={i} onClick={() => setBroadView({ title: `${c.name} Channel`, subtitle: `${eur(c.revenue)} · ${c.orders.toLocaleString()} orders`, definition: "Underlying orders are filtered to the selected normalized sales channel and current dashboard period.", filters: { channel: c.name } })} style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 6px", borderRadius: 6, background: i === 0 ? "rgba(255,255,255,0.03)" : "transparent", cursor: "pointer" }}>
                                    <div style={{ width: 7, height: 7, borderRadius: 2, background: c.c, flexShrink: 0 }} />
                                    <span style={{ fontSize: 10, color: i === 0 ? DS.hi : DS.mid, fontWeight: i === 0 ? 600 : 400, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                                    <span style={{ fontSize: 10, color: DS.lo, fontFamily: DS.mono, flexShrink: 0 }}>{c.orders.toLocaleString()} ord</span>
                                    <span style={{ fontSize: 10, color: DS.hi, fontFamily: DS.mono, fontWeight: 700, flexShrink: 0 }}>{eur(c.revenue)}</span>
                                    <span style={{ fontSize: 9, color: c.c, fontFamily: DS.mono, fontWeight: 600, minWidth: 28, textAlign: "right", flexShrink: 0 }}>{c.v}%</span>
                                </div>
                            ))}
                        </div>
                        </>
                    )}
                </Card>
            </div>

            {/* Product performance + Revenue Target Gauge */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                <Card accent={DS.indigo}>
                    <SH title="Top & Low Performing Products" sub="Real product revenue in the selected period" right={<div style={{ display: "flex", gap: 5 }}>{(["top", "low", "no_sales"] as const).map((mode) => <button key={mode} onClick={() => setPerformanceMode(mode)} style={{ fontSize: 9, borderRadius: 6, padding: "4px 7px", cursor: "pointer", color: performanceMode === mode ? DS.sky : DS.lo, background: performanceMode === mode ? `${DS.sky}12` : "transparent", border: `1px solid ${performanceMode === mode ? DS.sky + "55" : DS.border}` }}>{mode === "no_sales" ? "No sales" : mode === "top" ? "Top" : "Low"}</button>)}</div>} />
                    <div style={{ maxHeight: 225, overflow: "auto" }}>
                        {performanceQ.isLoading ? <div style={{ color: DS.lo, padding: 20 }}>Loading products…</div> : productPerformanceRows.length === 0 ? <div style={{ color: DS.lo, padding: 20 }}>No matching products.</div> : productPerformanceRows.map((product, index) => (
                            <div key={product.id} style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1fr) 90px 72px", gap: 8, alignItems: "center", padding: "8px 4px", borderBottom: `1px solid rgba(255,255,255,.04)` }}>
                                <span style={{ color: DS.lo, fontFamily: DS.mono }}>{index + 1}</span>
                                <div style={{ minWidth: 0 }}><div style={{ color: DS.hi, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>{product.name}</div><div style={{ color: DS.lo, fontSize: 9 }}>{product.article_number || "No SKU"}</div></div>
                                <span style={{ color: DS.sky, fontFamily: DS.mono, textAlign: "right", fontSize: 11 }}>{eur(product.rev)}</span>
                                <span style={{ color: DS.mid, fontFamily: DS.mono, textAlign: "right", fontSize: 10 }}>{product.units.toLocaleString()} units</span>
                            </div>
                        ))}
                    </div>
                </Card>

                <Card accent={DS.lime}>
                    <SH title="Revenue vs Previous Period" sub="Current ÷ Previous period revenue" />
                    {kpis.targetPct === null ? (
                        <div style={{ height: 210, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
                            <span style={{ fontSize: 24, opacity: 0.25 }}>—</span>
                            <span style={{ fontSize: 11, color: DS.lo }}>No previous period data</span>
                        </div>
                    ) : (
                        <>
                            <div style={{ height: 190 }}>
                                <GaugeChart val={kpis.targetPct} name="vs Prev" color={DS.lime} />
                            </div>
                            <div style={{
                                display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6,
                                background: "rgba(255,255,255,0.02)", borderRadius: 8, padding: "8px 12px",
                            }}>
                                <div>
                                    <div style={{ fontSize: 8, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 }}>Prev Period</div>
                                    <div style={{ fontSize: 13, color: DS.hi, fontFamily: DS.mono, fontWeight: 700 }}>{eur(kpis.revenueTarget ?? 0)}</div>
                                </div>
                                <Pill v={kpis.targetPct - 100} />
                            </div>
                        </>
                    )}
                </Card>
            </div>

            {/* Orders bar + KPI performance + Heatmap */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <Card accent={DS.violet}>
                    <SH title="Daily Orders & Returns" sub="Per-day volume · selected period" right={<DetailAction onClick={() => setBroadView({ title: "Daily Orders & Returns", subtitle: "Underlying orders for the selected period", definition: "Daily order and return counts are derived from the filtered order records. The Orders tab exposes the underlying server-paginated data." })} />} />
                    {daily.length > 0 ? (
                        <ResponsiveContainer width="100%" height={195}>
                            <BarChart data={daily} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barGap={1} barSize={daily.length > 60 ? 4 : daily.length > 30 ? 7 : 12} onClick={openDailyPoint} style={{ cursor: "pointer" }}>
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
                    <SH title="KPI Performance" sub="Actual KPI values from backend for selected period" />
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                        {performanceRows.map((m) => (
                            <div key={m.label} style={{ border: `1px solid ${DS.border}`, borderRadius: 8, padding: "8px 10px", background: "rgba(255,255,255,0.02)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontSize: 10, color: DS.mid }}>{m.label}</span>
                                    <span style={{ fontSize: 12, color: DS.hi, fontFamily: DS.mono, fontWeight: 700 }}>{m.value}</span>
                                </div>
                                <div style={{ marginTop: 4, fontSize: 9, color: DS.lo }}>{m.note}</div>
                            </div>
                        ))}
                    </div>
                </Card>

                <Card accent={DS.cyan}>
                    <SH title="Order Frequency Heatmap" sub="Weekday × hour (low to high frequency from real order counts)" right={<DetailAction onClick={() => setBroadView({ title: "Order Frequency", subtitle: "Underlying orders across all weekday and hourly cells", definition: "Heat intensity uses real order counts grouped by JTL modification weekday and hour for the active period." })} />} />
                    <div style={{ marginBottom: 10, fontSize: 10, color: DS.lo, display: "flex", gap: 14, flexWrap: "wrap" as const }}>
                        <span>
                            Peak window:{" "}
                            <span style={{ color: DS.hi, fontFamily: DS.mono }}>
                                {heatMeta.peakCell.day || "—"} {String(heatMeta.peakCell.hour).padStart(2, "0")}:00-{String((heatMeta.peakCell.hour + 1) % 24).padStart(2, "0")}:00
                            </span>
                            {" "}({heatMeta.peakCell.orders.toLocaleString()} orders)
                        </span>
                        <span>
                            Busiest weekday:{" "}
                            <span style={{ color: DS.hi, fontFamily: DS.mono }}>
                                {heatMeta.dayTotals[0]?.day ?? "—"}
                            </span>
                            {" "}({(heatMeta.dayTotals[0]?.orders ?? 0).toLocaleString()} orders)
                        </span>
                    </div>
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
                                    {heatMeta.cellsWithLevel.filter(c => c.day === day).map((c, i) => (
                                        <HeatCell key={i} level={c.level} title={`${day} ${String(c.hour).padStart(2, "0")}:00 - ${String((c.hour + 1) % 24).padStart(2, "0")}:00 · ${c.orders.toLocaleString()} orders · ${eur(c.revenue)} · ${heatLevelLabel(c.level)}`} onClick={() => setBroadView({ title: `${day} ${String(c.hour).padStart(2, "0")}:00 Orders`, subtitle: `${c.orders.toLocaleString()} orders · ${eur(c.revenue)}`, definition: "Underlying orders match the selected weekday and hour in the current dashboard period.", filters: { weekday: day, hour: c.hour } })} />
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4, marginTop: 10 }}>
                        <span style={{ fontSize: 8, color: DS.lo, fontFamily: DS.mono }}>Low</span>
                        {HEAT_COLORS.map((color, i) => (
                            <div key={i} style={{
                                width: 16, height: 8, borderRadius: 2,
                                background: `linear-gradient(135deg, ${color}, rgba(20,30,52,0.5))`,
                            }} />
                        ))}
                        <span style={{ fontSize: 8, color: DS.lo, fontFamily: DS.mono }}>High</span>
                    </div>
                </Card>
            </div>

            {/* Daily line */}
            <Card accent={DS.cyan}>
                <SH title="Daily Revenue" sub="Day-by-day tracking for selected period" right={<DetailAction onClick={() => setBroadView({ title: "Daily Revenue", subtitle: "Underlying orders for the selected period", definition: "Daily revenue is the sum of active order gross revenue grouped by calendar date." })} />} />
                <ResponsiveContainer width="100%" height={170}>
                    <ComposedChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} onClick={openDailyPoint} style={{ cursor: "pointer" }}>
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
                        <YAxis tickFormatter={formatEuroAxis} tick={{ fill: DS.lo, fontSize: 8, fontFamily: DS.mono }}
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
                            dot={daily.length === 1 ? { r: 5, fill: DS.cyan, stroke: "#fff", strokeWidth: 2 } : false}
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
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <DetailAction label={forecastDetailsOpen ? "Hide details" : "Details"} onClick={() => setForecastDetailsOpen((open) => !open)} />
                            {canExportSales && <button onClick={() => downloadClientCsv(
                                `sales-revenue-forecast-${new Date().toISOString().slice(0, 10)}.csv`,
                                ["Period", "Series", "Actual Revenue", "Trend", "Forecast", "Lower Bound", "Upper Bound"],
                                forecast.chartData.map((point) => [
                                    point.label,
                                    point.forecast == null ? "historical" : "forecast",
                                    point.rev ?? "",
                                    point.trendLine ?? "",
                                    point.forecast ?? "",
                                    point.bandLow ?? "",
                                    point.bandLow != null && point.bandSize != null ? point.bandLow + point.bandSize : "",
                                ]),
                                {
                                    model: "ordinary_least_squares",
                                    historical_points: daily.length,
                                    forecast_horizon_days: FORECAST_DAYS,
                                    r_squared: forecast.rSq.toFixed(4),
                                    limitation: "Univariate linear trend; no product or channel forecast claim",
                                    generated_at: new Date().toISOString(),
                                },
                            )} style={{ fontSize: 9, color: DS.violet, background: `${DS.violet}0c`, border: `1px solid ${DS.violet}38`, borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}>Download ↗</button>}
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
                    </div>

                    {forecastDetailsOpen && <div style={{ border: `1px solid ${DS.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 14, background: "rgba(255,255,255,0.02)", display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10 }}>
                        {[
                            ["Historical period", `${daily.length} daily points`],
                            ["Forecast horizon", `${FORECAST_DAYS} days`],
                            ["Model", "Ordinary least squares"],
                            ["Known limitation", "Univariate trend; no causal or product/channel forecast"],
                        ].map(([label, value]) => <div key={label}><div style={{ color: DS.lo, fontSize: 8, textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</div><div style={{ color: DS.mid, fontSize: 10, marginTop: 5 }}>{value}</div></div>)}
                    </div>}

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

            {/* Payment Methods & Shipping Methods */}
            {(payShip.payment_methods.length > 0 || payShip.shipping_methods.length > 0) && (() => {
                const PAY_COLORS  = [DS.sky, DS.violet, DS.emerald, DS.amber, DS.cyan, DS.rose, "#e879f9", "#a3e635"];
                const SHIP_COLORS = [DS.indigo, DS.sky, DS.lime, DS.amber, DS.violet, DS.emerald, DS.rose, DS.cyan];
                const maxPayRev   = payShip.payment_methods[0]?.revenue  ?? 1;
                const maxShipRev  = payShip.shipping_methods[0]?.revenue ?? 1;

                const MethodRow = ({ label, orders, revenue, share_pct, color, maxRev, extra, onClick }: {
                    label: string; orders: number; revenue: number; share_pct: number;
                    color: string; maxRev: number; extra?: string; onClick?: () => void;
                }) => (
                    <div onClick={onClick} style={{ marginBottom: 10, cursor: onClick ? "pointer" : "default", borderRadius: 7, padding: "3px 4px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                <div style={{ width: 8, height: 8, borderRadius: 2, background: color, boxShadow: `0 0 5px ${color}55`, flexShrink: 0 }} />
                                <span style={{ fontSize: 11, color: DS.hi, fontWeight: 500, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                            </div>
                            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                                <span style={{ fontSize: 10, color: DS.lo, fontFamily: DS.mono }}>{orders.toLocaleString()} orders</span>
                                <span style={{ fontSize: 11, color: DS.hi, fontFamily: DS.mono, fontWeight: 700 }}>{eur(revenue)}</span>
                                <span style={{ fontSize: 10, color, fontFamily: DS.mono, fontWeight: 600, minWidth: 36, textAlign: "right" }}>{share_pct}%</span>
                            </div>
                        </div>
                        <div style={{ height: 5, background: "rgba(255,255,255,0.04)", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{
                                height: "100%", borderRadius: 3, transition: "width .4s ease",
                                width: `${Math.max(2, (revenue / maxRev) * 100)}%`,
                                background: `linear-gradient(90deg, ${color}cc, ${color}66)`,
                                boxShadow: `0 0 6px ${color}44`,
                            }} />
                        </div>
                        {extra && <div style={{ fontSize: 9, color: DS.lo, marginTop: 3, fontFamily: DS.mono }}>{extra}</div>}
                    </div>
                );

                return (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <Card accent={DS.sky}>
                            <SH title="Payment Methods" sub={`${payShip.payment_methods.length} methods · revenue share · selected period`} right={<DetailAction onClick={() => setBroadView({ title: "Payment Methods", subtitle: "All payment methods in the selected period", definition: "Payment methods are normalized from JTL order payment values and aggregated by revenue and order count." })} />} />
                            <div style={{ marginTop: 12 }}>
                                {payShip.payment_methods.map((m, i) => (
                                    <MethodRow key={m.label} label={m.label} orders={m.orders} revenue={m.revenue}
                                        share_pct={m.share_pct} color={PAY_COLORS[i % PAY_COLORS.length]} maxRev={maxPayRev}
                                        onClick={() => setBroadView({ title: `${m.label} Payments`, subtitle: `${m.orders.toLocaleString()} orders · ${eur(m.revenue)}`, definition: "Underlying orders are filtered to the selected normalized payment method and active dashboard filters.", filters: { paymentMethod: m.label } })} />
                                ))}
                                {payShip.payment_methods.length === 0 && (
                                    <div style={{ color: DS.lo, fontSize: 12, padding: "12px 0" }}>No payment data for this period</div>
                                )}
                            </div>
                        </Card>

                        <Card accent={DS.indigo}>
                            <SH title="Shipping Methods" sub={`${payShip.shipping_methods.length} methods · revenue share & avg cost · selected period`} right={<DetailAction onClick={() => setBroadView({ title: "Shipping Methods", subtitle: "All shipping methods in the selected period", definition: "Shipping methods are normalized from JTL order shipping values and aggregated by revenue, orders, and available shipping cost." })} />} />
                            <div style={{ marginTop: 12 }}>
                                {payShip.shipping_methods.map((m, i) => (
                                    <MethodRow key={m.label} label={m.label} orders={m.orders} revenue={m.revenue}
                                        share_pct={m.share_pct} color={SHIP_COLORS[i % SHIP_COLORS.length]} maxRev={maxShipRev}
                                        extra={m.avg_shipping_cost > 0 ? `Ø shipping cost ${eur(m.avg_shipping_cost)}` : undefined}
                                        onClick={() => setBroadView({ title: `${m.label} Shipping`, subtitle: `${m.orders.toLocaleString()} orders · ${eur(m.revenue)}`, definition: "Underlying orders are filtered to the selected normalized shipping method and active dashboard filters.", filters: { shippingMethod: m.label } })} />
                                ))}
                                {payShip.shipping_methods.length === 0 && (
                                    <div style={{ color: DS.lo, fontSize: 12, padding: "12px 0" }}>No shipping data for this period</div>
                                )}
                            </div>
                        </Card>
                    </div>
                );
            })()}
        </div>
    );
}
