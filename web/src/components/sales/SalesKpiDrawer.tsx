"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import {
    AreaChart, Area, LineChart, Line,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Brush,
} from "recharts";
import {
    useSalesOrders,
    useSalesDailyWithFilters,
    useSalesKpisWithFilters,
    useSalesRevenueWithFilters,
    useRegionalData,
    useSalesPaymentShipping,
    OrderFilters,
    OrderRow,
} from "@/hooks/useSalesData";
import { ChartTip } from "@/components/charts/recharts/ChartTip";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import { useRevenueTrend, type RevenueTrendGranularity } from "@/hooks/useRevenueTrend";
import { useOrdersTrend } from "@/hooks/useOrdersTrend";
import { RevenueTrendChart } from "@/components/overview/revenue-trend/RevenueTrendChart";
import { OrdersTrendChart } from "@/components/overview/orders-trend/OrdersTrendChart";

export type KpiType = "revenue" | "orders" | "aov" | "margin" | null;

const STATUS_COLOR: Record<string, string> = {
    completed:  DS.emerald,
    shipped:    DS.sky,
    processing: DS.amber,
    cancelled:  DS.rose,
    returned:   DS.rose,
};

const ACCENT: Record<Exclude<KpiType, null>, string> = {
    revenue: DS.sky,
    orders:  DS.violet,
    aov:     DS.emerald,
    margin:  DS.amber,
};

const TITLE: Record<Exclude<KpiType, null>, string> = {
    revenue: "Revenue Full View",
    orders:  "Orders Detail",
    aov:     "Avg Order Value Detail",
    margin:  "Avg Margin Detail",
};

type RevenueDrillState = {
    granularity: RevenueTrendGranularity;
    from: string;
    to: string;
};

function monthBounds(dateIso: string): { from: string; to: string } {
    const [yRaw, mRaw] = dateIso.split("-");
    const y = Number.parseInt(yRaw, 10);
    const m = Number.parseInt(mRaw, 10);
    const first = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
    const lastDate = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const last = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(lastDate).padStart(2, "0")}`;
    return { from: first, to: last };
}

function daysBetweenIso(from: string, to: string): number {
    const start = new Date(`${from}T00:00:00Z`).getTime();
    const end = new Date(`${to}T00:00:00Z`).getTime();
    return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function chooseRevenueGranularity(from: string, to: string): RevenueTrendGranularity {
    const days = daysBetweenIso(from, to);
    if (days > 540) return "year";
    if (days > 62) return "month";
    return "day";
}

function normalizeRevenueRangeByGranularity(range: { from: string; to: string }, granularity: RevenueTrendGranularity) {
    if (granularity === "day") return range;
    if (granularity === "month") {
        const fromBounds = monthBounds(range.from);
        const toBounds = monthBounds(range.to);
        return { from: fromBounds.from, to: toBounds.to };
    }
    const fromYear = range.from.slice(0, 4);
    const toYear = range.to.slice(0, 4);
    return { from: `${fromYear}-01-01`, to: `${toYear}-12-31` };
}

function getRevenueVisibleRangeFromZoom(start: number, end: number, points: Array<{ periodStart: string; periodEnd: string }>) {
    if (points.length === 0) return null;
    const max = points.length - 1;
    const startIndex = Math.max(0, Math.min(max, Math.floor((start / 100) * max)));
    const endIndex = Math.max(startIndex, Math.min(max, Math.ceil((end / 100) * max)));
    const from = points[startIndex]?.periodStart;
    const to = points[endIndex]?.periodEnd;
    if (!from || !to) return null;
    return { from, to };
}

function formatMonthYear(dateIso: string): string {
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const [y, m] = dateIso.split("-");
    const monthIndex = Number.parseInt(m, 10) - 1;
    if (monthIndex < 0 || monthIndex > 11) return dateIso;
    return `${names[monthIndex]} ${y}`;
}

function revenueBreadcrumbLabel(state: RevenueDrillState): string {
    if (state.granularity === "year") return "All Years";
    if (state.granularity === "month") {
        const fromYear = state.from.slice(0, 4);
        const toYear = state.to.slice(0, 4);
        return fromYear === toYear ? fromYear : `${fromYear} - ${toYear}`;
    }
    const fromLabel = formatMonthYear(state.from);
    if (state.from.slice(0, 7) === state.to.slice(0, 7)) return fromLabel;
    return `${fromLabel} to ${formatMonthYear(state.to)}`;
}

function exportCsv(filename: string, header: string[], rows: Array<Array<string | number>>) {
    const csv = [header, ...rows]
        .map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
        .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/* ── date input ─────────────────────────────────────────────────────────── */
function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
            <span style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
            <input
                type="date"
                value={value}
                onChange={e => onChange(e.target.value)}
                style={{
                    padding: "7px 10px",
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${DS.border}`,
                    borderRadius: 8, color: DS.hi, fontSize: 12,
                    outline: "none", fontFamily: DS.mono,
                    colorScheme: "dark", width: "100%", boxSizing: "border-box" as const,
                }}
            />
        </div>
    );
}

/* ── text search input ──────────────────────────────────────────────────── */
function SearchInput({ placeholder, value, onChange, onEnter, icon }: {
    placeholder: string; value: string;
    onChange: (v: string) => void; onEnter: () => void; icon: string;
}) {
    return (
        <div style={{ position: "relative", flex: 1 }}>
            <span style={{
                position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
                fontSize: 13, color: DS.lo, pointerEvents: "none" as const,
            }}>{icon}</span>
            <input
                value={value}
                onChange={e => onChange(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") onEnter(); }}
                placeholder={placeholder}
                style={{
                    width: "100%", boxSizing: "border-box" as const,
                    padding: "8px 10px 8px 30px",
                    background: "rgba(255,255,255,0.04)",
                    border: `1px solid ${DS.border}`,
                    borderRadius: 8, color: DS.hi, fontSize: 12,
                    outline: "none", fontFamily: DS.body,
                }}
            />
        </div>
    );
}

/* ── main component ─────────────────────────────────────────────────────── */
export function SalesKpiDrawer({
    type, onClose, initialOrderNum = "", initialSku = "",
}: {
    type: KpiType;
    onClose: () => void;
    initialOrderNum?: string;
    initialSku?: string;
}) {
    const open   = type !== null;
    const accent = type ? ACCENT[type] : DS.sky;
    const isRevenue = type === "revenue";
    const isOrders = type === "orders";
    const isAov = type === "aov";
    const isOrdersLike = isOrders || isAov;
    const isDrillMode = isRevenue || isOrdersLike;
    const [viewportWidth, setViewportWidth] = useState(1600);
    const [mounted, setMounted] = useState(false);
    const isNarrow = viewportWidth < 1520;
    const isMobile = viewportWidth < 1080;
    const trendChartHeight = isMobile ? 270 : (viewportWidth < 1400 ? 320 : 360);
    const shouldStackDetails = isNarrow || (isDrillMode && viewportWidth < 1780);

    // raw input state — initialised from props when provided
    const [dateFrom,  setDateFrom]  = useState("");
    const [dateTo,    setDateTo]    = useState("");
    const [orderNum,  setOrderNum]  = useState(initialOrderNum);
    const [sku,       setSku]       = useState(initialSku);
    const [page,      setPage]      = useState(1);
    const [geoDimension, setGeoDimension] = useState<"country" | "region" | "city">("country");
    const [geoLocation, setGeoLocation] = useState("all");
    const [productMode, setProductMode] = useState<"top" | "least">("top");
    const [routeMode, setRouteMode] = useState<"top" | "least">("top");
    const [revenueGranularity, setRevenueGranularity] = useState<RevenueTrendGranularity>("year");
    const [revenueDrillHistory, setRevenueDrillHistory] = useState<RevenueDrillState[]>([]);
    const [revenueDrillRange, setRevenueDrillRange] = useState<{ from: string; to: string } | null>(null);
    const [ordersGranularity, setOrdersGranularity] = useState<RevenueTrendGranularity>("year");
    const [ordersDrillHistory, setOrdersDrillHistory] = useState<RevenueDrillState[]>([]);
    const [ordersDrillRange, setOrdersDrillRange] = useState<{ from: string; to: string } | null>(null);
    const [chartWindow, setChartWindow] = useState<{ start: number; end: number } | null>(null);

    // applied filter state (sent to API / used for client-side filter)
    const [applied, setApplied] = useState<OrderFilters>({
        orderNumber: initialOrderNum || undefined,
        sku:         initialSku      || undefined,
    });

    // debounce refs for text inputs
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const revenueZoomDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const ordersZoomDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const buildFilters = useCallback((): OrderFilters => ({
        from:        dateFrom || undefined,
        to:          dateTo   || undefined,
        orderNumber: orderNum || undefined,
        sku:         sku      || undefined,
    }), [dateFrom, dateTo, orderNum, sku]);

    const defaultRevenueFrom = applied.from || "2000-01-01";
    const defaultRevenueTo = applied.to || new Date().toISOString().slice(0, 10);
    const revenueScopeFrom = revenueDrillRange?.from || defaultRevenueFrom;
    const revenueScopeTo = revenueDrillRange?.to || defaultRevenueTo;
    const ordersScopeFrom = ordersDrillRange?.from || defaultRevenueFrom;
    const ordersScopeTo = ordersDrillRange?.to || defaultRevenueTo;
    const scopedFrom = isRevenue ? revenueScopeFrom : (isOrdersLike ? ordersScopeFrom : applied.from);
    const scopedTo = isRevenue ? revenueScopeTo : (isOrdersLike ? ordersScopeTo : applied.to);

    // date changes → apply immediately
    useEffect(() => {
        setPage(1);
        setApplied(f => ({ ...f, from: dateFrom || undefined, to: dateTo || undefined }));
    }, [dateFrom, dateTo]);

    useEffect(() => {
        if (!open || !isRevenue) return;
        setRevenueGranularity("year");
        setRevenueDrillHistory([]);
        setRevenueDrillRange(null);
    }, [open, isRevenue, applied.from, applied.to]);

    useEffect(() => {
        if (!open || !isOrdersLike) return;
        setOrdersGranularity("year");
        setOrdersDrillHistory([]);
        setOrdersDrillRange(null);
    }, [open, isOrdersLike, applied.from, applied.to]);

    // text inputs → debounce 400ms
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setPage(1);
            setApplied(f => ({ ...f, orderNumber: orderNum || undefined, sku: sku || undefined }));
        }, 400);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [orderNum, sku]);

    const applyNow = useCallback(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        setPage(1);
        setApplied(buildFilters());
    }, [buildFilters]);

    const reset = useCallback(() => {
        setDateFrom(""); setDateTo(""); setOrderNum(""); setSku("");
        setGeoDimension("country");
        setGeoLocation("all");
        setProductMode("top");
        setRouteMode("top");
        setRevenueGranularity("year");
        setRevenueDrillHistory([]);
        setRevenueDrillRange(null);
        setOrdersGranularity("year");
        setOrdersDrillHistory([]);
        setOrdersDrillRange(null);
        setPage(1); setApplied({});
    }, []);

    // when new search values arrive from URL params, update state immediately
    useEffect(() => {
        if (initialOrderNum) { setOrderNum(initialOrderNum); setApplied(f => ({ ...f, orderNumber: initialOrderNum })); }
        if (initialSku)      { setSku(initialSku);           setApplied(f => ({ ...f, sku: initialSku })); }
    }, [initialOrderNum, initialSku]);

    // reset when modal closes
    useEffect(() => { if (!open) reset(); }, [open, reset]);

    // Esc key
    useEffect(() => {
        if (!open) return;
        const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [onClose, open]);

    // Lock page scroll only while modal is open.
    useEffect(() => {
        if (!open) return;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = prevOverflow;
        };
    }, [open]);

    useEffect(() => {
        const handleResize = () => setViewportWidth(window.innerWidth);
        handleResize();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => {
        setMounted(true);
        return () => {
            setMounted(false);
            if (revenueZoomDebounceRef.current) clearTimeout(revenueZoomDebounceRef.current);
            if (ordersZoomDebounceRef.current) clearTimeout(ordersZoomDebounceRef.current);
        };
    }, []);

    // data
    const hasTextFilter = !!(applied.orderNumber || applied.sku);
    const ordersQ   = useSalesOrders({
        ...applied,
        ...(isRevenue ? { from: revenueScopeFrom, to: revenueScopeTo } : {}),
        ...(isOrdersLike ? { from: ordersScopeFrom, to: ordersScopeTo } : {}),
        page,
        limit: 30,
        enabled: open,
    });
    const dailyQ    = useSalesDailyWithFilters({ from: scopedFrom, to: scopedTo });
    const kpisQ     = useSalesKpisWithFilters({ from: scopedFrom, to: scopedTo });
    const revenueQ  = useSalesRevenueWithFilters({ from: scopedFrom, to: scopedTo });
    const regionalQ = useRegionalData(
        { locationDimension: geoDimension, location: geoLocation, from: applied.from, to: applied.to },
        open && type === "revenue",
    );
    const payShipQ  = useSalesPaymentShipping(
        { from: applied.from, to: applied.to },
        open && type === "revenue",
    );
    const revenueTrendQ = useRevenueTrend(
        {
            from: revenueScopeFrom,
            to: revenueScopeTo,
            granularity: revenueGranularity,
            compare: "prior_year",
        },
        open && type === "revenue",
    );
    const ordersTrendQ = useOrdersTrend(
        {
            from: ordersScopeFrom,
            to: ordersScopeTo,
            granularity: ordersGranularity,
            compare: "prior_year",
        },
        open && isOrdersLike,
    );
    const allOrders   = ordersQ.data?.rows          ?? [];
    const total       = ordersQ.data?.total         ?? 0;
    const totalRevenue = ordersQ.data?.total_revenue ?? 0;
    const avgMarginAll = ordersQ.data?.avg_margin    ?? 0;
    const kpis        = kpisQ.data;
    const daily        = dailyQ.data ?? [];
    const revenueSeries = revenueQ.data ?? [];
    const totalPages   = Math.max(1, Math.ceil(total / 30));

    // Keep records strictly backend-driven for accuracy.
    const orders: OrderRow[] = allOrders;

    // chart series — longer real history + zoom window
    const chartData = daily.slice(-365).map(d => ({
        label: d.date || `D${d.d}`,
        rev:   d.rev,
        ord:   d.ord,
        aov:   d.ord > 0 ? Math.round(d.rev / d.ord) : 0,
    }));
    const revenueTrendChartData = (revenueTrendQ.data?.points ?? []).map((p) => ({
        label: p.label,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        rev: Number(p.revenue || 0),
        ord: Number(p.orders || 0),
        aov: Number(p.averageOrderValue || 0),
        priorRev: Number(p.priorRevenue || 0),
        yoy: p.changePercent,
    }));
    const ordersTrendChartData = (ordersTrendQ.data?.points ?? []).map((p) => ({
        label: p.label,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        rev: Number(p.revenue || 0),
        ord: Number(p.orders || 0),
        aov: Number(p.averageOrderValue || 0),
        priorOrd: Number(p.priorOrders || 0),
        yoy: p.changePercent,
    }));
    const marginTrendData = revenueSeries.slice(-120).map((d) => ({
        label: d.month,
        margin: Number(d.margin ?? 0),
    }));
    const activeChartData = type === "margin"
        ? marginTrendData
        : (type === "revenue" ? revenueTrendChartData : (isOrdersLike ? ordersTrendChartData : chartData));
    const activeChartLength = activeChartData.length;

    useEffect(() => {
        if (!open || !type) return;
        if (activeChartLength <= 0) {
            setChartWindow(null);
            return;
        }
        const defaultSpan = Math.max(8, Math.min(activeChartLength, isRevenue ? 90 : 60));
        const start = Math.max(0, activeChartLength - defaultSpan);
        const end = activeChartLength - 1;
        setChartWindow({ start, end });
    }, [open, type, isRevenue, activeChartLength]);

    const chartStart = activeChartLength > 0
        ? Math.max(0, Math.min(chartWindow?.start ?? 0, activeChartLength - 1))
        : 0;
    const chartEnd = activeChartLength > 0
        ? Math.max(chartStart, Math.min(chartWindow?.end ?? (activeChartLength - 1), activeChartLength - 1))
        : 0;
    const chartSpan = activeChartLength > 0 ? (chartEnd - chartStart + 1) : 0;

    const setWindowBySpan = useCallback((nextSpan: number) => {
        if (activeChartLength <= 0) return;
        const span = Math.max(8, Math.min(activeChartLength, nextSpan));
        const center = (chartStart + chartEnd) / 2;
        let start = Math.round(center - (span - 1) / 2);
        start = Math.max(0, Math.min(start, activeChartLength - span));
        const end = start + span - 1;
        setChartWindow({ start, end });
    }, [activeChartLength, chartStart, chartEnd]);

    const handleZoomIn = useCallback(() => {
        if (chartSpan <= 8) return;
        setWindowBySpan(Math.floor(chartSpan * 0.65));
    }, [chartSpan, setWindowBySpan]);

    const handleZoomOut = useCallback(() => {
        if (activeChartLength <= 0) return;
        setWindowBySpan(Math.ceil(chartSpan * 1.45));
    }, [activeChartLength, chartSpan, setWindowBySpan]);

    const handleZoomReset = useCallback(() => {
        if (activeChartLength <= 0) return;
        setChartWindow({ start: 0, end: activeChartLength - 1 });
    }, [activeChartLength]);

    const handleBrushChange = useCallback((next: { startIndex?: number; endIndex?: number } | null) => {
        if (!next || activeChartLength <= 0) return;
        const start = Math.max(0, Math.min(Number(next.startIndex ?? 0), activeChartLength - 1));
        const end = Math.max(start, Math.min(Number(next.endIndex ?? (activeChartLength - 1)), activeChartLength - 1));
        setChartWindow({ start, end });
    }, [activeChartLength]);

    const handleRevenuePointDrill = useCallback((row: { periodStart?: string } | null | undefined) => {
        if (!row?.periodStart || !isRevenue) return;

        if (revenueGranularity === "year") {
            const year = row.periodStart.slice(0, 4);
            setRevenueDrillHistory((prev) => [...prev, { granularity: revenueGranularity, from: revenueScopeFrom, to: revenueScopeTo }]);
            setRevenueGranularity("month");
            setRevenueDrillRange({ from: `${year}-01-01`, to: `${year}-12-31` });
            return;
        }

        if (revenueGranularity === "month") {
            const monthRange = monthBounds(row.periodStart);
            setRevenueDrillHistory((prev) => [...prev, { granularity: revenueGranularity, from: revenueScopeFrom, to: revenueScopeTo }]);
            setRevenueGranularity("day");
            setRevenueDrillRange(monthRange);
        }
    }, [isRevenue, revenueGranularity, revenueScopeFrom, revenueScopeTo]);

    const handleRevenueDrillBack = useCallback(() => {
        if (revenueDrillHistory.length === 0) return;
        const previous = revenueDrillHistory[revenueDrillHistory.length - 1];
        setRevenueDrillHistory((prev) => prev.slice(0, -1));
        setRevenueGranularity(previous.granularity);
        setRevenueDrillRange({ from: previous.from, to: previous.to });
    }, [revenueDrillHistory]);

    const handleRevenueZoomGranularity = useCallback(
        ({ start, end, points }: { start: number; end: number; points: Array<{ periodStart: string; periodEnd: string }> }) => {
            if (revenueZoomDebounceRef.current) clearTimeout(revenueZoomDebounceRef.current);
            revenueZoomDebounceRef.current = setTimeout(() => {
                const visible = getRevenueVisibleRangeFromZoom(start, end, points);
                if (!visible) return;
                const nextGranularity = chooseRevenueGranularity(visible.from, visible.to);
                if (nextGranularity === revenueGranularity) return;
                setRevenueDrillHistory((prev) => [...prev, { granularity: revenueGranularity, from: revenueScopeFrom, to: revenueScopeTo }]);
                setRevenueGranularity(nextGranularity);
                setRevenueDrillRange(normalizeRevenueRangeByGranularity(visible, nextGranularity));
            }, 400);
        },
        [revenueGranularity, revenueScopeFrom, revenueScopeTo],
    );

    const revenueTrail: RevenueDrillState[] = [
        ...revenueDrillHistory,
        { granularity: revenueGranularity, from: revenueScopeFrom, to: revenueScopeTo },
    ];

    const handleRevenueBreadcrumbClick = useCallback((index: number) => {
        const target = revenueTrail[index];
        if (!target) return;
        setRevenueGranularity(target.granularity);
        setRevenueDrillRange({ from: target.from, to: target.to });
        setRevenueDrillHistory(revenueTrail.slice(0, index));
    }, [revenueTrail]);

    const handleOrdersPointDrill = useCallback((row: { periodStart?: string } | null | undefined) => {
        if (!row?.periodStart || !isOrdersLike) return;

        if (ordersGranularity === "year") {
            const year = row.periodStart.slice(0, 4);
            setOrdersDrillHistory((prev) => [...prev, { granularity: ordersGranularity, from: ordersScopeFrom, to: ordersScopeTo }]);
            setOrdersGranularity("month");
            setOrdersDrillRange({ from: `${year}-01-01`, to: `${year}-12-31` });
            return;
        }

        if (ordersGranularity === "month") {
            const monthRange = monthBounds(row.periodStart);
            setOrdersDrillHistory((prev) => [...prev, { granularity: ordersGranularity, from: ordersScopeFrom, to: ordersScopeTo }]);
            setOrdersGranularity("day");
            setOrdersDrillRange(monthRange);
        }
    }, [isOrdersLike, ordersGranularity, ordersScopeFrom, ordersScopeTo]);

    const handleOrdersDrillBack = useCallback(() => {
        if (ordersDrillHistory.length === 0) return;
        const previous = ordersDrillHistory[ordersDrillHistory.length - 1];
        setOrdersDrillHistory((prev) => prev.slice(0, -1));
        setOrdersGranularity(previous.granularity);
        setOrdersDrillRange({ from: previous.from, to: previous.to });
    }, [ordersDrillHistory]);

    const handleOrdersZoomGranularity = useCallback(
        ({ start, end, points }: { start: number; end: number; points: Array<{ periodStart: string; periodEnd: string }> }) => {
            if (ordersZoomDebounceRef.current) clearTimeout(ordersZoomDebounceRef.current);
            ordersZoomDebounceRef.current = setTimeout(() => {
                const visible = getRevenueVisibleRangeFromZoom(start, end, points);
                if (!visible) return;
                const nextGranularity = chooseRevenueGranularity(visible.from, visible.to);
                if (nextGranularity === ordersGranularity) return;
                setOrdersDrillHistory((prev) => [...prev, { granularity: ordersGranularity, from: ordersScopeFrom, to: ordersScopeTo }]);
                setOrdersGranularity(nextGranularity);
                setOrdersDrillRange(normalizeRevenueRangeByGranularity(visible, nextGranularity));
            }, 400);
        },
        [ordersGranularity, ordersScopeFrom, ordersScopeTo],
    );

    const ordersTrail: RevenueDrillState[] = [
        ...ordersDrillHistory,
        { granularity: ordersGranularity, from: ordersScopeFrom, to: ordersScopeTo },
    ];

    const handleOrdersBreadcrumbClick = useCallback((index: number) => {
        const target = ordersTrail[index];
        if (!target) return;
        setOrdersGranularity(target.granularity);
        setOrdersDrillRange({ from: target.from, to: target.to });
        setOrdersDrillHistory(ordersTrail.slice(0, index));
    }, [ordersTrail]);

    // Summary stats:
    // - For date-only filtering: prefer /sales/kpis (full-period aggregate)
    // - For order/SKU text filtering: use /sales/orders aggregate fields
    const trendSummary = isRevenue ? revenueTrendQ.data?.summary : (isOrdersLike ? ordersTrendQ.data?.summary : null);
    const sumRevenue = hasTextFilter
        ? totalRevenue
        : (isDrillMode && trendSummary)
        ? Number(trendSummary.revenue || 0)
        : (kpis?.totalRevenue ?? totalRevenue);
    const sumOrders  = hasTextFilter
        ? total
        : (isDrillMode && trendSummary)
        ? Number(trendSummary.orders || 0)
        : (kpis?.totalOrders ?? total);
    const avgAOV     = hasTextFilter
        ? (sumOrders > 0 ? sumRevenue / sumOrders : 0)
        : (isDrillMode && trendSummary)
        ? Number(trendSummary.averageOrderValue || 0)
        : (kpis?.avgOrderValue ?? (sumOrders > 0 ? sumRevenue / sumOrders : 0));
    const avgMarginV = hasTextFilter
        ? avgMarginAll
        : (kpis?.avgMargin ?? avgMarginAll);
    const safeAvgMargin = Number.isFinite(avgMarginV) ? avgMarginV : 0;
    const hasDataError =
        ordersQ.isError ||
        kpisQ.isError ||
        ((type === "revenue" || type === "margin") && revenueQ.isError) ||
        (type === "margin" && dailyQ.isError) ||
        (type === "revenue" && revenueTrendQ.isError) ||
        (isOrdersLike && ordersTrendQ.isError);
    const firstError =
        (ordersQ.error as Error | undefined) ??
        (kpisQ.error as Error | undefined) ??
        ((type === "revenue" || type === "margin") ? (revenueQ.error as Error | undefined) : undefined) ??
        (type === "margin" ? (dailyQ.error as Error | undefined) : undefined) ??
        (type === "revenue" ? (revenueTrendQ.error as Error | undefined) : undefined) ??
        (isOrdersLike ? (ordersTrendQ.error as Error | undefined) : undefined);

    const hasActiveFilter = !!(applied.from || applied.to || applied.orderNumber || applied.sku);
    const detailRows = type === "margin"
        ? revenueSeries.slice(-20).map((m) => ({
            period: m.month,
            revenue: Number(m.revenue || 0),
            orders: Number(m.orders || 0),
            aov: Number(m.orders || 0) > 0 ? Number(m.revenue || 0) / Number(m.orders || 1) : 0,
            returns: Number(m.returns || 0),
            cancelled: 0,
            signal: `${Number(m.margin || 0).toFixed(2)}%`,
        }))
        : type === "revenue"
            ? (revenueTrendQ.data?.points ?? []).map((p) => ({
                period: p.label,
                revenue: Number(p.revenue || 0),
                orders: Number(p.orders || 0),
                aov: Number(p.averageOrderValue || 0),
                returns: 0,
                cancelled: 0,
                signal: p.changePercent == null ? "-" : `${p.changePercent >= 0 ? "+" : ""}${p.changePercent.toFixed(2)}%`,
            }))
            : isOrdersLike
                ? (ordersTrendQ.data?.points ?? []).map((p) => ({
                    period: p.label,
                    revenue: Number(p.revenue || 0),
                    orders: Number(p.orders || 0),
                    aov: Number(p.averageOrderValue || 0),
                    returns: 0,
                    cancelled: 0,
                    signal: p.changePercent == null ? "-" : `${p.changePercent >= 0 ? "+" : ""}${p.changePercent.toFixed(2)}%`,
                }))
            : daily.slice(-28).map((d) => ({
            period: d.date || `D${d.d}`,
            revenue: Number(d.rev || 0),
            orders: Number(d.ord || 0),
            aov: Number(d.ord || 0) > 0 ? Number(d.rev || 0) / Number(d.ord || 1) : 0,
            returns: Number(d.returns || 0),
            cancelled: Number(d.cancelledOrders || 0),
                signal:
                    type === "orders"
                        ? `${Number(d.ord || 0).toLocaleString()}`
                        : type === "aov"
                            ? eur(Number(d.ord || 0) > 0 ? Number(d.rev || 0) / Number(d.ord || 1) : 0)
                            : eur(Number(d.rev || 0)),
            }));

    useEffect(() => {
        if (!open) return;
        const timer = window.setInterval(() => {
            ordersQ.refetch();
            dailyQ.refetch();
            kpisQ.refetch();
            revenueQ.refetch();
            if (isDrillMode) {
                ordersTrendQ.refetch();
            }
            if (type === "revenue") {
                revenueTrendQ.refetch();
                regionalQ.refetch();
                payShipQ.refetch();
            }
        }, 30_000);
        return () => window.clearInterval(timer);
    }, [open, type, isDrillMode, ordersQ, dailyQ, kpisQ, revenueQ, revenueTrendQ, ordersTrendQ, regionalQ, payShipQ]);
    const locationOptions = regionalQ.data?.location_options ?? [];
    const locationInsights = regionalQ.data?.location_insights ?? [];
    const platformMix = regionalQ.data?.platform_mix ?? [];
    const productRows = productMode === "top"
        ? (regionalQ.data?.top_products ?? [])
        : (regionalQ.data?.least_products ?? []);
    const routeRows = routeMode === "top"
        ? (regionalQ.data?.top_product_routes ?? [])
        : (regionalQ.data?.least_product_routes ?? []);
    const paymentRows = payShipQ.data?.payment_methods ?? [];
    const shippingRows = payShipQ.data?.shipping_methods ?? [];
    const activeFrom = isRevenue ? revenueScopeFrom : (isOrdersLike ? ordersScopeFrom : (applied.from || "2000-01-01"));
    const activeTo = isRevenue ? revenueScopeTo : (isOrdersLike ? ordersScopeTo : (applied.to || new Date().toISOString().slice(0, 10)));
    const activeGranularity = isRevenue ? revenueGranularity : (isOrdersLike ? ordersGranularity : null);
    const modalInset = isDrillMode
        ? (isMobile ? "0.6vh 0.5vw" : "1.1vh 0.9vw")
        : (isMobile ? "1.5vh 1vw" : "3vh 2vw");

    const modalContent = (
        <>
            {/* Backdrop */}
            <div onClick={onClose} style={{
                position: "fixed", inset: 0, zIndex: 1300,
                background: "rgba(0,0,0,0.78)",
                opacity: open ? 1 : 0,
                pointerEvents: open ? "auto" : "none",
                transition: "opacity 0.25s",
                backdropFilter: "blur(5px)",
            }} />

            {/* Expanded modal */}
            <div style={{
                position: "fixed", inset: modalInset, zIndex: 1310,
                background: DS.surface,
                border: `1px solid ${accent}55`,
                borderRadius: 18,
                display: "flex", flexDirection: "column",
                boxShadow: "0 30px 80px rgba(0,0,0,0.75)",
                overflow: "hidden",
                opacity: open ? 1 : 0,
                visibility: open ? "visible" : "hidden",
                pointerEvents: open ? "auto" : "none",
                transform: open ? "translateY(0) scale(1)" : "translateY(8px) scale(0.995)",
                transition: "opacity 0.2s ease, transform 0.2s ease, visibility 0.2s ease",
            }}>

                {/* ── Header ─────────────────────────────────────────────── */}
                <div style={{
                    padding: "16px 24px 12px",
                    borderBottom: `1px solid ${DS.border}`,
                    background: DS.surface,
                    position: "sticky", top: 0, zIndex: 1,
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 3, height: 20, borderRadius: 2, background: accent }} />
                        <div>
                            <h2 style={{ margin: 0, fontSize: 15, color: DS.hi, fontWeight: 600 }}>
                                {type ? TITLE[type] : ""}
                            </h2>
                            <p style={{ margin: "2px 0 0", fontSize: 11, color: DS.lo }}>
                                {isDrillMode
                                    ? `${activeFrom} to ${activeTo}${activeGranularity ? ` · ${String(activeGranularity).toUpperCase()}` : ""}`
                                    : ordersQ.isFetching
                                        ? "Loading…"
                                        : hasActiveFilter
                                            ? `${total} matched · filters active`
                                            : `${total} total orders`}
                            </p>
                        </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {hasActiveFilter && (
                            <button onClick={reset} style={{
                                padding: "5px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11,
                                background: `${DS.rose}15`, border: `1px solid ${DS.rose}40`, color: DS.rose,
                            }}>Clear filters</button>
                        )}
                        <button onClick={onClose} style={{
                            background: "rgba(255,255,255,0.05)", border: `1px solid ${DS.border}`,
                            borderRadius: 8, padding: "5px 12px", color: DS.mid, cursor: "pointer", fontSize: 12,
                        }}>Close</button>
                    </div>
                </div>

                {/* ── Scrollable body ─────────────────────────────────────── */}
                <div style={{
                    flex: 1,
                    minHeight: 0,
                    minWidth: 0,
                    overflowY: "scroll",
                    overflowX: "hidden",
                    scrollbarGutter: "stable both-edges",
                    padding: isMobile ? "12px 12px 18px" : "18px 24px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                }}>

                    {/* ── Filter bar ─────────────────────────────────────── */}
                    <div style={{
                        background: DS.panel, border: `1px solid ${DS.border}`,
                        borderRadius: 12, padding: isDrillMode ? "12px 14px" : "14px 16px",
                        display: "flex", flexDirection: "column", gap: isDrillMode ? 8 : 10,
                    }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
                                Filters
                            </span>
                            <span style={{ fontSize: 9, color: DS.lo }}>Press Enter or wait 400ms to search</span>
                        </div>

                        {isDrillMode ? (
                            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1.3fr 1.3fr", gap: 10 }}>
                                <DateInput label="From date" value={dateFrom} onChange={setDateFrom} />
                                <DateInput label="To date" value={dateTo} onChange={setDateTo} />
                                <SearchInput
                                    placeholder="Order ID (e.g. ORD-1234)…"
                                    value={orderNum}
                                    onChange={setOrderNum}
                                    onEnter={applyNow}
                                    icon="🔍"
                                />
                                <SearchInput
                                    placeholder="SKU / Article no…"
                                    value={sku}
                                    onChange={setSku}
                                    onEnter={applyNow}
                                    icon="📦"
                                />
                            </div>
                        ) : (
                            <>
                                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
                                    <DateInput label="From date" value={dateFrom} onChange={setDateFrom} />
                                    <DateInput label="To date" value={dateTo} onChange={setDateTo} />
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
                                    <SearchInput
                                        placeholder="Order number (e.g. ORD-1234)…"
                                        value={orderNum}
                                        onChange={setOrderNum}
                                        onEnter={applyNow}
                                        icon="🔍"
                                    />
                                    <SearchInput
                                        placeholder="SKU / Article number…"
                                        value={sku}
                                        onChange={setSku}
                                        onEnter={applyNow}
                                        icon="📦"
                                    />
                                </div>
                            </>
                        )}

                        {/* Active filter chips */}
                        {hasActiveFilter && (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                                {applied.from && (
                                    <FilterChip label={`From: ${applied.from}`} accent={accent} onRemove={() => { setDateFrom(""); setApplied(f => ({ ...f, from: undefined })); }} />
                                )}
                                {applied.to && (
                                    <FilterChip label={`To: ${applied.to}`} accent={accent} onRemove={() => { setDateTo(""); setApplied(f => ({ ...f, to: undefined })); }} />
                                )}
                                {applied.orderNumber && (
                                    <FilterChip label={`Order: ${applied.orderNumber}`} accent={accent} onRemove={() => { setOrderNum(""); setApplied(f => ({ ...f, orderNumber: undefined })); }} />
                                )}
                                {applied.sku && (
                                    <FilterChip label={`SKU: ${applied.sku}`} accent={accent} onRemove={() => { setSku(""); setApplied(f => ({ ...f, sku: undefined })); }} />
                                )}
                            </div>
                        )}
                    </div>

                    {/* ── Error state ────────────────────────────────────── */}
                    {hasDataError && (
                        <div style={{
                            background: "rgba(244,63,94,0.06)", border: "1px solid rgba(244,63,94,0.2)",
                            borderRadius: 10, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12,
                        }}>
                            <span style={{ fontSize: 18 }}>!</span>
                            <div style={{ flex: 1 }}>
                                <p style={{ margin: 0, fontSize: 12, color: DS.rose, fontWeight: 600 }}>Failed to load data</p>
                                <p style={{ margin: "4px 0 0", fontSize: 11, color: DS.mid }}>
                                    {firstError?.message || "Check your connection and try again."}
                                </p>
                            </div>
                            <button onClick={() => { ordersQ.refetch(); dailyQ.refetch(); kpisQ.refetch(); revenueTrendQ.refetch(); ordersTrendQ.refetch(); }} style={{
                                fontSize: 11, color: DS.hi, background: "rgba(255,255,255,0.04)",
                                border: `1px solid ${DS.border}`, borderRadius: 6,
                                padding: "6px 14px", cursor: "pointer",
                            }}>Retry</button>
                        </div>
                    )}

                    {/* ── KPI summary strip ───────────────────────────────── */}
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,minmax(0,1fr))" : `repeat(${type === "revenue" ? 6 : 4},minmax(0,1fr))`, gap: 10 }}>
                        {(type === "revenue"
                            ? [
                                { label: "Revenue", value: eur(sumRevenue), c: DS.sky },
                                { label: "Orders", value: sumOrders.toLocaleString(), c: DS.violet },
                                { label: "Avg AOV", value: eur(avgAOV), c: DS.emerald },
                                { label: "Avg Margin", value: `${safeAvgMargin.toFixed(1)}%`, c: DS.amber },
                                { label: "Cancelled", value: `${Number(kpis?.cancelledOrders ?? 0).toLocaleString()}`, c: DS.rose },
                                { label: "Return Rate", value: `${Number(kpis?.returnRate ?? 0).toFixed(2)}%`, c: DS.lo },
                            ]
                            : [
                                { label: "Revenue", value: eur(sumRevenue), c: DS.sky },
                                { label: "Orders", value: sumOrders.toLocaleString(), c: DS.violet },
                                { label: "Avg AOV", value: eur(avgAOV), c: DS.emerald },
                                { label: "Avg Margin", value: `${safeAvgMargin.toFixed(1)}%`, c: DS.amber },
                            ]
                        ).map(s => (
                            <div key={s.label} style={{
                                background: DS.panel, border: `1px solid ${DS.border}`,
                                borderRadius: 10, padding: "12px 14px",
                                borderTop: `2px solid ${s.c}33`,
                            }}>
                                <p style={{ margin: "0 0 4px", fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em" }}>{s.label}</p>
                                <p style={{ margin: 0, fontSize: 18, color: s.c, fontFamily: DS.mono, fontWeight: 700 }}>{s.value}</p>
                            </div>
                        ))}
                    </div>

                    {/* ── Chart ───────────────────────────────────────────── */}
                    <div style={{ background: DS.panel, border: `1px solid ${DS.border}`, borderRadius: 12, padding: "14px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                            <p style={{ margin: 0, fontSize: 11, color: DS.mid, fontWeight: 600 }}>
                                {type === "revenue" ? "Revenue Trend — click points to drill down (Year → Month → Day)" :
                                 type === "orders"  ? "Orders Trend — click points to drill down (Year → Month → Day)"  :
                                 type === "aov"     ? "Avg Order Value Trend — click points to drill down (Year → Month → Day)" :
                                                      "Avg Margin Trend — zoom enabled"}
                            </p>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                {(type === "revenue" || isOrdersLike) && (
                                    <button
                                        onClick={type === "revenue" ? handleRevenueDrillBack : handleOrdersDrillBack}
                                        disabled={type === "revenue" ? revenueDrillHistory.length === 0 : ordersDrillHistory.length === 0}
                                        style={{
                                            fontSize: 11,
                                            color: (type === "revenue" ? revenueDrillHistory.length === 0 : ordersDrillHistory.length === 0) ? DS.lo : DS.hi,
                                            border: `1px solid ${DS.border}`,
                                            background: "rgba(255,255,255,0.03)",
                                            borderRadius: 8,
                                            padding: "5px 10px",
                                            cursor: (type === "revenue" ? revenueDrillHistory.length === 0 : ordersDrillHistory.length === 0) ? "not-allowed" : "pointer",
                                        }}
                                    >
                                        Back
                                    </button>
                                )}
                                {type === "margin" && (
                                    <>
                                        <button onClick={handleZoomIn} disabled={chartSpan <= 8} style={{ fontSize: 11, color: chartSpan <= 8 ? DS.lo : DS.hi, border: `1px solid ${DS.border}`, background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "5px 10px", cursor: chartSpan <= 8 ? "not-allowed" : "pointer" }}>Zoom In</button>
                                        <button onClick={handleZoomOut} disabled={activeChartLength <= 0 || chartSpan >= activeChartLength} style={{ fontSize: 11, color: (activeChartLength <= 0 || chartSpan >= activeChartLength) ? DS.lo : DS.hi, border: `1px solid ${DS.border}`, background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "5px 10px", cursor: (activeChartLength <= 0 || chartSpan >= activeChartLength) ? "not-allowed" : "pointer" }}>Zoom Out</button>
                                        <button onClick={handleZoomReset} disabled={activeChartLength <= 0 || (chartStart === 0 && chartEnd === activeChartLength - 1)} style={{ fontSize: 11, color: (activeChartLength <= 0 || (chartStart === 0 && chartEnd === activeChartLength - 1)) ? DS.lo : accent, border: `1px solid ${accent}44`, background: `${accent}12`, borderRadius: 8, padding: "5px 10px", cursor: (activeChartLength <= 0 || (chartStart === 0 && chartEnd === activeChartLength - 1)) ? "not-allowed" : "pointer" }}>Reset</button>
                                    </>
                                )}
                            </div>
                        </div>
                        {(type === "revenue" || isOrdersLike) && (
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 11, overflowX: "auto" }}>
                                {(type === "revenue" ? revenueTrail : ordersTrail).map((item, index) => {
                                    const isLast = index === (type === "revenue" ? revenueTrail : ordersTrail).length - 1;
                                    return (
                                        <div key={`${item.granularity}-${item.from}-${item.to}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            {index > 0 && <span style={{ color: DS.lo }}>›</span>}
                                            <button
                                                onClick={() => (type === "revenue" ? handleRevenueBreadcrumbClick(index) : handleOrdersBreadcrumbClick(index))}
                                                disabled={isLast}
                                                style={{
                                                    border: "none",
                                                    background: "transparent",
                                                    color: isLast ? DS.hi : DS.sky,
                                                    cursor: isLast ? "default" : "pointer",
                                                    fontSize: 12,
                                                    whiteSpace: "nowrap",
                                                    fontWeight: isLast ? 700 : 500,
                                                    padding: 0,
                                                }}
                                            >
                                                {revenueBreadcrumbLabel(item)}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        {(type === "revenue" || isOrdersLike) ? (
                            <div style={{ border: `1px solid ${DS.border}`, borderRadius: 10, background: "rgba(255,255,255,0.01)", padding: "8px 8px 0" }}>
                                {type === "revenue" ? (
                                    <RevenueTrendChart
                                        points={revenueTrendQ.data?.points ?? []}
                                        onDrillDown={handleRevenuePointDrill}
                                        onZoomChange={handleRevenueZoomGranularity}
                                        height={trendChartHeight}
                                    />
                                ) : (
                                    <OrdersTrendChart
                                        points={ordersTrendQ.data?.points ?? []}
                                        onDrillDown={handleOrdersPointDrill}
                                        onZoomChange={handleOrdersZoomGranularity}
                                        metric={type === "aov" ? "aov" : "orders"}
                                        height={trendChartHeight}
                                    />
                                )}
                            </div>
                        ) : (
                        <ResponsiveContainer width="100%" height={140}>
                            {type === "margin" ? (
                                <LineChart data={marginTrendData} margin={{ top: 2, right: 4, bottom: 0, left: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                    <XAxis dataKey="label" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                                    <YAxis tickFormatter={v => `${v}%`} tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={36} />
                                    <Tooltip content={<ChartTip />} />
                                    <Line type="monotone" dataKey="margin" name="Avg Margin %" stroke={DS.amber} strokeWidth={2} dot={false} />
                                    <Brush
                                        dataKey="label"
                                        height={20}
                                        startIndex={chartStart}
                                        endIndex={chartEnd}
                                        travellerWidth={8}
                                        stroke={DS.amber}
                                        onChange={handleBrushChange}
                                    />
                                </LineChart>
                            ) : (
                                <AreaChart data={chartData} margin={{ top: 2, right: 4, bottom: 0, left: 0 }}>
                                    <defs>
                                        <linearGradient id="drawerRevGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor={DS.sky} stopOpacity={0.35} />
                                            <stop offset="100%" stopColor={DS.sky} stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                    <XAxis dataKey="label" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                                    <YAxis tickFormatter={v => `€${(v / 1000).toFixed(0)}K`} tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={44} />
                                    <Tooltip content={<ChartTip />} />
                                    <Area type="monotone" dataKey="rev" name="Revenue" stroke={DS.sky} strokeWidth={2} fill="url(#drawerRevGrad)" dot={false} />
                                    <Brush
                                        dataKey="label"
                                        height={20}
                                        startIndex={chartStart}
                                        endIndex={chartEnd}
                                        travellerWidth={8}
                                        stroke={DS.sky}
                                        onChange={handleBrushChange}
                                    />
                                </AreaChart>
                            )}
                        </ResponsiveContainer>
                        )}
                    </div>

                    {/* ── Lower section (same pattern as cancelled modal) ───── */}
                    <div style={{
                        display: "grid",
                        gap: 12,
                        gridTemplateColumns: shouldStackDetails ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)",
                        minWidth: 0,
                    }}>
                        <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", overflow: "hidden", minHeight: 300, minWidth: 0, display: "flex", flexDirection: "column" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: `1px solid ${DS.border}` }}>
                                <div>
                                    <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600 }}>{type ? `${TITLE[type]} Timeline` : "Timeline Details"}</div>
                                    <div style={{ fontSize: 11, color: DS.lo, marginTop: 2 }}>Period-wise trend with revenue, orders, AOV, returns and cancellations</div>
                                </div>
                                <button
                                    onClick={() => exportCsv(
                                        `sales-${type ?? "kpi"}-timeline.csv`,
                                        ["Period", "Revenue", "Orders", "AOV", "Returns", "Cancelled", "Signal"],
                                        detailRows.map((r) => [r.period, r.revenue.toFixed(2), r.orders, r.aov.toFixed(2), r.returns, r.cancelled, r.signal]),
                                    )}
                                    style={{ fontSize: 11, color: accent, border: `1px solid ${accent}44`, background: `${accent}15`, borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}
                                >
                                    Export CSV
                                </button>
                            </div>
                            <div style={{ maxHeight: isDrillMode ? (isMobile ? 330 : 440) : (isMobile ? 260 : 300), overflowY: "scroll", overflowX: "scroll", scrollbarGutter: "stable both-edges" }}>
                                <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
                                    <thead>
                                        <tr>
                                            {["Period", "Revenue", "Orders", "AOV", "Returns", "Cancelled", "Signal"].map((h) => (
                                                <th key={h} style={{ textAlign: "left", fontSize: 10, color: DS.lo, letterSpacing: "0.06em", textTransform: "uppercase", padding: "8px 12px", borderBottom: `1px solid ${DS.border}`, position: "sticky", top: 0, background: "#091327" }}>
                                                    {h}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {detailRows.length === 0 && (
                                            <tr>
                                                <td colSpan={7} style={{ padding: "10px 12px", fontSize: 12, color: DS.lo }}>
                                                    No period-level data for the current filters.
                                                </td>
                                            </tr>
                                        )}
                                        {detailRows.map((row) => (
                                            <tr key={`${row.period}-${row.orders}-${row.revenue}`}>
                                                <td style={{ padding: "8px 12px", fontSize: 12, color: "#dbe7ff", fontWeight: 600 }}>{row.period}</td>
                                                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.sky, fontFamily: DS.mono }}>{eur(row.revenue)}</td>
                                                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.violet, fontFamily: DS.mono }}>{row.orders.toLocaleString()}</td>
                                                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.emerald, fontFamily: DS.mono }}>{eur(row.aov)}</td>
                                                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.amber, fontFamily: DS.mono }}>{row.returns.toLocaleString()}</td>
                                                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.rose, fontFamily: DS.mono }}>{row.cancelled.toLocaleString()}</td>
                                                <td style={{ padding: "8px 12px", fontSize: 12, color: accent, fontFamily: DS.mono }}>{row.signal}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", overflow: "hidden", minHeight: 300, minWidth: 0, display: "flex", flexDirection: "column" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${DS.border}` }}>
                                <div>
                                    <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600 }}>Order Records</div>
                                    <div style={{ fontSize: 11, color: DS.lo, marginTop: 2 }}>
                                        {applied.orderNumber || applied.sku || applied.from || applied.to
                                            ? `Filtered by ${applied.orderNumber ? `Order: ${applied.orderNumber}` : ""}${applied.orderNumber && applied.sku ? " · " : ""}${applied.sku ? `SKU: ${applied.sku}` : ""}${(applied.orderNumber || applied.sku) && (applied.from || applied.to) ? " · " : ""}${applied.from || applied.to ? `${applied.from || "…"} to ${applied.to || "…"}` : ""}`
                                            : "Use Order/SKU/Date filters above to narrow records"}
                                    </div>
                                </div>
                                <button
                                    onClick={() => exportCsv(
                                        `sales-${type ?? "kpi"}-orders-page-${page}.csv`,
                                        ["Order #", "External #", "Date", "Revenue", "City", "Country", "Payment", "Shipping", "Status", "Margin %"],
                                        orders.map((row) => [
                                            row.order_number || "",
                                            row.external_order_number || "",
                                            row.order_date ? String(row.order_date).slice(0, 10) : "",
                                            Number(row.gross_revenue || 0).toFixed(2),
                                            row.city || "",
                                            row.country || "",
                                            row.payment_method || "",
                                            row.shipping_method || "",
                                            row.status || "",
                                            Number(row.gross_margin || 0).toFixed(2),
                                        ]),
                                    )}
                                    style={{ fontSize: 11, color: DS.sky, border: `1px solid ${DS.sky}44`, background: `${DS.sky}14`, borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}
                                >
                                    Export CSV
                                </button>
                            </div>

                            <div style={{ maxHeight: isDrillMode ? (isMobile ? 330 : 440) : (isMobile ? 260 : 300), overflowY: "scroll", overflowX: "scroll", scrollbarGutter: "stable both-edges" }}>
                                <table style={{ width: "100%", minWidth: 960, borderCollapse: "collapse" }}>
                                    <thead>
                                        <tr>
                                            {["Order #", "Date", "Revenue", "City/Country", "Payment", "Shipping", "Status", "Margin"].map((h) => (
                                                <th key={h} style={{ textAlign: "left", fontSize: 10, color: DS.lo, letterSpacing: "0.06em", textTransform: "uppercase", padding: "8px 12px", borderBottom: `1px solid ${DS.border}`, position: "sticky", top: 0, background: "#091327" }}>
                                                    {h}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ordersQ.isFetching && orders.length === 0 && (
                                            <tr>
                                                <td colSpan={8} style={{ padding: "10px 12px", fontSize: 12, color: DS.lo }}>Fetching orders...</td>
                                            </tr>
                                        )}
                                        {!ordersQ.isFetching && orders.length === 0 && (
                                            <tr>
                                                <td colSpan={8} style={{ padding: "10px 12px", fontSize: 12, color: DS.lo }}>
                                                    No orders match current filters.
                                                    {hasActiveFilter && (
                                                        <button onClick={reset} style={{ marginLeft: 8, fontSize: 11, color: DS.sky, background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                                                            Clear filters
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        )}
                                        {orders.map((row) => (
                                            <tr key={`${row.order_number}-${row.order_date}-${row.external_order_number ?? ""}`}>
                                                <td style={{ padding: "8px 12px", fontSize: 12, color: accent, fontFamily: DS.mono, fontWeight: 700 }}>
                                                    {row.order_number || "—"}
                                                    {row.external_order_number && <div style={{ fontSize: 10, color: DS.lo, fontFamily: DS.mono, marginTop: 2 }}>{row.external_order_number}</div>}
                                                </td>
                                                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.mid, fontFamily: DS.mono }}>{row.order_date ? String(row.order_date).slice(0, 10) : "—"}</td>
                                                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.hi, fontFamily: DS.mono, fontWeight: 600 }}>{eur(Number(row.gross_revenue) || 0)}</td>
                                                <td style={{ padding: "8px 12px", fontSize: 12, color: "#c9d7f4" }}>{[row.city, row.country].filter(Boolean).join(", ") || "—"}</td>
                                                <td style={{ padding: "8px 12px", fontSize: 11, color: DS.mid }}>{row.payment_method || "—"}</td>
                                                <td style={{ padding: "8px 12px", fontSize: 11, color: DS.mid }}>
                                                    {row.shipping_method || "—"}
                                                    {row.shipping_cost != null && Number(row.shipping_cost) > 0 && <div style={{ fontSize: 10, color: DS.lo, fontFamily: DS.mono, marginTop: 2 }}>{eur(Number(row.shipping_cost))}</div>}
                                                </td>
                                                <td style={{ padding: "8px 12px", fontSize: 11, fontWeight: 600, color: STATUS_COLOR[(row.status ?? "").toLowerCase()] ?? DS.mid }}>
                                                    {row.status ? row.status.charAt(0).toUpperCase() + row.status.slice(1) : "—"}
                                                </td>
                                                <td style={{ padding: "8px 12px", fontSize: 11, fontFamily: DS.mono, color: Number(row.gross_margin) >= 30 ? DS.emerald : DS.amber }}>
                                                    {`${Number(row.gross_margin || 0).toFixed(1)}%`}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderTop: `1px solid ${DS.border}`, marginTop: "auto" }}>
                                <span style={{ fontSize: 11, color: DS.lo }}>{ordersQ.isFetching ? "Loading…" : `Page ${page} of ${totalPages} · ${total} records`}</span>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={{ padding: "5px 10px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: `1px solid ${DS.border}`, color: page <= 1 ? DS.lo : DS.mid, fontSize: 11, cursor: page <= 1 ? "not-allowed" : "pointer" }}>Prev</button>
                                    <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{ padding: "5px 10px", borderRadius: 8, background: "rgba(255,255,255,0.05)", border: `1px solid ${DS.border}`, color: page >= totalPages ? DS.lo : DS.mid, fontSize: 11, cursor: page >= totalPages ? "not-allowed" : "pointer" }}>Next</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {type === "revenue" && (
                        <details style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.012)", overflow: "hidden" }}>
                        <summary style={{ cursor: "pointer", listStyle: "none", padding: "12px 14px", borderBottom: `1px solid ${DS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 12, color: DS.hi, fontWeight: 700 }}>Advanced Revenue Intelligence</span>
                            <span style={{ fontSize: 11, color: DS.lo }}>
                                Geo, platform, top/least products, routes, payment and shipping
                            </span>
                        </summary>
                        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                        <div style={{ display: "grid", gap: 12, gridTemplateColumns: isNarrow ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)" }}>
                            <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", overflow: "hidden", minWidth: 0 }}>
                                <div style={{ padding: "10px 12px", borderBottom: `1px solid ${DS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" as const }}>
                                    <div>
                                        <div style={{ fontSize: 12, color: DS.hi, fontWeight: 700 }}>Revenue Geography Intelligence</div>
                                        <div style={{ fontSize: 11, color: DS.lo, marginTop: 2 }}>Country/region/city performance + platform mix (real backend data)</div>
                                    </div>
                                    <div style={{ display: "flex", gap: 8 }}>
                                        <select value={geoDimension} onChange={(e) => { setGeoDimension(e.target.value as "country" | "region" | "city"); setGeoLocation("all"); }} style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${DS.border}`, color: DS.hi, borderRadius: 8, padding: "5px 8px", fontSize: 11 }}>
                                            <option value="country">Country</option>
                                            <option value="region">Region</option>
                                            <option value="city">City</option>
                                        </select>
                                        <select value={geoLocation} onChange={(e) => setGeoLocation(e.target.value)} style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${DS.border}`, color: DS.hi, borderRadius: 8, padding: "5px 8px", fontSize: 11, maxWidth: 220 }}>
                                            <option value="all">All {geoDimension}s</option>
                                            {locationOptions.map((o) => (
                                                <option key={o} value={o}>{o}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, padding: 10 }}>
                                    <div style={{ border: `1px solid ${DS.border}`, borderRadius: 10, overflow: "hidden" }}>
                                        <div style={{ padding: "8px 10px", borderBottom: `1px solid ${DS.border}`, fontSize: 11, color: DS.hi, fontWeight: 600 }}>{geoDimension} performance</div>
                                        <div style={{ maxHeight: 220, overflowY: "scroll", overflowX: "auto" }}>
                                            <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse" }}>
                                                <thead>
                                                    <tr>
                                                        {["Location", "Orders", "Good", "Bad", "Revenue", "AOV"].map((h) => (
                                                            <th key={h} style={{ textAlign: "left", fontSize: 10, color: DS.lo, padding: "7px 10px", borderBottom: `1px solid ${DS.border}`, position: "sticky", top: 0, background: "#091327" }}>{h}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {regionalQ.isLoading && <tr><td colSpan={6} style={{ padding: "10px", color: DS.lo, fontSize: 12 }}>Loading geography data…</td></tr>}
                                                    {!regionalQ.isLoading && locationInsights.length === 0 && <tr><td colSpan={6} style={{ padding: "10px", color: DS.lo, fontSize: 12 }}>No location rows for current filters.</td></tr>}
                                                    {locationInsights.map((row) => (
                                                        <tr key={`${row.location}-${row.orders}`}>
                                                            <td style={{ padding: "7px 10px", color: "#dbe7ff", fontSize: 12, fontWeight: 600 }}>{row.location}</td>
                                                            <td style={{ padding: "7px 10px", color: DS.violet, fontSize: 12, fontFamily: DS.mono }}>{row.orders.toLocaleString()}</td>
                                                            <td style={{ padding: "7px 10px", color: DS.emerald, fontSize: 12, fontFamily: DS.mono }}>{row.good_orders.toLocaleString()}</td>
                                                            <td style={{ padding: "7px 10px", color: DS.rose, fontSize: 12, fontFamily: DS.mono }}>{row.bad_orders.toLocaleString()}</td>
                                                            <td style={{ padding: "7px 10px", color: DS.sky, fontSize: 12, fontFamily: DS.mono }}>{eur(row.revenue)}</td>
                                                            <td style={{ padding: "7px 10px", color: DS.amber, fontSize: 12, fontFamily: DS.mono }}>{eur(row.avg_order_value)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                    <div style={{ border: `1px solid ${DS.border}`, borderRadius: 10, overflow: "hidden" }}>
                                        <div style={{ padding: "8px 10px", borderBottom: `1px solid ${DS.border}`, fontSize: 11, color: DS.hi, fontWeight: 600 }}>Platform mix in selected scope</div>
                                        <div style={{ maxHeight: 220, overflowY: "scroll", overflowX: "auto" }}>
                                            <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse" }}>
                                                <thead>
                                                    <tr>
                                                        {["Platform", "Orders", "Good Rate", "Revenue", "AOV", "Share"].map((h) => (
                                                            <th key={h} style={{ textAlign: "left", fontSize: 10, color: DS.lo, padding: "7px 10px", borderBottom: `1px solid ${DS.border}`, position: "sticky", top: 0, background: "#091327" }}>{h}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {regionalQ.isLoading && <tr><td colSpan={6} style={{ padding: "10px", color: DS.lo, fontSize: 12 }}>Loading platform mix…</td></tr>}
                                                    {!regionalQ.isLoading && platformMix.length === 0 && <tr><td colSpan={6} style={{ padding: "10px", color: DS.lo, fontSize: 12 }}>No platform mix rows.</td></tr>}
                                                    {platformMix.map((row) => (
                                                        <tr key={`${row.platform}-${row.orders}`}>
                                                            <td style={{ padding: "7px 10px", color: "#dbe7ff", fontSize: 12, fontWeight: 600 }}>{row.platform}</td>
                                                            <td style={{ padding: "7px 10px", color: DS.violet, fontSize: 12, fontFamily: DS.mono }}>{row.orders.toLocaleString()}</td>
                                                            <td style={{ padding: "7px 10px", color: DS.emerald, fontSize: 12, fontFamily: DS.mono }}>{row.good_rate_pct.toFixed(1)}%</td>
                                                            <td style={{ padding: "7px 10px", color: DS.sky, fontSize: 12, fontFamily: DS.mono }}>{eur(row.revenue)}</td>
                                                            <td style={{ padding: "7px 10px", color: DS.amber, fontSize: 12, fontFamily: DS.mono }}>{eur(row.avg_order_value)}</td>
                                                            <td style={{ padding: "7px 10px", color: DS.lo, fontSize: 12, fontFamily: DS.mono }}>{row.share_pct.toFixed(1)}%</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", overflow: "hidden", minWidth: 0 }}>
                                <div style={{ padding: "10px 12px", borderBottom: `1px solid ${DS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" as const }}>
                                    <div>
                                        <div style={{ fontSize: 12, color: DS.hi, fontWeight: 700 }}>Top vs Least Sales Products and Routes</div>
                                        <div style={{ fontSize: 11, color: DS.lo, marginTop: 2 }}>Product contribution + platform/shipping routes with revenue and quantity</div>
                                    </div>
                                    <div style={{ display: "flex", gap: 8 }}>
                                        <button onClick={() => setProductMode("top")} style={{ border: `1px solid ${productMode === "top" ? `${DS.emerald}66` : DS.border}`, background: productMode === "top" ? `${DS.emerald}18` : "rgba(255,255,255,0.03)", color: productMode === "top" ? DS.emerald : DS.mid, borderRadius: 8, padding: "5px 9px", fontSize: 11, cursor: "pointer" }}>Top Products</button>
                                        <button onClick={() => setProductMode("least")} style={{ border: `1px solid ${productMode === "least" ? `${DS.rose}66` : DS.border}`, background: productMode === "least" ? `${DS.rose}18` : "rgba(255,255,255,0.03)", color: productMode === "least" ? DS.rose : DS.mid, borderRadius: 8, padding: "5px 9px", fontSize: 11, cursor: "pointer" }}>Least Products</button>
                                        <button onClick={() => setRouteMode("top")} style={{ border: `1px solid ${routeMode === "top" ? `${DS.emerald}66` : DS.border}`, background: routeMode === "top" ? `${DS.emerald}18` : "rgba(255,255,255,0.03)", color: routeMode === "top" ? DS.emerald : DS.mid, borderRadius: 8, padding: "5px 9px", fontSize: 11, cursor: "pointer" }}>Top Routes</button>
                                        <button onClick={() => setRouteMode("least")} style={{ border: `1px solid ${routeMode === "least" ? `${DS.rose}66` : DS.border}`, background: routeMode === "least" ? `${DS.rose}18` : "rgba(255,255,255,0.03)", color: routeMode === "least" ? DS.rose : DS.mid, borderRadius: 8, padding: "5px 9px", fontSize: 11, cursor: "pointer" }}>Least Routes</button>
                                    </div>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, padding: 10 }}>
                                    <div style={{ border: `1px solid ${DS.border}`, borderRadius: 10, overflow: "hidden" }}>
                                        <div style={{ padding: "8px 10px", borderBottom: `1px solid ${DS.border}`, fontSize: 11, color: DS.hi, fontWeight: 600 }}>{productMode === "top" ? "Top selling products" : "Least selling products"}</div>
                                        <div style={{ maxHeight: 220, overflowY: "scroll", overflowX: "auto" }}>
                                            <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse" }}>
                                                <thead>
                                                    <tr>
                                                        {["Product", "SKU", "Qty", "Orders", "Revenue", "Price"].map((h) => (
                                                            <th key={h} style={{ textAlign: "left", fontSize: 10, color: DS.lo, padding: "7px 10px", borderBottom: `1px solid ${DS.border}`, position: "sticky", top: 0, background: "#091327" }}>{h}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {regionalQ.isLoading && <tr><td colSpan={6} style={{ padding: "10px", color: DS.lo, fontSize: 12 }}>Loading products…</td></tr>}
                                                    {!regionalQ.isLoading && productRows.length === 0 && <tr><td colSpan={6} style={{ padding: "10px", color: DS.lo, fontSize: 12 }}>No product rows for this scope.</td></tr>}
                                                    {productRows.map((row) => {
                                                        const price = row.quantity > 0 ? row.revenue / row.quantity : 0;
                                                        return (
                                                            <tr key={`${row.product_id}-${row.sku}-${row.orders}`}>
                                                                <td style={{ padding: "7px 10px", color: "#dbe7ff", fontSize: 12, fontWeight: 600 }}>{row.product_name}</td>
                                                                <td style={{ padding: "7px 10px", color: DS.lo, fontSize: 11, fontFamily: DS.mono }}>{row.sku || "—"}</td>
                                                                <td style={{ padding: "7px 10px", color: DS.violet, fontSize: 12, fontFamily: DS.mono }}>{row.quantity.toLocaleString()}</td>
                                                                <td style={{ padding: "7px 10px", color: DS.emerald, fontSize: 12, fontFamily: DS.mono }}>{row.orders.toLocaleString()}</td>
                                                                <td style={{ padding: "7px 10px", color: DS.sky, fontSize: 12, fontFamily: DS.mono }}>{eur(row.revenue)}</td>
                                                                <td style={{ padding: "7px 10px", color: DS.amber, fontSize: 12, fontFamily: DS.mono }}>{eur(price)}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                    <div style={{ border: `1px solid ${DS.border}`, borderRadius: 10, overflow: "hidden" }}>
                                        <div style={{ padding: "8px 10px", borderBottom: `1px solid ${DS.border}`, fontSize: 11, color: DS.hi, fontWeight: 600 }}>{routeMode === "top" ? "Top revenue routes" : "Least revenue routes"}</div>
                                        <div style={{ maxHeight: 220, overflowY: "scroll", overflowX: "auto" }}>
                                            <table style={{ width: "100%", minWidth: 540, borderCollapse: "collapse" }}>
                                                <thead>
                                                    <tr>
                                                        {["Platform", "Shipping", "Orders", "Qty", "Revenue", "AOV"].map((h) => (
                                                            <th key={h} style={{ textAlign: "left", fontSize: 10, color: DS.lo, padding: "7px 10px", borderBottom: `1px solid ${DS.border}`, position: "sticky", top: 0, background: "#091327" }}>{h}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {regionalQ.isLoading && <tr><td colSpan={6} style={{ padding: "10px", color: DS.lo, fontSize: 12 }}>Loading routes…</td></tr>}
                                                    {!regionalQ.isLoading && routeRows.length === 0 && <tr><td colSpan={6} style={{ padding: "10px", color: DS.lo, fontSize: 12 }}>No route rows for this scope.</td></tr>}
                                                    {routeRows.map((row) => {
                                                        const aov = row.orders > 0 ? row.revenue / row.orders : 0;
                                                        return (
                                                            <tr key={`${row.platform}-${row.shipping_method}-${row.orders}-${row.quantity}`}>
                                                                <td style={{ padding: "7px 10px", color: "#dbe7ff", fontSize: 12, fontWeight: 600 }}>{row.platform || "Unknown"}</td>
                                                                <td style={{ padding: "7px 10px", color: DS.lo, fontSize: 11 }}>{row.shipping_method || "Unknown"}</td>
                                                                <td style={{ padding: "7px 10px", color: DS.violet, fontSize: 12, fontFamily: DS.mono }}>{row.orders.toLocaleString()}</td>
                                                                <td style={{ padding: "7px 10px", color: DS.emerald, fontSize: 12, fontFamily: DS.mono }}>{row.quantity.toLocaleString()}</td>
                                                                <td style={{ padding: "7px 10px", color: DS.sky, fontSize: 12, fontFamily: DS.mono }}>{eur(row.revenue)}</td>
                                                                <td style={{ padding: "7px 10px", color: DS.amber, fontSize: 12, fontFamily: DS.mono }}>{eur(aov)}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div style={{ display: "grid", gap: 12, gridTemplateColumns: isNarrow ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)" }}>
                            <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", overflow: "hidden" }}>
                                <div style={{ padding: "8px 10px", borderBottom: `1px solid ${DS.border}`, fontSize: 11, color: DS.hi, fontWeight: 600 }}>Payment method sales</div>
                                <div style={{ maxHeight: 220, overflowY: "scroll", overflowX: "auto" }}>
                                    <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse" }}>
                                        <thead>
                                            <tr>
                                                {["Payment", "Orders", "Revenue", "Share"].map((h) => (
                                                    <th key={h} style={{ textAlign: "left", fontSize: 10, color: DS.lo, padding: "7px 10px", borderBottom: `1px solid ${DS.border}`, position: "sticky", top: 0, background: "#091327" }}>{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {payShipQ.isLoading && <tr><td colSpan={4} style={{ padding: "10px", color: DS.lo, fontSize: 12 }}>Loading payment mix…</td></tr>}
                                            {!payShipQ.isLoading && paymentRows.length === 0 && <tr><td colSpan={4} style={{ padding: "10px", color: DS.lo, fontSize: 12 }}>No payment rows for this filter scope.</td></tr>}
                                            {paymentRows.map((row) => (
                                                <tr key={`${row.label}-${row.orders}`}>
                                                    <td style={{ padding: "7px 10px", color: "#dbe7ff", fontSize: 12, fontWeight: 600 }}>{row.label}</td>
                                                    <td style={{ padding: "7px 10px", color: DS.violet, fontSize: 12, fontFamily: DS.mono }}>{row.orders.toLocaleString()}</td>
                                                    <td style={{ padding: "7px 10px", color: DS.sky, fontSize: 12, fontFamily: DS.mono }}>{eur(row.revenue)}</td>
                                                    <td style={{ padding: "7px 10px", color: DS.amber, fontSize: 12, fontFamily: DS.mono }}>{row.share_pct.toFixed(1)}%</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", overflow: "hidden" }}>
                                <div style={{ padding: "8px 10px", borderBottom: `1px solid ${DS.border}`, fontSize: 11, color: DS.hi, fontWeight: 600 }}>Shipping partner performance</div>
                                <div style={{ maxHeight: 220, overflowY: "scroll", overflowX: "auto" }}>
                                    <table style={{ width: "100%", minWidth: 580, borderCollapse: "collapse" }}>
                                        <thead>
                                            <tr>
                                                {["Shipping", "Orders", "Revenue", "Avg Ship Cost", "Share"].map((h) => (
                                                    <th key={h} style={{ textAlign: "left", fontSize: 10, color: DS.lo, padding: "7px 10px", borderBottom: `1px solid ${DS.border}`, position: "sticky", top: 0, background: "#091327" }}>{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {payShipQ.isLoading && <tr><td colSpan={5} style={{ padding: "10px", color: DS.lo, fontSize: 12 }}>Loading shipping mix…</td></tr>}
                                            {!payShipQ.isLoading && shippingRows.length === 0 && <tr><td colSpan={5} style={{ padding: "10px", color: DS.lo, fontSize: 12 }}>No shipping rows for this filter scope.</td></tr>}
                                            {shippingRows.map((row) => (
                                                <tr key={`${row.label}-${row.orders}`}>
                                                    <td style={{ padding: "7px 10px", color: "#dbe7ff", fontSize: 12, fontWeight: 600 }}>{row.label}</td>
                                                    <td style={{ padding: "7px 10px", color: DS.violet, fontSize: 12, fontFamily: DS.mono }}>{row.orders.toLocaleString()}</td>
                                                    <td style={{ padding: "7px 10px", color: DS.sky, fontSize: 12, fontFamily: DS.mono }}>{eur(row.revenue)}</td>
                                                    <td style={{ padding: "7px 10px", color: DS.emerald, fontSize: 12, fontFamily: DS.mono }}>{eur(row.avg_shipping_cost)}</td>
                                                    <td style={{ padding: "7px 10px", color: DS.amber, fontSize: 12, fontFamily: DS.mono }}>{row.share_pct.toFixed(1)}%</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                        </div>
                        </details>
                    )}

                </div>
            </div>
        </>
    );

    if (!mounted) return null;
    return createPortal(modalContent, document.body);
}

/* ── filter chip ────────────────────────────────────────────────────────── */
function FilterChip({ label, accent, onRemove }: { label: string; accent: string; onRemove: () => void }) {
    return (
        <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            fontSize: 10, color: accent,
            background: `${accent}14`, border: `1px solid ${accent}40`,
            borderRadius: 20, padding: "3px 8px 3px 10px",
        }}>
            {label}
            <button onClick={onRemove} style={{
                background: "transparent", border: "none", cursor: "pointer",
                color: accent, fontSize: 11, lineHeight: 1, padding: 0,
            }}>✕</button>
        </span>
    );
}
