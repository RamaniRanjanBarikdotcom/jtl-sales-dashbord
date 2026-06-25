"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import { useProductsCategories, useProductsList, type ProductRow } from "@/hooks/useProductsData";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const TREEMAP_COLORS = [
    DS.sky, DS.violet, DS.emerald, DS.amber, DS.rose, DS.cyan, DS.indigo, DS.orange, DS.lime
];

type SortField = "total_revenue" | "total_units" | "margin_pct" | "name";
type SortOrder = "ASC" | "DESC";
type CategoryShare = { name: string; v: number; c: string };
type TreemapPoint = { name?: string; value?: number; data?: { rev?: number } };

function SelectField({
    value,
    onChange,
    children,
}: {
    value: string;
    onChange: (v: string) => void;
    children: React.ReactNode;
}) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{
                fontSize: 11,
                padding: "8px 10px",
                borderRadius: 8,
                background: "rgba(255,255,255,0.05)",
                border: `1px solid ${DS.border}`,
                color: DS.hi,
                outline: "none",
                minWidth: 140,
            }}
        >
            {children}
        </select>
    );
}

export function ProductTreemapDrawer({
    open,
    onClose,
    initialCategory = "",
}: {
    open: boolean;
    onClose: () => void;
    initialCategory?: string;
}) {
    const [mounted, setMounted] = useState(false);
    const [search, setSearch] = useState("");
    const [category, setCategory] = useState("");
    const [sort, setSort] = useState<SortField>("total_revenue");
    const [order, setOrder] = useState<SortOrder>("DESC");
    const [page, setPage] = useState(1);

    useEffect(() => setMounted(true), []);

    useEffect(() => {
        if (!open) return;
        setPage(1);
        setCategory(initialCategory || "");
    }, [open, initialCategory]);

    useEffect(() => {
        if (!open) return;
        const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [open, onClose]);

    const categoriesQ = useProductsCategories();
    const categories = (categoriesQ.data ?? []) as CategoryShare[];
    const productsQ = useProductsList({
        page,
        limit: 30,
        search: search || undefined,
        category: category || undefined,
        sort,
        order,
    });
    const data = productsQ.data ?? { rows: [], total: 0, page: 1, limit: 30 };
    const rows = (data.rows ?? []) as ProductRow[];
    const total = Number(data.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / (data.limit || 30)));

    const pageRevenue = rows.reduce((s: number, r: ProductRow) => s + (Number(r.rev) || 0), 0);
    const pageUnits = rows.reduce((s: number, r: ProductRow) => s + (Number(r.units) || 0), 0);
    const avgMargin = rows.length
        ? rows.reduce((s: number, r: ProductRow) => s + (Number(r.margin) || 0), 0) / rows.length
        : 0;

    const treemapRows = useMemo(() => {
        const byCategory = new Map<string, number>();
        for (const r of rows) {
            const cat = r.cat || "Uncategorized";
            byCategory.set(cat, (byCategory.get(cat) || 0) + (Number(r.rev) || 0));
        }
        const totalRev = Array.from(byCategory.values()).reduce((a, b) => a + b, 0);
        return Array.from(byCategory.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([name, rev], i) => ({
                name,
                rev,
                share: totalRev > 0 ? Math.round(rev / totalRev * 100) : 0,
                color: TREEMAP_COLORS[i % TREEMAP_COLORS.length],
            }));
    }, [rows]);

    const treemapOption = useMemo(() => ({
        backgroundColor: "transparent",
        tooltip: {
            formatter: (p: TreemapPoint) => `${p.name ?? "Unknown"}<br/>${eur(p.data?.rev || 0)} · ${p.value ?? 0}%`,
        },
        series: [{
            type: "treemap",
            left: 0, right: 0, top: 0, bottom: 0,
            roam: false,
            nodeClick: false,
            breadcrumb: { show: false },
            data: treemapRows.map((x) => ({
                name: x.name,
                value: x.share,
                rev: x.rev,
                itemStyle: {
                    color: x.color,
                    borderWidth: 2,
                    borderColor: "rgba(2,5,8,0.65)",
                    gapWidth: 2,
                },
            })),
            label: {
                show: true,
                formatter: (p: TreemapPoint) => `{name|${p.name ?? "Unknown"}}\n{val|${p.value ?? 0}%}`,
                rich: {
                    name: { color: "#e2f0ff", fontSize: 11, fontWeight: 600 },
                    val: { color: "rgba(226,240,255,0.68)", fontSize: 10 },
                },
            },
        }],
    }), [treemapRows]);

    if (!mounted || !open) return null;

    return createPortal((
        <>
            <div
                onClick={onClose}
                style={{
                    position: "fixed",
                    inset: 0,
                    zIndex: 140,
                    background: "rgba(0,0,0,0.62)",
                    backdropFilter: "blur(3px)",
                }}
            />

            <div style={{
                position: "fixed",
                top: 14,
                right: 10,
                zIndex: 150,
                width: "min(980px, calc(100vw - 20px))",
                background: DS.surface,
                borderLeft: `1px solid ${DS.border}`,
                borderTop: `1px solid ${DS.border}`,
                boxShadow: "-20px 0 80px rgba(0,0,0,0.65)",
                display: "flex",
                flexDirection: "column",
                maxHeight: "calc(100vh - 24px)",
                overflow: "hidden",
                borderTopLeftRadius: 14,
                borderBottomLeftRadius: 14,
                borderTopRightRadius: 14,
                borderBottomRightRadius: 14,
            }}>
                <div style={{
                    position: "absolute", top: 0, left: "12%", right: "12%", height: 1,
                    background: `radial-gradient(ellipse at 50%, ${DS.violet}88, transparent 80%)`,
                    pointerEvents: "none",
                }} />
                <div style={{
                    padding: "16px 18px 12px",
                    borderBottom: `1px solid ${DS.border}`,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexShrink: 0,
                }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: 16, color: DS.hi, fontWeight: 600 }}>
                            Revenue Treemap Detail
                        </h2>
                        <p style={{ margin: "3px 0 0", fontSize: 11, color: DS.lo }}>
                            Category and product revenue explorer
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            border: `1px solid ${DS.border}`,
                            background: "rgba(255,255,255,0.05)",
                            color: DS.mid,
                            borderRadius: 8,
                            fontSize: 13,
                            padding: "6px 12px",
                            cursor: "pointer",
                        }}
                    >
                        Close
                    </button>
                </div>

                <div style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    overflowX: "hidden",
                    padding: "12px 18px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                }}>
                    {/* Error state */}
                    {(productsQ.isError || categoriesQ.isError) && (
                        <div style={{
                            background: "rgba(244,63,94,0.06)", border: "1px solid rgba(244,63,94,0.2)",
                            borderRadius: 10, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12,
                        }}>
                            <span style={{ fontSize: 18 }}>!</span>
                            <div style={{ flex: 1 }}>
                                <p style={{ margin: 0, fontSize: 12, color: DS.rose, fontWeight: 600 }}>Failed to load products</p>
                                <p style={{ margin: "4px 0 0", fontSize: 11, color: DS.mid }}>
                                    {(productsQ.error as Error)?.message || (categoriesQ.error as Error)?.message || "Please try again."}
                                </p>
                            </div>
                            <button onClick={() => { productsQ.refetch(); categoriesQ.refetch(); }} style={{
                                fontSize: 11, color: DS.hi, background: "rgba(255,255,255,0.04)",
                                border: `1px solid ${DS.border}`, borderRadius: 6,
                                padding: "6px 14px", cursor: "pointer",
                            }}>Retry</button>
                        </div>
                    )}
                    <div style={{
                        background: DS.panel,
                        border: `1px solid ${DS.border}`,
                        borderRadius: 12,
                        padding: "12px",
                        display: "grid",
                        gridTemplateColumns: "1.3fr 0.9fr 0.8fr 0.8fr",
                        gap: 8,
                    }}>
                        <input
                            value={search}
                            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                            placeholder="Search product name or article number..."
                            style={{
                                width: "100%",
                                fontSize: 11,
                                padding: "8px 10px",
                                borderRadius: 8,
                                background: "rgba(255,255,255,0.05)",
                                border: `1px solid ${DS.border}`,
                                color: DS.hi,
                                outline: "none",
                                boxSizing: "border-box",
                            }}
                        />
                        <SelectField value={category} onChange={(v) => { setCategory(v); setPage(1); }}>
                            <option value="">All categories</option>
                            {categories.map((c: CategoryShare) => (
                                <option key={c.name} value={c.name}>{c.name}</option>
                            ))}
                        </SelectField>
                        <SelectField value={sort} onChange={(v) => { setSort(v as SortField); setPage(1); }}>
                            <option value="total_revenue">Sort: Revenue</option>
                            <option value="total_units">Sort: Units</option>
                            <option value="margin_pct">Sort: Margin</option>
                            <option value="name">Sort: Name</option>
                        </SelectField>
                        <SelectField value={order} onChange={(v) => { setOrder(v as SortOrder); setPage(1); }}>
                            <option value="DESC">High to low</option>
                            <option value="ASC">Low to high</option>
                        </SelectField>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                        {[
                            { l: "Matched Products", v: total.toLocaleString(), c: DS.violet },
                            { l: "Page Revenue", v: eur(pageRevenue), c: DS.sky },
                            { l: "Page Units", v: pageUnits.toLocaleString(), c: DS.emerald },
                            { l: "Avg Margin", v: `${avgMargin.toFixed(1)}%`, c: DS.amber },
                        ].map((k) => (
                            <div key={k.l} style={{
                                border: `1px solid ${DS.border}`,
                                borderRadius: 10,
                                background: DS.panel,
                                padding: "10px 12px",
                            }}>
                                <div style={{ fontSize: 9, color: DS.lo, letterSpacing: "0.07em", textTransform: "uppercase" }}>{k.l}</div>
                                <div style={{ marginTop: 4, fontSize: 19, fontWeight: 700, color: k.c, fontFamily: DS.mono }}>{k.v}</div>
                            </div>
                        ))}
                    </div>

                    <div style={{ background: DS.panel, border: `1px solid ${DS.border}`, borderRadius: 12, padding: "10px 12px" }}>
                        <div style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 13, color: DS.hi, fontWeight: 600 }}>Category Revenue Treemap</div>
                            <div style={{ fontSize: 10, color: DS.lo }}>Based on currently filtered results (this page)</div>
                        </div>
                        <div style={{ height: 170 }}>
                            <ReactECharts option={treemapOption} style={{ height: "100%", width: "100%" }} />
                        </div>
                    </div>

                    <div style={{
                        background: DS.panel,
                        border: `1px solid ${DS.border}`,
                        borderRadius: 12,
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "column",
                        minHeight: 280,
                        flex: 1,
                    }}>
                        <div style={{
                            display: "grid",
                            gridTemplateColumns: "2fr 1fr 0.9fr 0.8fr 0.7fr 0.7fr",
                            padding: "10px 12px",
                            borderBottom: `1px solid ${DS.border}`,
                            background: "rgba(255,255,255,0.02)",
                            flexShrink: 0,
                        }}>
                            {["Product", "Category", "Revenue", "Units", "Margin", "Trend"].map((h) => (
                                <span key={h} style={{ fontSize: 9, color: DS.lo, letterSpacing: "0.07em", textTransform: "uppercase" }}>{h}</span>
                            ))}
                        </div>

                        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                            {productsQ.isFetching && rows.length === 0 ? (
                                <div style={{ padding: "24px 14px", textAlign: "center", color: DS.lo, fontSize: 12 }}>Loading products...</div>
                            ) : rows.length === 0 ? (
                                <div style={{ padding: "24px 14px", textAlign: "center", color: DS.lo, fontSize: 12 }}>No products matched these filters.</div>
                            ) : rows.map((p: ProductRow, i: number) => (
                                <div key={`${p.id}-${i}`} style={{
                                    display: "grid",
                                    gridTemplateColumns: "2fr 1fr 0.9fr 0.8fr 0.7fr 0.7fr",
                                    padding: "8px 12px",
                                    borderBottom: `1px solid ${DS.border}`,
                                    alignItems: "center",
                                    background: i % 2 ? "rgba(255,255,255,0.012)" : "transparent",
                                }}>
                                    <div style={{ overflow: "hidden" }}>
                                        <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{p.name}</div>
                                        <div style={{ fontSize: 10, color: DS.lo, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", fontFamily: DS.mono }}>{p.article_number || "-"}</div>
                                    </div>
                                    <span style={{ fontSize: 11, color: DS.mid, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{p.cat}</span>
                                    <span style={{ fontSize: 12, color: DS.sky, fontFamily: DS.mono, fontWeight: 700 }}>{eur(p.rev)}</span>
                                    <span style={{ fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{Number(p.units || 0).toLocaleString()}</span>
                                    <span style={{ fontSize: 11, color: Number(p.margin) >= 40 ? DS.emerald : DS.amber, fontFamily: DS.mono }}>{Number(p.margin || 0).toFixed(1)}%</span>
                                    <span style={{ fontSize: 11, color: Number(p.trend) >= 0 ? DS.emerald : DS.rose, fontFamily: DS.mono }}>
                                        {Number(p.trend) >= 0 ? "+" : ""}{Number(p.trend || 0).toFixed(1)}%
                                    </span>
                                </div>
                            ))}
                        </div>

                        <div style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "10px 12px",
                            borderTop: `1px solid ${DS.border}`,
                            background: "rgba(255,255,255,0.015)",
                            flexShrink: 0,
                        }}>
                            <button
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page <= 1}
                                style={{
                                    borderRadius: 7,
                                    padding: "6px 12px",
                                    border: `1px solid ${DS.border}`,
                                    background: "rgba(255,255,255,0.06)",
                                    color: page <= 1 ? DS.lo : DS.mid,
                                    cursor: page <= 1 ? "default" : "pointer",
                                    opacity: page <= 1 ? 0.4 : 1,
                                    fontSize: 11,
                                }}
                            >
                                Prev
                            </button>
                            <span style={{ fontSize: 11, color: DS.lo }}>
                                {productsQ.isFetching ? "Loading..." : `Page ${page} of ${totalPages} · ${total} products`}
                            </span>
                            <button
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                disabled={page >= totalPages}
                                style={{
                                    borderRadius: 7,
                                    padding: "6px 12px",
                                    border: `1px solid ${DS.border}`,
                                    background: "rgba(255,255,255,0.06)",
                                    color: page >= totalPages ? DS.lo : DS.mid,
                                    cursor: page >= totalPages ? "default" : "pointer",
                                    opacity: page >= totalPages ? 0.4 : 1,
                                    fontSize: 11,
                                }}
                            >
                                Next
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    ), document.body);
}
