"use client";

import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import { useStore, ROLE_META, useFilterStore } from "@/lib/store";
import type { StatusFilter } from "@/lib/store";
import { DS } from "@/lib/design-system";
import { useOverviewKpis } from "@/hooks/useOverviewData";
import api from "@/lib/api";

const SEARCH_INDEX = [
    // Pages
    { type: "page", label: "Overview",        desc: "Executive summary",        path: "/dashboard/overview",   icon: "❖",  tags: ["overview", "summary", "executive"] },
    { type: "page", label: "Sales",           desc: "KPIs & revenue trends",    path: "/dashboard/sales",      icon: "◈",  tags: ["sales", "revenue", "kpi", "orders", "trends"] },
    { type: "page", label: "Products",        desc: "SKU performance",          path: "/dashboard/products",   icon: "◉",  tags: ["products", "sku", "catalog", "items"] },
    { type: "page", label: "Customers",       desc: "Segments & LTV",           path: "/dashboard/customers",  icon: "◆",  tags: ["customers", "segments", "ltv", "retention"] },
    { type: "page", label: "Regional",        desc: "Geo breakdown",            path: "/dashboard/regional",   icon: "◇",  tags: ["regional", "geo", "map", "location", "zone"] },
    { type: "page", label: "Inventory",       desc: "Stock & alerts",           path: "/dashboard/inventory",  icon: "📦", tags: ["inventory", "stock", "alerts", "warehouse"] },
    { type: "page", label: "Marketing",       desc: "Ads & campaigns",          path: "/dashboard/marketing",  icon: "🎯", tags: ["marketing", "ads", "campaigns", "roas", "spend"] },
    { type: "page", label: "Sync Status",     desc: "System health & jobs",     path: "/dashboard/sync",       icon: "⚙️", tags: ["sync", "system", "health", "jobs", "api"] },
    { type: "page", label: "Settings",         desc: "Preferences & profile",    path: "/dashboard/settings",   icon: "◎",  tags: ["settings", "profile", "password", "preferences", "alerts", "timezone"] },
    { type: "page", label: "User Management", desc: "Accounts & roles",         path: "/dashboard/admin",      icon: "👤", tags: ["admin", "users", "roles", "accounts", "management"] },
    { type: "page", label: "Platform",        desc: "Tenants & overview",       path: "/dashboard/super-admin",icon: "★",  tags: ["platform", "tenants", "super", "admin"] },
    // Filters
    { type: "filter", label: "Last 7 Days",   desc: "Set date range",           path: "filter:7d",             icon: "📅", tags: ["7d", "week", "filter", "date", "range"] },
    { type: "filter", label: "Last 30 Days",  desc: "Set date range",           path: "filter:30d",            icon: "📅", tags: ["30d", "month", "filter", "date", "range"] },
    { type: "filter", label: "Last 3 Months", desc: "Set date range",           path: "filter:3m",             icon: "📅", tags: ["3m", "quarter", "filter", "date"] },
    { type: "filter", label: "Year to Date",  desc: "Set date range",           path: "filter:ytd",            icon: "📅", tags: ["ytd", "year", "filter", "date"] },
];

function formatCurrency(n: number): string {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function formatNumber(n: number): string {
    return n.toLocaleString("de-DE");
}

function buildTickerItems(kpis: { totalRevenue: number; totalOrders: number; totalProducts: number; totalCustomers: number; lowStockCount: number }) {
    const aov = kpis.totalOrders > 0 ? kpis.totalRevenue / kpis.totalOrders : 0;
    return [
        { label: "Revenue",       value: formatCurrency(kpis.totalRevenue),   delta: "", c: DS.sky },
        { label: "Orders",        value: formatNumber(kpis.totalOrders),      delta: "", c: DS.violet },
        { label: "Avg Order",     value: `€${aov.toFixed(2)}`,               delta: "", c: DS.emerald },
        { label: "Active SKUs",   value: formatNumber(kpis.totalProducts),    delta: "", c: DS.cyan },
        { label: "Customers",     value: formatNumber(kpis.totalCustomers),   delta: "", c: DS.amber },
        { label: "Low Stock",     value: formatNumber(kpis.lowStockCount),    delta: "", c: kpis.lowStockCount > 0 ? DS.rose : DS.emerald },
    ];
}

// Alerts are now empty — will be populated from real threshold-based API data in the future
const ALERTS: { id: number; severity: string; label: string; metric: string; value: string; note: string; path: string; time: string }[] = [];

const SEV_COLOR: Record<string, string> = {
    critical: DS.rose,
    warning:  DS.amber,
    info:     DS.sky,
};

const FILTER_RANGE_MAP: Record<string, string> = {
    "filter:7d":  "7D",
    "filter:30d": "30D",
    "filter:3m":  "3M",
    "filter:6m":  "6M",
    "filter:ytd": "YTD",
};

const PERIOD_OPTIONS = ["TODAY","YESTERDAY","7D","30D","3M","6M","12M","YTD","ALL","custom"] as const;

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
    { value: "all",       label: "All Orders" },
    { value: "pending",   label: "Pending"    },
    { value: "cancelled", label: "Cancelled"  },
];

function rangeLabel(range: string) {
    return range === "TODAY"      ? "Today"
         : range === "YESTERDAY"  ? "Yesterday"
         : range === "7D"         ? "Last 7 days"
         : range === "30D"        ? "Last 30 days"
         : range === "3M"         ? "Last 3 months"
         : range === "6M"         ? "Last 6 months"
         : range === "12M"        ? "Last 12 months"
         : range === "YTD"        ? "Jan 1 – today"
         : range === "ALL"        ? "All time"
         : "Custom range";
}

export function Topbar() {
    const { session, logout } = useStore();
    const { range, from, to, status, setRange, setCustom, setStatus } = useFilterStore();
    const { data: kpis } = useOverviewKpis();
    const TICKER_ITEMS = buildTickerItems(kpis || { totalRevenue: 0, totalOrders: 0, totalProducts: 0, totalCustomers: 0, lowStockCount: 0 });
    const role = session?.role || "viewer";
    const rm = ROLE_META[role];
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const [alertOpen, setAlertOpen] = useState(false);
    const [dismissed, setDismissed] = useState<number[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchIdx, setSearchIdx] = useState(0);
    const [periodOpen, setPeriodOpen] = useState(false);
    const [periodIdx, setPeriodIdx] = useState(0);
    const [statusOpen, setStatusOpen] = useState(false);
    const [statusIdx, setStatusIdx] = useState(0);
    const [customFrom, setCustomFrom] = useState(from || "");
    const [customTo, setCustomTo] = useState(to || "");
    const keydownHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
    const searchRef = useRef<HTMLInputElement>(null);
    const periodRef = useRef<HTMLDivElement>(null);
    const statusRef = useRef<HTMLDivElement>(null);
    const router = useRouter();

    const activeAlerts = ALERTS.filter(a => !dismissed.includes(a.id));
    const critCount    = activeAlerts.filter(a => a.severity === "critical").length;

    // Ticker scroll
    const tickerRef = useRef<HTMLDivElement>(null);
    const animRef   = useRef<number>(0);
    const posRef    = useRef(0);
    const pauseRef  = useRef(false);
    const SPEED     = 0.5; // px per frame

    useLayoutEffect(() => {
        const el = tickerRef.current;
        if (!el) return;
        const half = el.scrollWidth / 2;
        const step = () => {
            if (!pauseRef.current) {
                posRef.current += SPEED;
                if (posRef.current >= half) posRef.current = 0;
                el.style.transform = `translateX(${-posRef.current}px)`;
            }
            animRef.current = requestAnimationFrame(step);
        };
        animRef.current = requestAnimationFrame(step);
        return () => cancelAnimationFrame(animRef.current);
    }, []);

    const q = searchQuery.trim();

    const staticResults = q.length > 0
        ? SEARCH_INDEX.filter(item => {
            const ql = q.toLowerCase();
            return item.label.toLowerCase().includes(ql)
                || item.desc.toLowerCase().includes(ql)
                || item.tags.some(t => t.includes(ql));
          }).slice(0, 5)
        : [];

    // Dynamic order / SKU search shortcuts (appear when query is 2+ chars)
    const dynamicResults = q.length >= 2
        ? [
            {
                type: "order-search",
                label: `Search orders: "${q}"`,
                desc:  "Filter Sales by order number",
                path:  `order:${q}`,
                icon:  "📋",
                tags:  [] as string[],
            },
            {
                type: "sku-search",
                label: `Search SKU: "${q}"`,
                desc:  "Filter Sales by article number / SKU",
                path:  `sku:${q}`,
                icon:  "📦",
                tags:  [] as string[],
            },
          ]
        : [];

    const results = [...staticResults, ...dynamicResults];

    const handleSelect = useCallback((item: { type: string; path: string }) => {
        setSearchQuery("");
        setSearchOpen(false);
        if (item.path.startsWith("filter:")) {
            const range = FILTER_RANGE_MAP[item.path];
            if (range) setRange(range as any);
            return;
        }
        if (item.path.startsWith("order:")) {
            const val = item.path.slice("order:".length);
            router.push(`/dashboard/sales?orderSearch=${encodeURIComponent(val)}`);
            return;
        }
        if (item.path.startsWith("sku:")) {
            const val = item.path.slice("sku:".length);
            router.push(`/dashboard/sales?skuSearch=${encodeURIComponent(val)}`);
            return;
        }
        router.push(item.path);
    }, [router, setRange]);

    keydownHandlerRef.current = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "k") {
            e.preventDefault();
            searchRef.current?.focus();
            setSearchOpen(true);
        }
        if (e.key === "Escape") {
            setSearchOpen(false);
            setSearchQuery("");
            setAlertOpen(false);
            setUserMenuOpen(false);
            setPeriodOpen(false);
            setStatusOpen(false);
            searchRef.current?.blur();
        }
    };

    // Cmd+K / Ctrl+K shortcut
    useEffect(() => {
        const handler = (e: KeyboardEvent) => keydownHandlerRef.current(e);
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);

    useEffect(() => {
        if (!periodOpen) return;
        const idx = PERIOD_OPTIONS.findIndex((opt) => opt === range);
        setPeriodIdx(idx >= 0 ? idx : 0);

        const onPointerDown = (e: MouseEvent) => {
            if (!periodRef.current) return;
            if (!periodRef.current.contains(e.target as Node)) {
                setPeriodOpen(false);
            }
        };
        document.addEventListener("mousedown", onPointerDown);
        return () => document.removeEventListener("mousedown", onPointerDown);
    }, [periodOpen, range]);

    useEffect(() => {
        if (!statusOpen) return;
        const idx = STATUS_OPTIONS.findIndex((o) => o.value === status);
        setStatusIdx(idx >= 0 ? idx : 0);

        const onPointerDown = (e: MouseEvent) => {
            if (!statusRef.current) return;
            if (!statusRef.current.contains(e.target as Node)) {
                setStatusOpen(false);
            }
        };
        document.addEventListener("mousedown", onPointerDown);
        return () => document.removeEventListener("mousedown", onPointerDown);
    }, [statusOpen, status]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setSearchIdx(i => Math.min(i + 1, results.length - 1)); }
        if (e.key === "ArrowUp")   { e.preventDefault(); setSearchIdx(i => Math.max(i - 1, 0)); }
        if (e.key === "Enter" && results[searchIdx]) handleSelect(results[searchIdx]);
    };

    useEffect(() => { setSearchIdx(0); }, [searchQuery]);

    return (
        <div style={{ flexShrink: 0, zIndex: 100, position: "sticky", top: 0 }}>
            {/* TICKER + user menu */}
            <div style={{
                background: "rgba(255,255,255,0.015)", borderBottom: `1px solid ${DS.border}`,
                padding: "5px 22px", display: "flex", alignItems: "center", gap: 24,
                overflow: "hidden", backdropFilter: "blur(16px)",
            }}>
                {/* Scrolling ticker — continuous right-to-left */}
                <div
                    style={{
                        flex: 1, overflow: "hidden",
                        WebkitMaskImage: "linear-gradient(to right, transparent 0px, black 48px, black calc(100% - 48px), transparent 100%)",
                        maskImage:       "linear-gradient(to right, transparent 0px, black 48px, black calc(100% - 48px), transparent 100%)",
                    }}
                    onMouseEnter={() => { pauseRef.current = true; }}
                    onMouseLeave={() => { pauseRef.current = false; }}
                >
                    <div
                        ref={tickerRef}
                        style={{ display: "flex", alignItems: "center", willChange: "transform", width: "max-content" }}
                    >
                        {[...TICKER_ITEMS, ...TICKER_ITEMS].map((k, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, paddingRight: 36 }}>
                                <span style={{ fontSize: 9, color: DS.lo, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{k.label}</span>
                                <span style={{ fontSize: 11, color: k.c, fontWeight: 700, whiteSpace: "nowrap" }}>{k.value}</span>
                                {k.delta && (
                                    <span style={{
                                        fontSize: 9, fontWeight: 600, whiteSpace: "nowrap",
                                        color: k.delta.startsWith("+") ? DS.emerald : DS.rose,
                                        background: k.delta.startsWith("+") ? "rgba(16,185,129,0.12)" : "rgba(244,63,94,0.12)",
                                        padding: "1px 5px", borderRadius: 4,
                                    }}>{k.delta}</span>
                                )}
                                <div style={{ width: 1, height: 11, background: DS.border, flexShrink: 0 }} />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Search bar */}
                <div style={{ position: "relative", flexShrink: 0 }}>
                    <div style={{
                        display: "flex", alignItems: "center", gap: 7,
                        background: "rgba(255,255,255,0.04)", border: `1px solid ${searchOpen ? DS.borderHi : DS.border}`,
                        borderRadius: 9, padding: "4px 10px",
                        width: searchOpen ? 220 : 160,
                        transition: "width 0.2s, border-color 0.15s",
                    }}>
                        <span style={{ fontSize: 12, color: DS.lo, flexShrink: 0 }}>⌕</span>
                        <input
                            ref={searchRef}
                            value={searchQuery}
                            onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                            onFocus={() => setSearchOpen(true)}
                            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                            onKeyDown={handleKeyDown}
                            placeholder="Search…"
                            aria-label="Search pages, filters, orders, and SKU"
                            style={{
                                background: "transparent", border: "none", outline: "none",
                                color: DS.hi, fontSize: 11, fontFamily: "inherit", width: "100%",
                                caretColor: DS.sky,
                            }}
                        />
                        <span style={{ fontSize: 9, color: DS.lo, flexShrink: 0, letterSpacing: "0.05em", opacity: 0.7 }}>⌘K</span>
                    </div>

                    {searchOpen && results.length > 0 && (
                        <div style={{
                            position: "absolute", top: "calc(100% + 6px)", left: 0, width: 280,
                            background: "rgba(7,10,24,0.97)", border: `1px solid ${DS.border}`,
                            borderRadius: 12, padding: 6, backdropFilter: "blur(20px)",
                            zIndex: 300, boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
                        }}>
                            {results.map((item, i) => (
                                <button
                                    key={item.path}
                                    onMouseDown={() => handleSelect(item)}
                                    onMouseEnter={() => setSearchIdx(i)}
                                    style={{
                                        width: "100%", display: "flex", alignItems: "center", gap: 10,
                                        padding: "8px 10px", borderRadius: 8, border: "none",
                                        background: i === searchIdx ? "rgba(56,189,248,0.08)" : "transparent",
                                        cursor: "pointer", textAlign: "left",
                                        boxShadow: i === searchIdx ? `inset 3px 0 0 ${DS.sky}` : "none",
                                    }}
                                >
                                    <span style={{ fontSize: 14, flexShrink: 0, width: 20, textAlign: "center" }}>{item.icon}</span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 12, color: DS.hi, fontWeight: 500, lineHeight: 1.2 }}>{item.label}</div>
                                        <div style={{ fontSize: 10, color: DS.lo, marginTop: 1 }}>{item.desc}</div>
                                    </div>
                                    <span style={{
                                        fontSize: 9,
                                        color: item.type === "filter" ? DS.amber
                                             : item.type === "order-search" ? DS.violet
                                             : item.type === "sku-search"   ? DS.emerald
                                             : DS.sky,
                                        background: item.type === "filter" ? "rgba(245,158,11,0.1)"
                                                  : item.type === "order-search" ? "rgba(139,92,246,0.1)"
                                                  : item.type === "sku-search"   ? "rgba(16,185,129,0.1)"
                                                  : "rgba(56,189,248,0.1)",
                                        padding: "2px 6px", borderRadius: 10, flexShrink: 0, fontWeight: 600,
                                    }}>
                                        {item.type === "filter"       ? "FILTER"
                                       : item.type === "order-search" ? "ORDER"
                                       : item.type === "sku-search"   ? "SKU"
                                       : "PAGE"}
                                    </span>
                                </button>
                            ))}
                            <div style={{ borderTop: `1px solid ${DS.border}`, marginTop: 4, paddingTop: 4, padding: "4px 10px" }}>
                                <span style={{ fontSize: 9, color: DS.lo, letterSpacing: "0.06em" }}>↑↓ navigate · ↵ open · esc close</span>
                            </div>
                        </div>
                    )}

                    {searchOpen && searchQuery.trim().length === 1 && results.length === 0 && (
                        <div style={{
                            position: "absolute", top: "calc(100% + 6px)", left: 0, width: 260,
                            background: "rgba(7,10,24,0.97)", border: `1px solid ${DS.border}`,
                            borderRadius: 12, padding: "14px 16px", backdropFilter: "blur(20px)",
                            zIndex: 300, boxShadow: "0 12px 40px rgba(0,0,0,0.7)",
                            textAlign: "center",
                        }}>
                            <span style={{ fontSize: 11, color: DS.lo }}>Type at least 2 characters to search</span>
                        </div>
                    )}
                </div>

                {/* Alert bell */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                    {/* Alert bell */}
                    <div style={{ position: "relative" }}>
                        <button
                            onClick={() => { setAlertOpen(v => !v); setUserMenuOpen(false); }}
                            aria-label="Open alerts"
                            style={{
                                position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
                                width: 28, height: 28, borderRadius: 8,
                                background: alertOpen ? "rgba(244,63,94,0.12)" : "rgba(255,255,255,0.04)",
                                border: `1px solid ${activeAlerts.length > 0 ? (critCount > 0 ? DS.rose + "55" : DS.amber + "55") : DS.border}`,
                                cursor: "pointer", transition: "all 0.15s",
                            }}
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={activeAlerts.length > 0 ? (critCount > 0 ? DS.rose : DS.amber) : DS.lo} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                            </svg>
                            {activeAlerts.length > 0 && (
                                <span style={{
                                    position: "absolute", top: -4, right: -4,
                                    minWidth: 15, height: 15, borderRadius: 10,
                                    background: critCount > 0 ? DS.rose : DS.amber,
                                    color: "#fff", fontSize: 8, fontWeight: 800,
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    padding: "0 3px", lineHeight: 1,
                                    boxShadow: `0 0 6px ${critCount > 0 ? DS.rose : DS.amber}88`,
                                    animation: critCount > 0 ? "blink 2s infinite" : "none",
                                }}>
                                    {activeAlerts.length}
                                </span>
                            )}
                        </button>

                        {alertOpen && (
                            <div style={{
                                position: "absolute", top: "calc(100% + 8px)", right: 0, width: 320,
                                background: "rgba(7,10,24,0.98)", border: `1px solid ${DS.border}`,
                                borderRadius: 14, padding: 0, backdropFilter: "blur(24px)",
                                zIndex: 300, boxShadow: "0 16px 48px rgba(0,0,0,0.75)",
                                overflow: "hidden",
                            }}>
                                {/* Header */}
                                <div style={{ padding: "12px 14px 10px", borderBottom: `1px solid ${DS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={DS.rose} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                                            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                                        </svg>
                                        <span style={{ fontSize: 12, color: DS.hi, fontWeight: 700 }}>Threshold Alerts</span>
                                        <span style={{ fontSize: 9, color: DS.lo, fontWeight: 500 }}>( &gt;±30% )</span>
                                    </div>
                                    {activeAlerts.length > 0 && (
                                        <button onClick={() => setDismissed(ALERTS.map(a => a.id))} style={{ fontSize: 9, color: DS.lo, background: "transparent", border: "none", cursor: "pointer", padding: "2px 6px", borderRadius: 4 }}>
                                            Dismiss all
                                        </button>
                                    )}
                                </div>

                                {/* Alert list */}
                                <div style={{ maxHeight: 300, overflowY: "auto" }}>
                                    {activeAlerts.length === 0 ? (
                                        <div style={{ padding: "24px 16px", textAlign: "center" }}>
                                            <div style={{ fontSize: 22, marginBottom: 6 }}>✓</div>
                                            <p style={{ margin: 0, fontSize: 11, color: DS.emerald, fontWeight: 600 }}>All metrics within range</p>
                                            <p style={{ margin: "4px 0 0", fontSize: 10, color: DS.lo }}>No thresholds exceeded</p>
                                        </div>
                                    ) : (
                                        activeAlerts.map((alert, i) => {
                                            const sc = SEV_COLOR[alert.severity];
                                            return (
                                                <div key={alert.id} style={{
                                                    padding: "10px 14px",
                                                    borderBottom: i < activeAlerts.length - 1 ? `1px solid ${DS.border}` : "none",
                                                    background: "transparent",
                                                    display: "flex", alignItems: "flex-start", gap: 10,
                                                }}>
                                                    {/* Severity dot */}
                                                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: sc, flexShrink: 0, marginTop: 5, boxShadow: `0 0 5px ${sc}88` }} />
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                                                            <span style={{ fontSize: 11, color: DS.hi, fontWeight: 600 }}>{alert.label}</span>
                                                            <span style={{ fontSize: 10, fontWeight: 700, color: alert.value.startsWith("+") ? DS.rose : DS.amber }}>{alert.value}</span>
                                                        </div>
                                                        <div style={{ fontSize: 10, color: DS.mid, marginBottom: 3 }}>{alert.metric}</div>
                                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                                            <span style={{ fontSize: 9, color: DS.lo }}>{alert.note}</span>
                                                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                                <span style={{ fontSize: 9, color: DS.lo }}>{alert.time}</span>
                                                                <button
                                                                    onClick={() => { router.push(alert.path); setAlertOpen(false); }}
                                                                    style={{ fontSize: 9, color: DS.sky, background: "rgba(56,189,248,0.08)", border: `1px solid ${DS.sky}30`, borderRadius: 4, padding: "1px 6px", cursor: "pointer" }}
                                                                >
                                                                    View →
                                                                </button>
                                                                <button
                                                                    onClick={() => setDismissed(d => [...d, alert.id])}
                                                                    style={{ fontSize: 9, color: DS.lo, background: "transparent", border: "none", cursor: "pointer", padding: "1px 4px" }}
                                                                >
                                                                    ✕
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>

                                {/* Footer */}
                                {activeAlerts.length > 0 && (
                                    <div style={{ padding: "8px 14px", borderTop: `1px solid ${DS.border}`, display: "flex", justifyContent: "center" }}>
                                        <button onClick={() => { router.push("/dashboard/overview"); setAlertOpen(false); }} style={{ fontSize: 10, color: DS.sky, background: "transparent", border: "none", cursor: "pointer" }}>
                                            View full report →
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* User menu */}
                <div style={{ position: "relative", flexShrink: 0 }}>
                    <button onClick={() => setUserMenuOpen(!userMenuOpen)} aria-label="Open user menu" style={{
                        display: "flex", alignItems: "center", gap: 8,
                        background: "rgba(255,255,255,0.04)", border: `1px solid ${DS.border}`,
                        borderRadius: 9, padding: "4px 10px 4px 8px", cursor: "pointer", transition: "all .15s",
                    }}>
                        <div style={{ width: 22, height: 22, borderRadius: 6, background: rm.bg, border: `1px solid ${rm.color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: rm.color }}>{rm.icon}</div>
                        <span style={{ fontSize: 11, color: DS.hi }}>{session?.name?.split(" ")[0]}</span>
                        <span style={{ fontSize: 9, color: DS.lo }}>{userMenuOpen ? "▲" : "▼"}</span>
                    </button>

                    {userMenuOpen && (
                        <div style={{
                            position: "absolute", top: "calc(100% + 6px)", right: 0, width: 210,
                            background: "rgba(7,10,24,0.97)", border: `1px solid ${DS.border}`,
                            borderRadius: 12, padding: 10, backdropFilter: "blur(20px)",
                            zIndex: 200, boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
                        }}>
                            <div style={{ padding: "8px 10px", borderBottom: `1px solid ${DS.border}`, marginBottom: 6 }}>
                                <p style={{ margin: "0 0 3px", fontSize: 12, color: DS.hi, fontWeight: 600 }}>{session?.name}</p>
                                <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: rm.bg, borderRadius: 20, padding: "2px 8px" }}>
                                    <span style={{ fontSize: 10, color: rm.color }}>{rm.icon}</span>
                                    <span style={{ fontSize: 9, color: rm.color, fontFamily: "inherit", fontWeight: 700 }}>{rm.label}</span>
                                </div>
                            </div>
                            <button style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", color: DS.hi, fontSize: 11, fontFamily: "inherit", textAlign: "left" }}>
                                🔑 Change Password
                            </button>
                            <button onClick={async () => {
                                setUserMenuOpen(false);
                                try { await api.post('/auth/logout'); } catch { /* ignore */ }
                                logout();
                            }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", color: DS.rose, fontSize: 11, fontFamily: "inherit", textAlign: "left" }}>
                                ⎋ Sign out
                            </button>
                        </div>
                    )}
                </div>
            </div>
            {/* ── Filter bar ── */}
            <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "5px 22px",
                background: "rgba(4,6,15,0.7)",
                borderBottom: `1px solid ${DS.border}`,
                flexWrap: "wrap",
            }}>
                {/* Period label */}
                <span style={{ fontSize: 9, color: DS.lo, letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>Period</span>

                {/* Period dropdown */}
                <div ref={periodRef} style={{ position: "relative" }}>
                    <button
                        onClick={() => setPeriodOpen(v => !v)}
                        onKeyDown={(e) => {
                            if (e.key === "ArrowDown") { e.preventDefault(); setPeriodOpen(true); setPeriodIdx((i) => Math.min(i + 1, PERIOD_OPTIONS.length - 1)); }
                            if (e.key === "ArrowUp")   { e.preventDefault(); setPeriodOpen(true); setPeriodIdx((i) => Math.max(i - 1, 0)); }
                            if (e.key === "Enter" && periodOpen) { e.preventDefault(); const opt = PERIOD_OPTIONS[periodIdx]; if (opt) { setRange(opt); setPeriodOpen(false); } }
                        }}
                        aria-label="Select dashboard period"
                        aria-haspopup="listbox"
                        aria-expanded={periodOpen}
                        style={{
                            minWidth: 128, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                            padding: "6px 10px", borderRadius: 10,
                            border: `1px solid ${periodOpen ? DS.borderHi : DS.border}`,
                            background: periodOpen ? "linear-gradient(180deg, rgba(56,189,248,0.16), rgba(56,189,248,0.08))" : "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
                            color: periodOpen ? DS.sky : DS.hi, cursor: "pointer", fontFamily: "inherit",
                            fontSize: 11, letterSpacing: "0.04em", transition: "all 0.15s",
                            boxShadow: periodOpen ? "0 0 0 1px rgba(56,189,248,0.15) inset" : "none",
                        }}
                    >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12, opacity: 0.85 }}>◷</span>
                            <span style={{ fontWeight: 700, color: DS.sky }}>{range === "custom" ? "Custom" : range}</span>
                        </span>
                        <span style={{ fontSize: 10, color: periodOpen ? DS.sky : DS.mid }}>{periodOpen ? "▲" : "▼"}</span>
                    </button>

                    {periodOpen && (
                        <div role="listbox" style={{
                            position: "absolute", top: "calc(100% + 8px)", left: 0, minWidth: 200,
                            padding: 8, borderRadius: 12, border: `1px solid ${DS.border}`,
                            background: "linear-gradient(180deg, rgba(8,12,28,0.98), rgba(5,8,18,0.98))",
                            backdropFilter: "blur(16px)", boxShadow: "0 16px 48px rgba(0,0,0,0.65)",
                            zIndex: 220, display: "flex", flexDirection: "column", gap: 2,
                        }}>
                            {PERIOD_OPTIONS.map((opt, i) => {
                                const active = range === opt;
                                const highlighted = i === periodIdx;
                                return (
                                    <button
                                        key={opt}
                                        onMouseEnter={() => setPeriodIdx(i)}
                                        onClick={() => { setRange(opt); setPeriodOpen(false); }}
                                        onKeyDown={(e) => {
                                            if (e.key === "ArrowDown") { e.preventDefault(); setPeriodIdx((v) => Math.min(v + 1, PERIOD_OPTIONS.length - 1)); }
                                            if (e.key === "ArrowUp")   { e.preventDefault(); setPeriodIdx((v) => Math.max(v - 1, 0)); }
                                            if (e.key === "Escape")    { e.preventDefault(); setPeriodOpen(false); }
                                        }}
                                        aria-label={`Set period ${opt}`}
                                        style={{
                                            width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                                            padding: "7px 9px", borderRadius: 8, border: "none",
                                            background: active || highlighted ? "rgba(56,189,248,0.14)" : "transparent",
                                            color: active ? DS.sky : DS.hi, cursor: "pointer", fontFamily: "inherit",
                                            textAlign: "left", boxShadow: active ? `inset 2px 0 0 ${DS.sky}` : "none",
                                        }}
                                    >
                                        <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, letterSpacing: "0.04em" }}>{opt}</span>
                                        <span style={{ fontSize: 10, color: active ? DS.sky : DS.lo }}>{rangeLabel(opt)}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Custom date range inputs — shown only when custom is selected */}
                {range === "custom" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                            type="date"
                            value={customFrom}
                            onChange={e => { setCustomFrom(e.target.value); if (e.target.value && customTo) setCustom(e.target.value, customTo); }}
                            style={{
                                background: "rgba(255,255,255,0.04)", border: `1px solid ${DS.border}`,
                                borderRadius: 8, padding: "5px 8px", color: DS.hi, fontSize: 11,
                                fontFamily: "inherit", outline: "none", cursor: "pointer",
                                colorScheme: "dark",
                            }}
                        />
                        <span style={{ fontSize: 10, color: DS.lo }}>–</span>
                        <input
                            type="date"
                            value={customTo}
                            onChange={e => { setCustomTo(e.target.value); if (customFrom && e.target.value) setCustom(customFrom, e.target.value); }}
                            style={{
                                background: "rgba(255,255,255,0.04)", border: `1px solid ${DS.border}`,
                                borderRadius: 8, padding: "5px 8px", color: DS.hi, fontSize: 11,
                                fontFamily: "inherit", outline: "none", cursor: "pointer",
                                colorScheme: "dark",
                            }}
                        />
                    </div>
                )}

                <div style={{ width: 1, height: 16, background: DS.border, flexShrink: 0 }} />

                {/* Status label */}
                <span style={{ fontSize: 9, color: DS.lo, letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>Status</span>

                {/* Status dropdown */}
                <div ref={statusRef} style={{ position: "relative" }}>
                    <button
                        onClick={() => setStatusOpen(v => !v)}
                        aria-label="Filter by order status"
                        aria-haspopup="listbox"
                        aria-expanded={statusOpen}
                        style={{
                            minWidth: 120, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                            padding: "6px 10px", borderRadius: 10,
                            border: `1px solid ${statusOpen ? DS.borderHi : (status !== "all" ? DS.violet + "88" : DS.border)}`,
                            background: statusOpen ? "linear-gradient(180deg, rgba(139,92,246,0.16), rgba(139,92,246,0.08))" : (status !== "all" ? "rgba(139,92,246,0.08)" : "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))"),
                            cursor: "pointer", fontFamily: "inherit", fontSize: 11, letterSpacing: "0.04em", transition: "all 0.15s",
                        }}
                    >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 11, opacity: 0.85 }}>⊙</span>
                            <span style={{ fontWeight: 700, color: status !== "all" ? DS.violet : DS.hi }}>
                                {STATUS_OPTIONS.find(o => o.value === status)?.label ?? "All Orders"}
                            </span>
                        </span>
                        <span style={{ fontSize: 10, color: statusOpen ? DS.violet : DS.mid }}>{statusOpen ? "▲" : "▼"}</span>
                    </button>

                    {statusOpen && (
                        <div role="listbox" style={{
                            position: "absolute", top: "calc(100% + 8px)", left: 0, minWidth: 160,
                            padding: 8, borderRadius: 12, border: `1px solid ${DS.border}`,
                            background: "linear-gradient(180deg, rgba(8,12,28,0.98), rgba(5,8,18,0.98))",
                            backdropFilter: "blur(16px)", boxShadow: "0 16px 48px rgba(0,0,0,0.65)",
                            zIndex: 220, display: "flex", flexDirection: "column", gap: 2,
                        }}>
                            {STATUS_OPTIONS.map((opt, i) => {
                                const active = status === opt.value;
                                const highlighted = i === statusIdx;
                                return (
                                    <button
                                        key={opt.value}
                                        onMouseEnter={() => setStatusIdx(i)}
                                        onClick={() => { setStatus(opt.value); setStatusOpen(false); }}
                                        aria-label={`Filter by ${opt.label}`}
                                        style={{
                                            width: "100%", display: "flex", alignItems: "center", gap: 8,
                                            padding: "7px 9px", borderRadius: 8, border: "none",
                                            background: active || highlighted ? "rgba(139,92,246,0.14)" : "transparent",
                                            color: active ? DS.violet : DS.hi, cursor: "pointer", fontFamily: "inherit",
                                            textAlign: "left", boxShadow: active ? `inset 2px 0 0 ${DS.violet}` : "none",
                                        }}
                                    >
                                        <span style={{ fontSize: 11, fontWeight: active ? 700 : 500 }}>{opt.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 9, color: DS.lo, fontFamily: "inherit" }}>
                    {rangeLabel(range)}
                    {status !== "all" && <span style={{ color: DS.violet }}> · {STATUS_OPTIONS.find(o => o.value === status)?.label}</span>}
                </span>
            </div>
        </div>
    );
}
