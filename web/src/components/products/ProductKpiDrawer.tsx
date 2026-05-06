"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useProductsList, useProductsKpis } from "@/hooks/useProductsData";
import { useFilterStore } from "@/lib/store";
import { ChartTip } from "@/components/charts/recharts/ChartTip";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";

export type ProductDrawerType = "top_rev" | "avg_margin" | "skus" | null;

const TITLE: Record<Exclude<ProductDrawerType, null>, string> = {
    top_rev:    "Top Product Revenue",
    avg_margin: "Avg Margin Detail",
    skus:       "Product Catalog",
};
const ACCENT: Record<Exclude<ProductDrawerType, null>, string> = {
    top_rev:    DS.violet,
    avg_margin: DS.amber,
    skus:       DS.sky,
};

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
            <span style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
            <input type="date" value={value} onChange={e => onChange(e.target.value)}
                style={{ padding: "7px 10px", background: "rgba(255,255,255,0.04)", border: `1px solid ${DS.border}`, borderRadius: 8, color: DS.hi, fontSize: 12, outline: "none", fontFamily: DS.mono, colorScheme: "dark", width: "100%", boxSizing: "border-box" as const }} />
        </div>
    );
}

export function ProductKpiDrawer({ type, onClose }: { type: ProductDrawerType; onClose: () => void }) {
    const open   = type !== null;
    const accent = type ? ACCENT[type] : DS.violet;

    const [dateFrom, setDateFrom] = useState("");
    const [dateTo,   setDateTo]   = useState("");
    const [search,   setSearch]   = useState("");
    const [page,     setPage]     = useState(1);
    const [appliedSearch, setAppliedSearch] = useState("");
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const toParams = useFilterStore(s => s.toParams);
    const globalParams = toParams();

    // Build filter params: drawer date overrides global range
    const filterParams = new URLSearchParams(globalParams);
    if (dateFrom) { filterParams.set("from", dateFrom); filterParams.delete("range"); }
    if (dateTo)   { filterParams.set("to",   dateTo);   filterParams.delete("range"); }

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => { setPage(1); setAppliedSearch(search); }, 400);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [search]);

    useEffect(() => { if (!open) { setDateFrom(""); setDateTo(""); setSearch(""); setAppliedSearch(""); setPage(1); } }, [open]);
    useEffect(() => {
        const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [onClose]);

    const listQ  = useProductsList({ page, limit: 30, search: appliedSearch || undefined, params: filterParams });
    const kpisQ  = useProductsKpis(filterParams);
    const rows   = listQ.data?.rows ?? [];
    const total  = listQ.data?.total ?? 0;
    const kpis   = kpisQ.data;
    const totalPages = Math.max(1, Math.ceil(total / 30));

    // Build sparkline data from product list revenue
    const chartData = rows.slice(0, 14).map((r, i) => ({ label: r.name?.slice(0, 10) || `P${i+1}`, rev: r.rev, margin: r.margin }));

    const hasFilter = !!(dateFrom || dateTo || appliedSearch);

    return (
        <>
            <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.6)", opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none", transition: "opacity 0.25s", backdropFilter: "blur(3px)" }} />
            <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 50, width: 740, maxWidth: "96vw", background: DS.surface, borderLeft: `1px solid ${accent}55`, transform: open ? "translateX(0)" : "translateX(100%)", transition: "transform 0.3s cubic-bezier(0.4,0,0.2,1)", display: "flex", flexDirection: "column", boxShadow: "-24px 0 80px rgba(0,0,0,0.65)" }}>

                {/* Header */}
                <div style={{ padding: "16px 24px 12px", borderBottom: `1px solid ${DS.border}`, background: DS.surface, position: "sticky", top: 0, zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 3, height: 20, borderRadius: 2, background: accent }} />
                        <div>
                            <h2 style={{ margin: 0, fontSize: 15, color: DS.hi, fontWeight: 600 }}>{type ? TITLE[type] : ""}</h2>
                            <p style={{ margin: "2px 0 0", fontSize: 11, color: DS.lo }}>{listQ.isFetching ? "Loading…" : `${total} products${hasFilter ? " · filters active" : ""}`}</p>
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        {hasFilter && (
                            <button onClick={() => { setDateFrom(""); setDateTo(""); setSearch(""); setAppliedSearch(""); setPage(1); }} style={{ padding: "5px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, background: `${DS.rose}15`, border: `1px solid ${DS.rose}40`, color: DS.rose }}>Clear</button>
                        )}
                        <button onClick={onClose} style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${DS.border}`, borderRadius: 8, padding: "5px 12px", color: DS.mid, cursor: "pointer", fontSize: 14 }}>✕</button>
                    </div>
                </div>

                {/* Body */}
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

                    {/* Filters */}
                    <div style={{ background: DS.panel, border: `1px solid ${DS.border}`, borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                        <span style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>Filters</span>
                        <div style={{ display: "flex", gap: 10 }}>
                            <DateInput label="From date" value={dateFrom} onChange={v => { setDateFrom(v); setPage(1); }} />
                            <DateInput label="To date"   value={dateTo}   onChange={v => { setDateTo(v);   setPage(1); }} />
                        </div>
                        <div style={{ position: "relative" }}>
                            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: DS.lo, pointerEvents: "none" }}>📦</span>
                            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product name or SKU…"
                                style={{ width: "100%", boxSizing: "border-box" as const, padding: "8px 10px 8px 30px", background: "rgba(255,255,255,0.04)", border: `1px solid ${DS.border}`, borderRadius: 8, color: DS.hi, fontSize: 12, outline: "none", fontFamily: DS.body }} />
                        </div>
                    </div>

                    {/* KPI strip */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
                        {[
                            { label: "Active SKUs",   value: (kpis?.activeSkus ?? 0).toLocaleString(),      c: DS.sky     },
                            { label: "Top Prod Rev",  value: eur(kpis?.topCategoryRev ?? 0),                c: DS.violet  },
                            { label: "Avg Margin",    value: `${kpis?.avgMargin ?? 0}%`,                    c: DS.amber   },
                            { label: "Showing",       value: total.toLocaleString() + " SKUs",              c: DS.emerald },
                        ].map(s => (
                            <div key={s.label} style={{ background: DS.panel, border: `1px solid ${DS.border}`, borderRadius: 10, padding: "12px 14px", borderTop: `2px solid ${s.c}33` }}>
                                <p style={{ margin: "0 0 4px", fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em" }}>{s.label}</p>
                                <p style={{ margin: 0, fontSize: 16, color: s.c, fontFamily: DS.mono, fontWeight: 700 }}>{s.value}</p>
                            </div>
                        ))}
                    </div>

                    {/* Chart */}
                    <div style={{ background: DS.panel, border: `1px solid ${DS.border}`, borderRadius: 12, padding: "14px 16px" }}>
                        <p style={{ margin: "0 0 12px", fontSize: 11, color: DS.mid, fontWeight: 600 }}>Revenue by Product (top 14)</p>
                        <ResponsiveContainer width="100%" height={140}>
                            <AreaChart data={chartData} margin={{ top: 2, right: 4, bottom: 0, left: 0 }}>
                                <defs>
                                    <linearGradient id="prodDrawerGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={accent} stopOpacity={0.35} />
                                        <stop offset="100%" stopColor={accent} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                <XAxis dataKey="label" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                                <YAxis tickFormatter={v => eur(v)} tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={80} />
                                <Tooltip content={<ChartTip />} />
                                <Area type="monotone" dataKey="rev" name="Revenue" stroke={accent} strokeWidth={2} fill="url(#prodDrawerGrad)" dot={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Table */}
                    <div style={{ background: DS.panel, border: `1px solid ${DS.border}`, borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 320, flex: 1 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "0.4fr 2fr 1fr 0.8fr 0.8fr 0.7fr", padding: "9px 16px", background: "rgba(255,255,255,0.025)", borderBottom: `1px solid ${DS.border}`, flexShrink: 0 }}>
                            {["#", "Product", "Revenue", "Units", "Margin", "Trend"].map(h => (
                                <span key={h} style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>{h}</span>
                            ))}
                        </div>
                        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                            {listQ.isFetching && rows.length === 0 ? (
                                <div style={{ padding: "28px 16px", textAlign: "center", color: DS.lo, fontSize: 12 }}>Loading…</div>
                            ) : rows.length === 0 ? (
                                <div style={{ padding: "28px 16px", textAlign: "center", color: DS.lo, fontSize: 12 }}>No products found.</div>
                            ) : rows.map((r, i) => (
                                <div key={i} style={{ display: "grid", gridTemplateColumns: "0.4fr 2fr 1fr 0.8fr 0.8fr 0.7fr", alignItems: "center", minHeight: 40, padding: "6px 16px", borderBottom: `1px solid ${DS.border}`, background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)" }}>
                                    <span style={{ fontSize: 11, color: DS.lo, fontFamily: DS.mono }}>{(page - 1) * 30 + i + 1}</span>
                                    <div style={{ overflow: "hidden" }}>
                                        <div style={{ fontSize: 11, color: DS.hi, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                                        <div style={{ fontSize: 9, color: DS.lo, fontFamily: DS.mono, marginTop: 1 }}>{r.article_number || r.cat}</div>
                                    </div>
                                    <span style={{ fontSize: 12, color: accent, fontFamily: DS.mono, fontWeight: 600 }}>{eur(r.rev)}</span>
                                    <span style={{ fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{r.units.toLocaleString()}</span>
                                    <span style={{ fontSize: 11, color: r.margin >= 30 ? DS.emerald : DS.amber, fontFamily: DS.mono }}>{r.margin}%</span>
                                    <span style={{ fontSize: 11, fontFamily: DS.mono, color: r.trend >= 0 ? DS.emerald : DS.rose }}>{r.trend >= 0 ? "▲" : "▼"}{Math.abs(r.trend)}%</span>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderTop: `1px solid ${DS.border}`, flexShrink: 0, background: "rgba(255,255,255,0.015)" }}>
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{ padding: "5px 14px", borderRadius: 7, background: "rgba(255,255,255,0.05)", border: `1px solid ${DS.border}`, color: page <= 1 ? DS.lo : DS.mid, fontSize: 11, cursor: page <= 1 ? "default" : "pointer", opacity: page <= 1 ? 0.4 : 1 }}>← Prev</button>
                            <span style={{ fontSize: 11, color: DS.lo }}>Page {page} of {totalPages} · {total} products</span>
                            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{ padding: "5px 14px", borderRadius: 7, background: "rgba(255,255,255,0.05)", border: `1px solid ${DS.border}`, color: page >= totalPages ? DS.lo : DS.mid, fontSize: 11, cursor: page >= totalPages ? "default" : "pointer", opacity: page >= totalPages ? 0.4 : 1 }}>Next →</button>
                        </div>
                    </div>

                </div>
            </div>
        </>
    );
}
