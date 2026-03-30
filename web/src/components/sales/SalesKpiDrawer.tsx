"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
    AreaChart, Area, BarChart, Bar, LineChart, Line,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { useSalesOrders, useSalesDaily, OrderFilters, OrderRow } from "@/hooks/useSalesData";
import { ChartTip } from "@/components/charts/recharts/ChartTip";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";

export type KpiType = "revenue" | "orders" | "aov" | null;

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
};

const TITLE: Record<Exclude<KpiType, null>, string> = {
    revenue: "Revenue Detail",
    orders:  "Orders Detail",
    aov:     "Avg Order Value Detail",
};

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

    // raw input state — initialised from props when provided
    const [dateFrom,  setDateFrom]  = useState("");
    const [dateTo,    setDateTo]    = useState("");
    const [orderNum,  setOrderNum]  = useState(initialOrderNum);
    const [sku,       setSku]       = useState(initialSku);
    const [page,      setPage]      = useState(1);

    // applied filter state (sent to API / used for client-side filter)
    const [applied, setApplied] = useState<OrderFilters>({
        orderNumber: initialOrderNum || undefined,
        sku:         initialSku      || undefined,
    });

    // debounce refs for text inputs
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const buildFilters = useCallback((): OrderFilters => ({
        from:        dateFrom || undefined,
        to:          dateTo   || undefined,
        orderNumber: orderNum || undefined,
        sku:         sku      || undefined,
    }), [dateFrom, dateTo, orderNum, sku]);

    // date changes → apply immediately
    useEffect(() => {
        setPage(1);
        setApplied(f => ({ ...f, from: dateFrom || undefined, to: dateTo || undefined }));
    }, [dateFrom, dateTo]);

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
        setPage(1); setApplied({});
    }, []);

    // when new search values arrive from URL params, update state immediately
    useEffect(() => {
        if (initialOrderNum) { setOrderNum(initialOrderNum); setApplied(f => ({ ...f, orderNumber: initialOrderNum })); }
        if (initialSku)      { setSku(initialSku);           setApplied(f => ({ ...f, sku: initialSku })); }
    }, [initialOrderNum, initialSku]);

    // reset when drawer closes
    useEffect(() => { if (!open) reset(); }, [open, reset]);

    // Esc key
    useEffect(() => {
        const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [onClose]);

    // data
    const ordersQ   = useSalesOrders({ ...applied, page, limit: 30 });
    const dailyQ    = useSalesDaily();
    const allOrders = ordersQ.data?.rows  ?? [];
    const total     = ordersQ.data?.total ?? 0;
    const daily     = dailyQ.data ?? [];
    const totalPages = Math.max(1, Math.ceil(total / 30));

    // client-side filter on top (covers demo mode where API returns fixed mock data)
    const hasTextFilter = !!(applied.orderNumber || applied.sku);
    const orders: OrderRow[] = hasTextFilter
        ? allOrders.filter(r => {
            const onMatch = !applied.orderNumber || r.order_number?.toLowerCase().includes(applied.orderNumber.toLowerCase());
            return onMatch; // SKU needs server-side join; show what we have
        })
        : allOrders;

    // chart series — last 14 days
    const chartData = daily.slice(-14).map(d => ({
        label: `D${d.d}`,
        rev:   d.rev,
        ord:   d.ord,
        aov:   d.ord > 0 ? Math.round(d.rev / d.ord) : 0,
    }));

    // summary stats from current page
    const sumRevenue = orders.reduce((s, r) => s + Number(r.gross_revenue), 0);
    const sumOrders  = orders.length;
    const avgAOV     = sumOrders > 0 ? sumRevenue / sumOrders : 0;
    const avgMarginV = sumOrders > 0 ? orders.reduce((s, r) => s + Number(r.gross_margin ?? 0), 0) / sumOrders : 0;

    const hasActiveFilter = !!(applied.from || applied.to || applied.orderNumber || applied.sku);

    return (
        <>
            {/* Backdrop */}
            <div onClick={onClose} style={{
                position: "fixed", inset: 0, zIndex: 40,
                background: "rgba(0,0,0,0.6)",
                opacity: open ? 1 : 0,
                pointerEvents: open ? "auto" : "none",
                transition: "opacity 0.25s",
                backdropFilter: "blur(3px)",
            }} />

            {/* Panel */}
            <div style={{
                position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 50,
                width: 740, maxWidth: "96vw",
                background: DS.surface,
                borderLeft: `1px solid ${accent}55`,
                transform: open ? "translateX(0)" : "translateX(100%)",
                transition: "transform 0.3s cubic-bezier(0.4,0,0.2,1)",
                display: "flex", flexDirection: "column",
                boxShadow: `-24px 0 80px rgba(0,0,0,0.65)`,
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
                                {ordersQ.isFetching
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
                            borderRadius: 8, padding: "5px 12px", color: DS.mid, cursor: "pointer", fontSize: 14,
                        }}>✕</button>
                    </div>
                </div>

                {/* ── Scrollable body ─────────────────────────────────────── */}
                <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

                    {/* ── Filter bar ─────────────────────────────────────── */}
                    <div style={{
                        background: DS.panel, border: `1px solid ${DS.border}`,
                        borderRadius: 12, padding: "14px 16px",
                        display: "flex", flexDirection: "column", gap: 10,
                    }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
                                Filters
                            </span>
                            <span style={{ fontSize: 9, color: DS.lo }}>Press Enter or wait 400ms to search</span>
                        </div>

                        {/* Date row */}
                        <div style={{ display: "flex", gap: 10 }}>
                            <DateInput label="From date" value={dateFrom} onChange={setDateFrom} />
                            <DateInput label="To date"   value={dateTo}   onChange={setDateTo}   />
                        </div>

                        {/* Text search row */}
                        <div style={{ display: "flex", gap: 10 }}>
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

                    {/* ── KPI summary strip ───────────────────────────────── */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
                        {[
                            { label: "Revenue",    value: eur(sumRevenue),               c: DS.sky     },
                            { label: "Orders",     value: sumOrders.toLocaleString(),      c: DS.violet  },
                            { label: "Avg AOV",    value: eur(avgAOV),                    c: DS.emerald },
                            { label: "Avg Margin", value: `${avgMarginV.toFixed(1)}%`,    c: DS.amber   },
                        ].map(s => (
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
                        <p style={{ margin: "0 0 12px", fontSize: 11, color: DS.mid, fontWeight: 600 }}>
                            {type === "revenue" ? "Daily Revenue — last 14 days" :
                             type === "orders"  ? "Daily Orders — last 14 days"  :
                                                  "Daily Avg Order Value — last 14 days"}
                        </p>
                        <ResponsiveContainer width="100%" height={140}>
                            {type === "orders" ? (
                                <BarChart data={chartData} margin={{ top: 2, right: 4, bottom: 0, left: 0 }} barSize={12}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                    <XAxis dataKey="label" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={30} />
                                    <Tooltip content={<ChartTip />} />
                                    <Bar dataKey="ord" name="Orders" radius={[3, 3, 0, 0]}>
                                        {chartData.map((_, i) => <Cell key={i} fill={`rgba(139,92,246,${0.45 + i * 0.04})`} />)}
                                    </Bar>
                                </BarChart>
                            ) : type === "aov" ? (
                                <LineChart data={chartData} margin={{ top: 2, right: 4, bottom: 0, left: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                    <XAxis dataKey="label" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                                    <YAxis tickFormatter={v => `€${v}`} tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={44} />
                                    <Tooltip content={<ChartTip />} />
                                    <Line type="monotone" dataKey="aov" name="Avg Order Value" stroke={DS.emerald} strokeWidth={2} dot={false} />
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
                                </AreaChart>
                            )}
                        </ResponsiveContainer>
                    </div>

                    {/* ── Orders table ─────────────────────────────────────── */}
                    <div style={{ background: DS.panel, border: `1px solid ${DS.border}`, borderRadius: 12, overflow: "hidden" }}>

                        {/* Table head */}
                        <div style={{
                            display: "grid",
                            gridTemplateColumns: "1.6fr 0.8fr 0.9fr 0.85fr 0.85fr 0.85fr 0.6fr",
                            padding: "9px 16px",
                            background: "rgba(255,255,255,0.025)",
                            borderBottom: `1px solid ${DS.border}`,
                        }}>
                            {["Order #", "Date", "Revenue", "Payment", "Shipping", "Status", "Margin"].map(h => (
                                <span key={h} style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>{h}</span>
                            ))}
                        </div>

                        {/* Rows */}
                        {ordersQ.isFetching && orders.length === 0 ? (
                            <div style={{ padding: "28px 16px", textAlign: "center", color: DS.lo, fontSize: 12 }}>Fetching orders…</div>
                        ) : orders.length === 0 ? (
                            <div style={{ padding: "28px 16px", textAlign: "center" }}>
                                <p style={{ margin: 0, fontSize: 13, color: DS.lo }}>No orders match the current filters.</p>
                                {hasActiveFilter && (
                                    <button onClick={reset} style={{ marginTop: 10, fontSize: 11, color: DS.sky, background: "transparent", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                                        Clear all filters
                                    </button>
                                )}
                            </div>
                        ) : (
                            orders.map((row, i) => (
                                <div key={i} style={{
                                    display: "grid",
                                    gridTemplateColumns: "1.6fr 0.8fr 0.9fr 0.85fr 0.85fr 0.85fr 0.6fr",
                                    padding: "9px 16px",
                                    borderBottom: i < orders.length - 1 ? `1px solid ${DS.border}` : "none",
                                    background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                                }}>
                                    <div style={{ overflow: "hidden" }}>
                                        <div style={{ fontSize: 11, color: accent, fontFamily: DS.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {row.order_number || "—"}
                                        </div>
                                        {row.external_order_number && (
                                            <div style={{ fontSize: 9, color: DS.lo, fontFamily: DS.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
                                                {row.external_order_number}
                                            </div>
                                        )}
                                    </div>
                                    <span style={{ fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>
                                        {row.order_date ? String(row.order_date).slice(0, 10) : "—"}
                                    </span>
                                    <span style={{ fontSize: 12, color: DS.hi, fontFamily: DS.mono, fontWeight: 600 }}>
                                        {eur(Number(row.gross_revenue) || 0)}
                                    </span>
                                    <span style={{ fontSize: 10, color: DS.mid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {row.payment_method || "—"}
                                    </span>
                                    <span style={{ fontSize: 10, color: DS.mid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {row.shipping_method || "—"}
                                    </span>
                                    <span style={{
                                        fontSize: 10, fontWeight: 600,
                                        color: STATUS_COLOR[(row.status ?? "").toLowerCase()] ?? DS.mid,
                                    }}>
                                        {row.status ? row.status.charAt(0).toUpperCase() + row.status.slice(1) : "—"}
                                    </span>
                                    <span style={{
                                        fontSize: 11, fontFamily: DS.mono,
                                        color: Number(row.gross_margin) >= 30 ? DS.emerald : DS.amber,
                                    }}>
                                        {row.gross_margin != null ? `${Number(row.gross_margin).toFixed(1)}%` : "—"}
                                    </span>
                                </div>
                            ))
                        )}

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div style={{
                                display: "flex", justifyContent: "space-between", alignItems: "center",
                                padding: "10px 16px", borderTop: `1px solid ${DS.border}`,
                            }}>
                                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{
                                    padding: "5px 14px", borderRadius: 7,
                                    background: "rgba(255,255,255,0.05)", border: `1px solid ${DS.border}`,
                                    color: page <= 1 ? DS.lo : DS.mid, fontSize: 11,
                                    cursor: page <= 1 ? "default" : "pointer",
                                    opacity: page <= 1 ? 0.4 : 1,
                                }}>← Prev</button>
                                <span style={{ fontSize: 11, color: DS.lo }}>Page {page} of {totalPages} · {total} orders</span>
                                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{
                                    padding: "5px 14px", borderRadius: 7,
                                    background: "rgba(255,255,255,0.05)", border: `1px solid ${DS.border}`,
                                    color: page >= totalPages ? DS.lo : DS.mid, fontSize: 11,
                                    cursor: page >= totalPages ? "default" : "pointer",
                                    opacity: page >= totalPages ? 0.4 : 1,
                                }}>Next →</button>
                            </div>
                        )}
                    </div>

                </div>
            </div>
        </>
    );
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
