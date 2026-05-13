"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
    ComposedChart, Area, Line, Bar,
    XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, ReferenceArea, ReferenceLine,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { DS } from "@/lib/design-system";
import { eur, safeFloat, safeInt } from "@/lib/utils";

type ZoomLevel = "year" | "month" | "day";
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ── Data hooks ────────────────────────────────────────────────────────────────

function withQuery(baseUrl: string, extraQuery?: string) {
    if (!extraQuery) return baseUrl;
    const cleaned = extraQuery.replace(/^[?&]+/, "");
    if (!cleaned) return baseUrl;
    return `${baseUrl}&${cleaned}`;
}

function useYearlyData(extraQuery?: string) {
    return useQuery({
        queryKey: ["rev-modal", "yearly", extraQuery ?? ""],
        queryFn: async () => {
            const rows: any[] = (await api.get(withQuery("/sales/revenue?range=ALL", extraQuery))).data?.data ?? [];
            const m: Record<number, { revenue: number; orders: number; prevRevenue: number }> = {};
            for (const r of rows) {
                const y = new Date(r.year_month).getUTCFullYear();
                if (!m[y]) m[y] = { revenue: 0, orders: 0, prevRevenue: 0 };
                m[y].revenue += safeFloat(r.total_revenue);
                m[y].orders  += safeInt(r.total_orders);
                if (r.prev_year_revenue != null) m[y].prevRevenue += safeFloat(r.prev_year_revenue);
            }
            return Object.entries(m).sort((a,b) => +a[0] - +b[0]).map(([y, v]) => ({
                label: y, year: +y,
                revenue: Math.round(v.revenue),
                target:  v.prevRevenue > 0 ? Math.round(v.prevRevenue) : null,
                orders:  v.orders,
            }));
        },
        staleTime: 60_000,
    });
}

function useMonthlyData(year: number | null, extraQuery?: string) {
    return useQuery({
        queryKey: ["rev-modal", "monthly", year, extraQuery ?? ""],
        enabled: year !== null,
        queryFn: async () => {
            const rows: any[] = (await api.get(withQuery(`/sales/revenue?from=${year}-01-01&to=${year}-12-31`, extraQuery))).data?.data ?? [];
            return rows.map((r: any) => {
                const d = new Date(r.year_month);
                const rev = safeFloat(r.total_revenue);
                const prevYear = r.prev_year_revenue != null ? safeFloat(r.prev_year_revenue) : null;
                return { label: MONTH_NAMES[d.getUTCMonth()], year: d.getUTCFullYear(), month: d.getUTCMonth(), revenue: Math.round(rev), target: prevYear !== null ? Math.round(prevYear) : null, orders: safeInt(r.total_orders) };
            });
        },
        staleTime: 60_000,
    });
}

function useDailyData(year: number | null, month: number | null, extraQuery?: string) {
    return useQuery({
        queryKey: ["rev-modal", "daily", year, month, extraQuery ?? ""],
        enabled: year !== null && month !== null,
        queryFn: async () => {
            const m   = String((month ?? 0) + 1).padStart(2, "0");
            const end = String(new Date(year!, (month ?? 0) + 1, 0).getDate()).padStart(2, "0");
            const rows: any[] = (await api.get(withQuery(`/sales/daily?from=${year}-${m}-01&to=${year}-${m}-${end}`, extraQuery))).data?.data ?? [];
            return rows.map((r: any) => {
                const date = String(r.summary_date ?? "").slice(0, 10);
                const rev  = safeFloat(r.total_revenue);
                return { label: date.slice(8, 10), date, revenue: Math.round(rev), target: null, orders: safeInt(r.total_orders) };
            });
        },
        staleTime: 60_000,
    });
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function Tip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    return (
        <div style={{ background: "#0c1526", border: `1px solid ${DS.border}`, borderRadius: 10, padding: "10px 14px", minWidth: 170, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
            <p style={{ margin: "0 0 8px", fontSize: 10, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>{label}</p>
            {payload.map((p: any, i: number) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20, marginTop: 5 }}>
                    <span style={{ fontSize: 11, color: p.color ?? DS.mid }}>{p.name}</span>
                    <span style={{ fontSize: 13, color: DS.hi, fontFamily: DS.mono, fontWeight: 700 }}>
                        {p.dataKey === "orders" ? (p.value ?? 0).toLocaleString() : eur(p.value ?? 0)}
                    </span>
                </div>
            ))}
        </div>
    );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

interface Props {
    open: boolean;
    onClose: () => void;
    initialData: any[];
    extraQuery?: string;
    title?: string;
    subtitle?: string;
}

export function RevenueChartModal({
    open,
    onClose,
    initialData,
    extraQuery,
    title = "Revenue Trend",
    subtitle = "Scroll to zoom · Drag to select range · Click bar to drill down",
}: Props) {
    const [mounted, setMounted] = useState(false);
    const [level,    setLevel]    = useState<ZoomLevel>("year");
    const [selYear,  setSelYear]  = useState<number | null>(null);
    const [selMonth, setSelMonth] = useState<number | null>(null);
    const [zoomL,    setZoomL]    = useState<number | null>(null);
    const [zoomR,    setZoomR]    = useState<number | null>(null);
    const [dragA,    setDragA]    = useState<string | null>(null);
    const [dragB,    setDragB]    = useState<string | null>(null);
    const dragging     = useRef(false);
    const chartWrapRef = useRef<HTMLDivElement>(null);
    // refs so wheel handler always reads latest values without re-registering
    const levelRef    = useRef<ZoomLevel>("year");
    const selYearRef  = useRef<number | null>(null);
    const selMonthRef = useRef<number | null>(null);
    const rawDataRef  = useRef<any[]>([]);
    const zoomLRef    = useRef<number | null>(null);
    const zoomRRef    = useRef<number | null>(null);

    const yearlyQ  = useYearlyData(extraQuery);
    const monthlyQ = useMonthlyData(selYear, extraQuery);
    const dailyQ   = useDailyData(selYear, selMonth, extraQuery);
    const yearlyData = yearlyQ.data ?? [];
    const monthlyData = monthlyQ.data ?? [];

    const rawData: any[] = (() => {
        if (level === "year") {
            // Never expose a synthetic year=0 series; that can break drill-down.
            if (yearlyData.length > 0) return yearlyData;
            return initialData.map((d, i) => {
                const rawLabel = String(d?.month ?? "");
                const maybeYear = Number.parseInt(rawLabel, 10);
                const inferredYear = Number.isFinite(maybeYear) && maybeYear > 1900
                    ? maybeYear
                    : new Date().getUTCFullYear();
                return {
                    label: rawLabel || String(i + 1),
                    year: inferredYear,
                    revenue: d?.revenue ?? 0,
                    target: d?.target ?? 0,
                    orders: d?.orders ?? 0,
                };
            });
        }
        if (level === "month") return monthlyQ.data ?? [];
        return dailyQ.data ?? [];
    })();

    const chartData: any[] = (zoomL === null || zoomR === null)
        ? rawData
        : rawData.slice(Math.min(zoomL, zoomR), Math.max(zoomL, zoomR) + 1);

    const isLoading = (level === "year" && yearlyQ.isLoading)
                   || (level === "month" && monthlyQ.isLoading)
                   || (level === "day"   && dailyQ.isLoading);

    // Keep drill-down state valid when data arrives asynchronously.
    useEffect(() => {
        if (!open || level !== "month") return;
        if (selYear && selYear > 1900) return;
        if (!yearlyData.length) return;
        const fallbackYear = yearlyData[yearlyData.length - 1]?.year;
        if (typeof fallbackYear === "number" && Number.isFinite(fallbackYear)) {
            setSelYear(fallbackYear);
        }
    }, [open, level, selYear, yearlyData]);

    useEffect(() => {
        if (!open || level !== "day") return;
        if (selMonth !== null && selMonth >= 0) return;
        if (!monthlyData.length) return;
        const fallbackMonth = monthlyData[monthlyData.length - 1]?.month;
        if (typeof fallbackMonth === "number" && Number.isFinite(fallbackMonth)) {
            setSelMonth(fallbackMonth);
        }
    }, [open, level, selMonth, monthlyData]);

    // keep refs in sync
    useEffect(() => { levelRef.current    = level;    }, [level]);
    useEffect(() => { selYearRef.current  = selYear;  }, [selYear]);
    useEffect(() => { selMonthRef.current = selMonth; }, [selMonth]);
    useEffect(() => { rawDataRef.current  = rawData;  });
    useEffect(() => { zoomLRef.current    = zoomL;    }, [zoomL]);
    useEffect(() => { zoomRRef.current    = zoomR;    }, [zoomR]);

    const resetZoom = useCallback(() => { setZoomL(null); setZoomR(null); }, []);
    useEffect(() => { resetZoom(); setDragA(null); setDragB(null); }, [level, resetZoom]);
    useEffect(() => {
        if (!open) return;
        const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [open, onClose]);

    const drillToNextLevel = useCallback((lv: ZoomLevel, data: any[], idx: number) => {
        const item = data[idx];
        if (!item) return false;
        if (lv === "year" && typeof item.year === "number" && item.year > 1900) {
            setSelYear(item.year);
            setSelMonth(null);
            setLevel("month");
            return true;
        }
        if (lv === "month" && typeof item.month === "number" && item.month >= 0) {
            setSelMonth(item.month);
            setLevel("day");
            return true;
        }
        return false;
    }, []);

    // ── Continuous scroll-wheel zoom with controlled level transitions ───────
    useEffect(() => {
        if (!open) return;
        const el = chartWrapRef.current;
        if (!el) return;

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const lv    = levelRef.current;
            const data  = rawDataRef.current;
            const total = data.length;
            if (total <= 0) return;
            const curL  = zoomLRef.current ?? 0;
            const curR  = zoomRRef.current ?? total - 1;
            const span  = curR - curL;

            if (e.deltaY > 0) {
                // Zoom in first. When a single bucket remains, next zoom-in drills down.
                if (span <= 1) {
                    drillToNextLevel(lv, data, curL);
                    return;
                }
                const step = Math.max(1, Math.round(span * 0.18));
                const nl = Math.min(curL + step, curR - 1);
                const nr = Math.max(curR - step, curL + 1);
                setZoomL(nl);
                setZoomR(nr);
            } else {
                // ── Zoom OUT ─────────────────────────────────────────────────
                const isFullRange = curL === 0 && curR === total - 1;
                if (isFullRange && zoomLRef.current === null) {
                    // At full extent: go one level up.
                    if (lv === "day") {
                        setLevel("month");
                        setSelMonth(null);
                    } else if (lv === "month") {
                        setLevel("year");
                        setSelYear(null);
                        setSelMonth(null);
                    }
                    return;
                }
                const step = Math.max(1, Math.round(total * 0.18));
                const nl = Math.max(0, curL - step);
                const nr = Math.min(total - 1, curR + step);
                if (nl === 0 && nr === total - 1) {
                    setZoomL(null);
                    setZoomR(null);
                    return;
                }
                setZoomL(nl);
                setZoomR(nr);
            }
        };

        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [open, drillToNextLevel]);

    // ── Click to drill down ───────────────────────────────────────────────────
    const handleClick = useCallback((d: any) => {
        if (dragging.current || dragA || dragB) return;
        const pt = d?.activePayload?.[0]?.payload;
        if (!pt) return;
        if (level === "year" && typeof pt.year === "number" && pt.year > 1900) {
            setSelYear(pt.year); setLevel("month");
        } else if (level === "month" && pt.month !== undefined) {
            setSelMonth(pt.month); setLevel("day");
        }
    }, [level, dragA, dragB]);

    // ── Drag-select zoom ──────────────────────────────────────────────────────
    const onMouseDown = (e: any) => { if (!e?.activeLabel) return; dragging.current = false; setDragA(e.activeLabel); setDragB(null); };
    const onMouseMove = (e: any) => { if (!dragA || !e?.activeLabel) return; dragging.current = true; setDragB(e.activeLabel); };
    const finalizeDragSelection = useCallback(() => {
        if (!dragging.current || !dragA || !dragB) { dragging.current = false; setDragA(null); setDragB(null); return; }
        const labels = rawData.map((d: any) => d.label);
        const li = labels.indexOf(dragA), ri = labels.indexOf(dragB);
        if (li !== -1 && ri !== -1) {
            const left = Math.min(li, ri);
            const right = Math.max(li, ri);
            setZoomL(left);
            setZoomR(right);
            if (left === right) {
                drillToNextLevel(level, rawData, left);
            }
        }
        dragging.current = false; setDragA(null); setDragB(null);
    }, [dragA, dragB, rawData, level, drillToNextLevel]);
    const onMouseUp   = () => finalizeDragSelection();
    const onMouseLeave = () => {
        if (dragging.current || dragA || dragB) {
            finalizeDragSelection();
        }
    };

    useEffect(() => {
        if (!open) return;
        const onWindowMouseUp = () => {
            if (dragging.current || dragA || dragB) {
                finalizeDragSelection();
            }
        };
        window.addEventListener("mouseup", onWindowMouseUp);
        return () => window.removeEventListener("mouseup", onWindowMouseUp);
    }, [open, dragA, dragB, finalizeDragSelection]);

    // ── Zoom buttons ─────────────────────────────────────────────────────────
    const zoomIn = () => {
        const total = rawData.length;
        if (total <= 1) return;
        const curL = zoomL ?? 0;
        const curR = zoomR ?? total - 1;
        if (curR - curL <= 1) {
            drillToNextLevel(level, rawData, curL);
            return;
        }
        const step = Math.max(1, Math.round((curR - curL) * 0.25));
        setZoomL(Math.min(curL + step, curR - 1));
        setZoomR(Math.max(curR - step, curL + 1));
    };
    const zoomOut = () => {
        const total = rawData.length;
        if (zoomL === null) {
            if (level === "day")   { setLevel("month"); }
            if (level === "month") { setLevel("year"); setSelYear(null); setSelMonth(null); }
            return;
        }
        const step = Math.max(1, Math.round(total * 0.2));
        const nl = Math.max(0, zoomL - step), nr = Math.min(total - 1, (zoomR ?? total - 1) + step);
        if (nl === 0 && nr === total - 1) { setZoomL(null); setZoomR(null); }
        else { setZoomL(nl); setZoomR(nr); }
    };

    const setLevelExplicit = (next: ZoomLevel) => {
        if (next === "year") {
            setSelYear(null);
            setSelMonth(null);
            setLevel("year");
            resetZoom();
            return;
        }
        if (next === "month") {
            if (!(selYear && selYear > 1900) && yearlyData.length > 0) {
                const fallbackYear = yearlyData[yearlyData.length - 1]?.year;
                if (typeof fallbackYear === "number" && Number.isFinite(fallbackYear)) {
                    setSelYear(fallbackYear);
                }
            }
            setSelMonth(null);
            setLevel("month");
            resetZoom();
            return;
        }
        setLevel("day");
        resetZoom();
    };

    const breadcrumb = ["All Years", ...(selYear ? [String(selYear)] : []), ...(selMonth !== null ? [MONTH_NAMES[selMonth]] : [])];
    const goBack = (i: number) => {
        if (i === 0) { setLevel("year"); setSelYear(null); setSelMonth(null); }
        else if (i === 1) { setLevel("month"); setSelMonth(null); }
        resetZoom();
    };

    const maxRev  = Math.max(...chartData.map((d: any) => Math.max(d.revenue ?? 0, d.target ?? 0)), 1);
    const isZoomed = zoomL !== null;

    useEffect(() => {
        setMounted(true);
        return () => setMounted(false);
    }, []);

    if (!open || !mounted) return null;

    return createPortal(
        <>
            {/* Backdrop */}
            <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)" }} />

            {/* Modal shell */}
            <div style={{
                position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
                width: "min(1160px, 92vw)", height: "min(700px, 88vh)",
                zIndex: 1210, background: "#080f1e",
                border: `1px solid rgba(56,189,248,0.25)`,
                borderRadius: 18, display: "flex", flexDirection: "column",
                boxShadow: "0 40px 100px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.04)",
                overflow: "hidden",
            }} onClick={(e) => e.stopPropagation()}>

                {/* ── Row 1: Header ─────────────────────────────────────────── */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: `1px solid rgba(255,255,255,0.06)`, flexShrink: 0, background: "rgba(255,255,255,0.015)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 4, height: 22, borderRadius: 3, background: `linear-gradient(180deg, ${DS.sky}, ${DS.violet})` }} />
                        <div>
                            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: DS.hi }}>{title}</h2>
                            <p style={{ margin: "3px 0 0", fontSize: 10, color: DS.lo }}>{subtitle}</p>
                        </div>
                    </div>
                    <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid rgba(255,255,255,0.1)`, background: "rgba(255,255,255,0.04)", color: DS.mid, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                </div>

                {/* ── Row 2: Controls bar ───────────────────────────────────── */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 24px", borderBottom: `1px solid rgba(255,255,255,0.06)`, flexShrink: 0 }}>

                    {/* Breadcrumb */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                        {breadcrumb.map((b, i) => (
                            <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                {i > 0 && <span style={{ color: DS.lo, fontSize: 12, opacity: 0.5 }}>›</span>}
                                <button onClick={() => goBack(i)} disabled={i === breadcrumb.length - 1}
                                    style={{ fontSize: 12, fontWeight: i === breadcrumb.length - 1 ? 700 : 400, color: i === breadcrumb.length - 1 ? DS.hi : DS.sky, background: "none", border: "none", cursor: i === breadcrumb.length - 1 ? "default" : "pointer", padding: 0 }}>
                                    {b}
                                </button>
                            </span>
                        ))}
                    </div>

                    {/* Level pills */}
                    <div style={{ display: "flex", gap: 4 }}>
                        {(["year","month","day"] as ZoomLevel[]).map(l => (
                            <button key={l} onClick={() => setLevelExplicit(l)}
                                style={{ fontSize: 10, padding: "4px 14px", borderRadius: 20, cursor: "pointer", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", transition: "all 0.15s", background: level === l ? `${DS.sky}25` : "transparent", border: `1px solid ${level === l ? DS.sky : "rgba(255,255,255,0.1)"}`, color: level === l ? DS.sky : DS.lo }}>
                                {l}
                            </button>
                        ))}
                    </div>

                    {/* Zoom buttons */}
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <button onClick={zoomIn}  style={zBtn}>＋</button>
                        <button onClick={zoomOut} style={zBtn}>－</button>
                        {isZoomed && <button onClick={resetZoom} style={{ ...zBtn, color: DS.rose, border: `1px solid ${DS.rose}50` }}>Reset</button>}
                    </div>

                    {isZoomed && (
                        <span style={{ fontSize: 10, color: DS.amber, background: `${DS.amber}18`, border: `1px solid ${DS.amber}40`, borderRadius: 20, padding: "3px 10px", whiteSpace: "nowrap" }}>
                            {chartData.length} / {rawData.length}
                        </span>
                    )}
                </div>

                {/* ── Row 3: Chart (takes all remaining space) ──────────────── */}
                <div ref={chartWrapRef} style={{ flex: 1, minHeight: 0, position: "relative", padding: "16px 20px 4px 4px" }}>

                    {isLoading && (
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: DS.lo, fontSize: 13 }}>Loading…</div>
                    )}

                    {!isLoading && chartData.length === 0 && (
                        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: DS.lo, fontSize: 13 }}>No data for this period</div>
                    )}

                    {!isLoading && chartData.length > 0 && (
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
                                onClick={handleClick}
                                onMouseDown={onMouseDown}
                                onMouseMove={onMouseMove}
                                onMouseUp={onMouseUp}
                                onMouseLeave={onMouseLeave}
                                style={{ cursor: level === "day" ? "crosshair" : "pointer", userSelect: "none" }}>
                                <defs>
                                    <linearGradient id="mRevGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%"   stopColor={DS.sky} stopOpacity={0.4} />
                                        <stop offset="100%" stopColor={DS.sky} stopOpacity={0.02} />
                                    </linearGradient>
                                </defs>

                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />

                                <XAxis dataKey="label" tick={{ fill: DS.lo, fontSize: 11 }} axisLine={false} tickLine={false}
                                    interval={chartData.length > 60 ? Math.floor(chartData.length / 28) : chartData.length > 20 ? 1 : 0} />

                                <YAxis yAxisId="rev"
                                    tickFormatter={v => v >= 1_000_000 ? `€${(v/1_000_000).toFixed(1)}M` : v >= 1_000 ? `€${(v/1000).toFixed(0)}K` : `€${v}`}
                                    tick={{ fill: DS.lo, fontSize: 10 }} axisLine={false} tickLine={false} width={58}
                                    domain={[0, Math.ceil(maxRev * 1.15)]} />

                                <YAxis yAxisId="ord" orientation="right"
                                    tick={{ fill: DS.lo, fontSize: 10 }} axisLine={false} tickLine={false} width={40} />

                                <Tooltip content={<Tip />} />

                                {/* Drag selection highlight */}
                                {dragA && dragB && (
                                    <ReferenceArea yAxisId="rev" x1={dragA} x2={dragB} stroke={DS.sky} strokeOpacity={0.5} fill={`${DS.sky}15`} />
                                )}

                                {/* Today line on day view */}
                                {level === "day" && (() => {
                                    const today = new Date().toISOString().slice(0,10);
                                    const hit = chartData.find((d: any) => d.date === today);
                                    return hit ? <ReferenceLine yAxisId="rev" x={hit.label} stroke={DS.emerald} strokeDasharray="4 3" label={{ value: "Today", fill: DS.emerald, fontSize: 10, position: "insideTopRight" }} /> : null;
                                })()}

                                <Area yAxisId="rev" type="monotone" dataKey="revenue" name="Revenue"
                                    stroke={DS.sky} strokeWidth={2.5} fill="url(#mRevGrad)"
                                    dot={chartData.length <= 16 ? { fill: DS.sky, strokeWidth: 0, r: 4 } : false}
                                    activeDot={{ r: 6, fill: DS.sky, strokeWidth: 2, stroke: "#fff" }} />

                                <Line yAxisId="rev" type="monotone" dataKey="target" name="Prior Year"
                                    stroke={DS.violet} strokeWidth={1.5} strokeDasharray="6 4" dot={false}
                                    activeDot={{ r: 5, fill: DS.violet, strokeWidth: 0 }} connectNulls={false} />

                                <Bar yAxisId="ord" dataKey="orders" name="Orders"
                                    fill={`${DS.violet}50`} radius={[3,3,0,0]} maxBarSize={18} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    )}
                </div>

                {/* ── Row 4: Footer legend ──────────────────────────────────── */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 24px", borderTop: `1px solid rgba(255,255,255,0.06)`, flexShrink: 0, background: "rgba(255,255,255,0.015)" }}>
                    <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                        <LegendItem color={DS.sky}    label="Revenue"    type="area" />
                        <LegendItem color={DS.violet} label="Prior Year" type="dash" />
                        <LegendItem color={DS.violet} label="Orders"     type="bar"  />
                    </div>
                    <span style={{ fontSize: 10, color: DS.lo, opacity: 0.7 }}>
                        {level === "year"  && "Click a year to open months · Drag to zoom years · Scroll ↑ to zoom out"}
                        {level === "month" && "Click a month to open days · Drag to zoom months · Scroll ↑ to go back"}
                        {level === "day"   && "Drag to zoom days · Scroll ↑ to go back to months"}
                    </span>
                </div>
            </div>
        </>,
        document.body,
    );
}

function LegendItem({ color, label, type }: { color: string; label: string; type: "area"|"dash"|"bar" }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            {type === "area" && <div style={{ width: 10, height: 10, borderRadius: 2, background: `${color}90` }} />}
            {type === "dash" && <div style={{ width: 18, borderTop: `2px dashed ${color}` }} />}
            {type === "bar"  && <div style={{ width: 8, height: 12, borderRadius: 2, background: `${color}70` }} />}
            <span style={{ fontSize: 11, color: "#94a3b8" }}>{label}</span>
        </div>
    );
}

const zBtn: React.CSSProperties = {
    width: 28, height: 28, borderRadius: 7, cursor: "pointer", fontSize: 14, fontWeight: 700,
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
    color: "#94a3b8", display: "flex", alignItems: "center", justifyContent: "center",
    lineHeight: 1,
};
