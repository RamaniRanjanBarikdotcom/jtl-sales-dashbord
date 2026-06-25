"use client";

import { useState, useEffect, useRef } from "react";
import { useInventoryList, useInventoryKpis, useInventoryAlerts } from "@/hooks/useInventoryData";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";

export type InventoryDrawerType = "value" | "low_stock" | "out_of_stock" | "in_stock" | null;

const TITLE: Record<Exclude<InventoryDrawerType, null>, string> = {
    value:        "Total Stock Value",
    low_stock:    "Low Stock Items",
    out_of_stock: "Out of Stock Items",
    in_stock:     "In-Stock Rate",
};
const ACCENT: Record<Exclude<InventoryDrawerType, null>, string> = {
    value:        DS.sky,
    low_stock:    DS.amber,
    out_of_stock: DS.rose,
    in_stock:     DS.emerald,
};

export function InventoryKpiDrawer({ type, onClose }: { type: InventoryDrawerType; onClose: () => void }) {
    const open   = type !== null;
    const accent = type ? ACCENT[type] : DS.sky;

    const [search, setSearch]   = useState("");
    const [applied, setApplied] = useState("");
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setApplied(search), 400);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [search]);

    useEffect(() => { if (!open) { setSearch(""); setApplied(""); } }, [open]);
    useEffect(() => {
        const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [onClose]);

    const kpisQ   = useInventoryKpis();
    const alertsQ = useInventoryAlerts();
    const listQ   = useInventoryList();

    const kpis   = kpisQ.data;
    const alerts = alertsQ.data ?? [];
    const allRows = (listQ.data ?? []) as any[];

    // Filter based on drawer type + search
    const filtered = allRows.filter((r: any) => {
        const matchSearch = !applied || (r.product_name || r.name || "").toLowerCase().includes(applied.toLowerCase()) || (r.article_number || "").toLowerCase().includes(applied.toLowerCase());
        if (!matchSearch) return false;
        if (type === "low_stock")    return Number(r.total_available ?? r.stock_quantity ?? 0) > 0 && Number(r.total_available ?? r.stock_quantity ?? 0) <= 5;
        if (type === "out_of_stock") return Number(r.total_available ?? r.stock_quantity ?? 0) === 0;
        return true;
    });

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
                            <p style={{ margin: "2px 0 0", fontSize: 11, color: DS.lo }}>{listQ.isFetching ? "Loading…" : `${filtered.length} items`}</p>
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${DS.border}`, borderRadius: 8, padding: "5px 12px", color: DS.mid, cursor: "pointer", fontSize: 14 }}>✕</button>
                </div>

                {/* Body */}
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 24px", display: "flex", flexDirection: "column", gap: 16 }}>

                    {/* Search */}
                    <div style={{ background: DS.panel, border: `1px solid ${DS.border}`, borderRadius: 12, padding: "14px 16px" }}>
                        <div style={{ position: "relative" }}>
                            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: DS.lo, pointerEvents: "none" }}>🔍</span>
                            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product name or SKU…"
                                style={{ width: "100%", boxSizing: "border-box" as const, padding: "8px 10px 8px 30px", background: "rgba(255,255,255,0.04)", border: `1px solid ${DS.border}`, borderRadius: 8, color: DS.hi, fontSize: 12, outline: "none" }} />
                        </div>
                    </div>

                    {/* KPI strip */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
                        {[
                            { label: kpis?.valueLabel === "catalog (list price)" ? "Catalog Value" : "Total Value", value: eur(kpis?.totalValue ?? 0), c: DS.sky },
                            { label: "Low Stock",      value: String(kpis?.lowStockCount ?? 0),         c: DS.amber   },
                            { label: "Out of Stock",   value: String(kpis?.outOfStock ?? 0),            c: DS.rose    },
                            { label: "In-Stock Rate",  value: `${kpis?.avgSellThrough ?? 0}%`,          c: DS.emerald },
                        ].map(s => (
                            <div key={s.label} style={{ background: DS.panel, border: `1px solid ${DS.border}`, borderRadius: 10, padding: "12px 14px", borderTop: `2px solid ${s.c}33` }}>
                                <p style={{ margin: "0 0 4px", fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em" }}>{s.label}</p>
                                <p style={{ margin: 0, fontSize: 16, color: s.c, fontFamily: DS.mono, fontWeight: 700 }}>{s.value}</p>
                            </div>
                        ))}
                    </div>

                    {/* Alerts section (low/out of stock) */}
                    {(type === "low_stock" || type === "out_of_stock") && alerts.length > 0 && (
                        <div style={{ background: DS.panel, border: `1px solid ${accent}33`, borderRadius: 12, padding: "14px 16px" }}>
                            <p style={{ margin: "0 0 10px", fontSize: 11, color: DS.mid, fontWeight: 600 }}>
                                {type === "out_of_stock" ? "Out of Stock Items" : "Low Stock Alerts"}
                            </p>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                {alerts
                                    .filter(a => type === "out_of_stock" ? a.status === "out_of_stock" : a.status === "low_stock")
                                    .slice(0, 20)
                                    .map((a: any, i: number) => (
                                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "rgba(255,255,255,0.025)", borderRadius: 8, border: `1px solid ${accent}22` }}>
                                            <div>
                                                <div style={{ fontSize: 12, color: DS.hi, fontWeight: 500 }}>{a.product}</div>
                                                <div style={{ fontSize: 10, color: DS.lo, fontFamily: DS.mono, marginTop: 2 }}>{a.warehouse}</div>
                                            </div>
                                            <div style={{ textAlign: "right" }}>
                                                <div style={{ fontSize: 13, color: accent, fontFamily: DS.mono, fontWeight: 700 }}>{a.stock} units</div>
                                                <div style={{ fontSize: 9, color: DS.lo, marginTop: 2 }}>DSI: {a.dsi} days</div>
                                            </div>
                                        </div>
                                    ))
                                }
                            </div>
                        </div>
                    )}

                    {/* Full inventory table */}
                    <div style={{ background: DS.panel, border: `1px solid ${DS.border}`, borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 320, flex: 1 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 0.8fr 0.8fr 0.8fr", padding: "9px 16px", background: "rgba(255,255,255,0.025)", borderBottom: `1px solid ${DS.border}`, flexShrink: 0 }}>
                            {["Product", "SKU", "Stock", "List Price", "Status"].map(h => (
                                <span key={h} style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>{h}</span>
                            ))}
                        </div>
                        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                            {listQ.isFetching && filtered.length === 0 ? (
                                <div style={{ padding: "28px 16px", textAlign: "center", color: DS.lo, fontSize: 12 }}>Loading…</div>
                            ) : filtered.length === 0 ? (
                                <div style={{ padding: "28px 16px", textAlign: "center", color: DS.lo, fontSize: 12 }}>No items found.</div>
                            ) : filtered.slice(0, 200).map((r: any, i: number) => {
                                const stock = Number(r.stock_quantity ?? r.total_available ?? 0);
                                const isOut = stock === 0;
                                const isLow = !isOut && stock <= 5;
                                const statusColor = isOut ? DS.rose : isLow ? DS.amber : DS.emerald;
                                const statusLabel = isOut ? "Out of Stock" : isLow ? "Low Stock" : "In Stock";
                                return (
                                    <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 0.8fr 0.8fr 0.8fr", alignItems: "center", minHeight: 40, padding: "6px 16px", borderBottom: `1px solid ${DS.border}`, background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.012)" }}>
                                        <div style={{ overflow: "hidden" }}>
                                            <div style={{ fontSize: 11, color: DS.hi, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.product_name || r.name || "—"}</div>
                                        </div>
                                        <span style={{ fontSize: 10, color: DS.lo, fontFamily: DS.mono }}>{r.article_number || "—"}</span>
                                        <span style={{ fontSize: 12, color: isOut ? DS.rose : isLow ? DS.amber : DS.hi, fontFamily: DS.mono, fontWeight: 600 }}>{stock.toLocaleString()}</span>
                                        <span style={{ fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{eur(Number(r.list_price_gross ?? r.list_price_net ?? 0))}</span>
                                        <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 20, fontWeight: 600, background: `${statusColor}20`, color: statusColor, whiteSpace: "nowrap" }}>{statusLabel}</span>
                                    </div>
                                );
                            })}
                        </div>
                        <div style={{ padding: "10px 16px", borderTop: `1px solid ${DS.border}`, flexShrink: 0, background: "rgba(255,255,255,0.015)" }}>
                            <span style={{ fontSize: 11, color: DS.lo }}>{filtered.length} items shown</span>
                        </div>
                    </div>

                </div>
            </div>
        </>
    );
}
