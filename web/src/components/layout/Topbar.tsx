"use client";

import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import { useStore, ROLE_META, useFilterStore } from "@/lib/store";
import { DS } from "@/lib/design-system";
import api from "@/lib/api";

const HAS_API = () => !!process.env.NEXT_PUBLIC_API_URL;

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

const SYNC_STATUS = "ok";

const TICKER_ITEMS = [
    { label: "Revenue YTD",   value: "€2.647M",     delta: "+18.4%", c: DS.sky },
    { label: "Orders YTD",    value: "29,130",       delta: "+14.2%", c: DS.violet },
    { label: "Avg Order",     value: "€90.88",       delta: "+3.7%",  c: DS.emerald },
    { label: "Top Region",    value: "East · €341K", delta: "+19.4%", c: DS.amber },
    { label: "Active SKUs",   value: "1,842",        delta: "+6.1%",  c: DS.cyan },
    { label: "Gross Margin",  value: "62.4%",        delta: "+1.2%",  c: DS.lime },
    { label: "New Customers", value: "3,418",        delta: "+9.7%",  c: DS.violet },
    { label: "Churn Rate",    value: "1.8%",         delta: "-0.3%",  c: DS.rose },
    { label: "Sync Status",   value: SYNC_STATUS === "ok" ? "All OK" : "1 Error", delta: "", c: DS.emerald },
];

// Alerts: metrics that spiked / dropped beyond ±30%
const ALERTS = [
    { id: 1, severity: "critical", label: "Returns Spike",        metric: "Returns Rate",     value: "+38.2%",  note: "West region · last 24h",     path: "/dashboard/regional",  time: "2m ago" },
    { id: 2, severity: "critical", label: "Ad Spend Overrun",     metric: "Marketing Spend",  value: "+43.7%",  note: "Campaign · Summer Sale",     path: "/dashboard/marketing", time: "11m ago" },
    { id: 3, severity: "warning",  label: "Stock Level Drop",     metric: "Inventory SKU #84",value: "-31.5%",  note: "Warehouse B · reorder now",  path: "/dashboard/inventory", time: "34m ago" },
    { id: 4, severity: "warning",  label: "Bounce Rate Surge",    metric: "Site Bounce Rate", value: "+33.1%",  note: "Mobile · iOS traffic",       path: "/dashboard/marketing", time: "1h ago" },
    { id: 5, severity: "info",     label: "Revenue Acceleration", metric: "Revenue (East)",   value: "+41.0%",  note: "Above 30% threshold",        path: "/dashboard/regional",  time: "2h ago" },
];

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

export function Topbar() {
    const { session, logout } = useStore();
    const { setRange } = useFilterStore();
    const role = session?.role || "viewer";
    const rm = ROLE_META[role];
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const [alertOpen, setAlertOpen] = useState(false);
    const [dismissed, setDismissed] = useState<number[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchIdx, setSearchIdx] = useState(0);
    const searchRef = useRef<HTMLInputElement>(null);
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

    // Cmd+K / Ctrl+K shortcut
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
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
                searchRef.current?.blur();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);

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
                    <button onClick={() => setUserMenuOpen(!userMenuOpen)} style={{
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
                                if (HAS_API()) {
                                    try { await api.post('/auth/logout'); } catch { /* ignore */ }
                                }
                                logout();
                            }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", color: DS.rose, fontSize: 11, fontFamily: "inherit", textAlign: "left" }}>
                                ⎋ Sign out
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
