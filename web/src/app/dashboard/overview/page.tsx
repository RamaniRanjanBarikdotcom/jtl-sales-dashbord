"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ComposedChart, AreaChart, Area, Line, PieChart, Pie, Cell, LineChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card } from "@/components/ui/Card";
import { SectionHeader as SH } from "@/components/ui/SectionHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { BarFill } from "@/components/ui/BarFill";
import { ChartTip } from "@/components/charts/recharts/ChartTip";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import { useOverviewKpis, useOverviewRevenue, useOverviewDaily, useOverviewCategories, useOverviewTopProducts } from "@/hooks/useOverviewData";
import { useInventoryMovements } from "@/hooks/useInventoryData";
import { RevenueTrendCard } from "@/components/overview/revenue-trend/RevenueTrendCard";
import { RevenueTrendFullModal } from "@/components/overview/revenue-trend/RevenueTrendFullModal";
import { OrdersTrendFullModal } from "@/components/overview/orders-trend/OrdersTrendFullModal";
import { ActiveProductsTrendFullModal } from "@/components/overview/active-products-trend/ActiveProductsTrendFullModal";
import { CustomersTrendFullModal } from "@/components/overview/customers-trend/CustomersTrendFullModal";
import { CategoryRevenueTrendFullModal } from "@/components/overview/category-revenue-trend/CategoryRevenueTrendFullModal";
import { InventoryTrendFullModal } from "@/components/overview/inventory-trend/InventoryTrendFullModal";

const GaugeChart = dynamic(
    () => import("@/components/charts/echarts/GaugeChart").then((m) => m.GaugeChart),
    { ssr: false, loading: () => <div style={{ height: 160 }} /> },
);

const SHIMMER = {
    background: "linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.09) 50%, rgba(255,255,255,0.04) 75%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.6s infinite",
} as const;

export default function OverviewTab() {
    const [revenueModalOpen, setRevenueModalOpen] = useState(false);
    const [ordersModalOpen, setOrdersModalOpen] = useState(false);
    const [activeProductsModalOpen, setActiveProductsModalOpen] = useState(false);
    const [customersModalOpen, setCustomersModalOpen] = useState(false);
    const [categoryRevenueModalOpen, setCategoryRevenueModalOpen] = useState(false);
    const [inventoryModalOpen, setInventoryModalOpen] = useState(false);
    const kpisQ      = useOverviewKpis();
    const revenueQ   = useOverviewRevenue();
    const dailyQ     = useOverviewDaily();
    const inventoryMovementsQ = useInventoryMovements();
    const catsQ      = useOverviewCategories();
    const topProdsQ  = useOverviewTopProducts();
    const kpis       = kpisQ.data ?? { totalRevenue: 0, totalOrders: 0, totalProducts: 0, totalCustomers: 0, lowStockCount: 0, revenueDelta: null, ordersDelta: null };
    const monthly    = revenueQ.data ?? [];
    const daily      = dailyQ.data ?? [];
    const categories = catsQ.data ?? [];
    const topProds   = topProdsQ.data ?? [];
    const inventoryDaily = inventoryMovementsQ.data?.daily ?? [];
    const realCategoryCount = Number((categories[0] as any)?.sourceCount ?? categories.length);
    const previewCategories = categories.slice(0, 8);
    const loading    = kpisQ.isLoading;
    const hasError = kpisQ.isError || revenueQ.isError || dailyQ.isError || inventoryMovementsQ.isError || catsQ.isError || topProdsQ.isError;

    return (
        <>
        <RevenueTrendFullModal open={revenueModalOpen} onClose={() => setRevenueModalOpen(false)} />
        <OrdersTrendFullModal open={ordersModalOpen} onClose={() => setOrdersModalOpen(false)} />
        <ActiveProductsTrendFullModal open={activeProductsModalOpen} onClose={() => setActiveProductsModalOpen(false)} />
        <CustomersTrendFullModal open={customersModalOpen} onClose={() => setCustomersModalOpen(false)} />
        <CategoryRevenueTrendFullModal open={categoryRevenueModalOpen} onClose={() => setCategoryRevenueModalOpen(false)} />
        <InventoryTrendFullModal open={inventoryModalOpen} onClose={() => setInventoryModalOpen(false)} />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <style>{`@keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
            {hasError && (
                <div style={{
                    background: "rgba(244,63,94,0.06)",
                    border: "1px solid rgba(244,63,94,0.2)",
                    borderRadius: 12,
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                }}>
                    <div>
                        <p style={{ margin: 0, fontSize: 12, color: DS.rose, fontWeight: 600 }}>Some dashboard data failed to load</p>
                        <p style={{ margin: "4px 0 0", fontSize: 11, color: DS.mid }}>Check API connectivity and retry.</p>
                    </div>
                    <button
                        onClick={() => { kpisQ.refetch(); revenueQ.refetch(); dailyQ.refetch(); inventoryMovementsQ.refetch(); catsQ.refetch(); topProdsQ.refetch(); }}
                        style={{
                            fontSize: 11, color: DS.hi, background: "rgba(255,255,255,0.04)",
                            border: `1px solid ${DS.border}`, borderRadius: 6,
                            padding: "6px 14px", cursor: "pointer",
                        }}
                    >
                        Retry
                    </button>
                </div>
            )}
            {/* Multi-Domain KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
                {loading ? (
                    [DS.sky, DS.violet, DS.orange, DS.amber, DS.emerald].map((c, i) => (
                        <div key={i} style={{ ...SHIMMER, borderRadius: 16, height: 130, border: `1px solid ${DS.border}` }} />
                    ))
                ) : (
                    <>
                        <KpiCard label="Total Revenue"    value={eur(kpis.totalRevenue)}                  delta={kpis.revenueDelta}  note="vs prev period"  c={DS.sky}     icon="◈" data={monthly} k="revenue" onClick={() => setRevenueModalOpen(true)} />
                        <KpiCard label="Total Orders"     value={kpis.totalOrders.toLocaleString()}       delta={kpis.ordersDelta}   note="vs prev period"  c={DS.emerald} icon="📋" data={daily}   k="ord" onClick={() => setOrdersModalOpen(true)} />
                        <KpiCard label="Active Products"  value={kpis.totalProducts.toLocaleString()}     delta={null}               note="in catalog"      c={DS.violet}  icon="📦" data={monthly} k="orders" onClick={() => setActiveProductsModalOpen(true)} />
                        <KpiCard label="Total Customers"  value={kpis.totalCustomers.toLocaleString()}    delta={null}               note="all time"        c={DS.amber}   icon="👥" data={daily}   k="rev" onClick={() => setCustomersModalOpen(true)} />
                        <KpiCard label="Inv. Alerts"      value={String(kpis.lowStockCount)}              delta={null}               note={kpis.lowStockCount > 0 ? "need attention" : "all good"} c={DS.rose} icon="⚠️" data={daily} k="ord" />
                    </>
                )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                <RevenueTrendCard
                    data={monthly}
                    loading={revenueQ.isLoading}
                    onExpand={() => setRevenueModalOpen(true)}
                />

                {/* Revenue by Category */}
                <div onClick={() => setCategoryRevenueModalOpen(true)} style={{ cursor: "pointer" }}>
                <Card accent={DS.amber}>
                    <SH
                        title="Revenue by Category"
                        sub="All categories · real DB share %"
                        right={
                            <button
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setCategoryRevenueModalOpen(true);
                                }}
                                style={{
                                    fontSize: 10,
                                    color: DS.amber,
                                    background: "rgba(245,158,11,0.08)",
                                    border: "1px solid rgba(245,158,11,0.2)",
                                    borderRadius: 6,
                                    padding: "4px 10px",
                                    cursor: "pointer",
                                }}
                            >
                                Expand
                            </button>
                        }
                    />
                    {catsQ.isLoading ? (
                        <div style={{ ...SHIMMER, height: 200, borderRadius: 8 }} />
                    ) : categories.length === 0 ? (
                        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: DS.lo, fontSize: 12 }}>No category data yet</div>
                    ) : (
                        <>
                            <div style={{ position: "relative", height: 145 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Tooltip content={<ChartTip />} />
                                        <Pie
                                            data={categories}
                                            dataKey="v"
                                            nameKey="name"
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={34}
                                            outerRadius={62}
                                            paddingAngle={2}
                                            stroke="rgba(255,255,255,0.06)"
                                            strokeWidth={1}
                                        >
                                            {categories.map((c: any, i: number) => (
                                                <Cell key={i} fill={c.c} />
                                            ))}
                                        </Pie>
                                    </PieChart>
                                </ResponsiveContainer>
                                <div
                                    style={{
                                        position: "absolute",
                                        inset: 0,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        pointerEvents: "none",
                                        flexDirection: "column",
                                        gap: 2,
                                    }}
                                >
                                    <div style={{ fontSize: 9, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.08em" }}>Mix</div>
                                    <div style={{ fontSize: 16, color: DS.hi, fontWeight: 700 }}>{realCategoryCount}</div>
                                    <div style={{ fontSize: 9, color: DS.mid }}>categories</div>
                                </div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
                                {previewCategories.map((c: any, i: number) => (
                                    <div key={i} style={{
                                        display: "grid", gridTemplateColumns: "8px 1fr 44px 24px",
                                        alignItems: "center", gap: 7
                                    }}>
                                        <div style={{ width: 7, height: 7, borderRadius: 1.5, background: c.c }} />
                                        <span style={{ fontSize: 10, color: DS.mid, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                                        <BarFill v={c.v} max={100} c={c.c} h={3} />
                                        <span style={{ fontSize: 10, color: DS.hi, fontFamily: DS.mono, textAlign: "right" }}>{c.v}%</span>
                                    </div>
                                ))}
                                {categories.length > previewCategories.length && (
                                    <div style={{ fontSize: 10, color: DS.lo, textAlign: "right" }}>
                                        +{categories.length - previewCategories.length} more categories
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </Card>
                </div>
            </div>

            {/* Inventory Stock Movements */}
            <div onClick={() => setInventoryModalOpen(true)} style={{ cursor: "pointer" }}>
            <Card accent={DS.violet}>
                <SH
                    title="Inventory Stock Management"
                    sub="Real stock movements · click to open full view"
                    right={
                        <button
                            onClick={(event) => {
                                event.stopPropagation();
                                setInventoryModalOpen(true);
                            }}
                            style={{
                                fontSize: 10,
                                color: DS.violet,
                                background: "rgba(139,92,246,0.1)",
                                border: "1px solid rgba(139,92,246,0.22)",
                                borderRadius: 6,
                                padding: "4px 10px",
                                cursor: "pointer",
                            }}
                        >
                            Expand
                        </button>
                    }
                />
                <div style={{ height: 160, marginTop: 10 }}>
                    {inventoryMovementsQ.isLoading ? (
                        <div style={{ ...SHIMMER, height: "100%", borderRadius: 8 }} />
                    ) : inventoryDaily.length === 0 ? (
                        <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: DS.lo, fontSize: 12 }}>No movement data yet</div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={inventoryDaily} margin={{ top: 5, right: 0, bottom: 0, left: 0 }}>
                                <defs>
                                    <linearGradient id="movInG" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={DS.emerald} stopOpacity={0.3} />
                                        <stop offset="100%" stopColor={DS.emerald} stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="movOutG" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={DS.sky} stopOpacity={0.3} />
                                        <stop offset="100%" stopColor={DS.sky} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                <XAxis dataKey="d" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={34} />
                                <Tooltip content={<ChartTip />} />
                                <Area type="monotone" dataKey="ord" name="Out" stroke={DS.sky} fill="url(#movOutG)" dot={false} />
                                <Area type="monotone" dataKey="rev" name="In" stroke={DS.emerald} fill="url(#movInG)" dot={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </Card>
            </div>

            {/* Top Products */}
            <Card accent={DS.emerald}>
                <SH title="Top Products by Revenue" sub="Top 20 · all products · real revenue" />
                {topProdsQ.isLoading ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 6 }}>
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} style={{ height: 32, borderRadius: 6, ...SHIMMER }} />
                        ))}
                    </div>
                ) : topProds.length === 0 ? (
                    <div style={{ padding: "28px 0", textAlign: "center", color: DS.lo, fontSize: 12 }}>No product data yet — sync orders from JTL to see top performers</div>
                ) : (() => {
                    const maxRev = topProds[0]?.rev || 1;
                    const RANK_COLORS = [DS.emerald, DS.sky, DS.violet];
                    return (
                        <div style={{ maxHeight: 420, overflowY: "auto", paddingRight: 2, marginTop: 8, scrollbarWidth: "thin", scrollbarColor: "rgba(16,185,129,0.3) transparent" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                                {topProds.map((p: any, i: number) => {
                                    const pct = Math.max(3, Math.round((p.rev / maxRev) * 100));
                                    const accent = RANK_COLORS[i] ?? DS.emerald;
                                    const name = p.name.length > 28 ? `${p.name.slice(0, 28)}…` : p.name;
                                    return (
                                        <div key={i} style={{ padding: "7px 0", borderBottom: i < topProds.length - 1 ? `1px solid rgba(255,255,255,0.04)` : "none" }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                                                <span style={{
                                                    flexShrink: 0,
                                                    width: 20, height: 20, borderRadius: 5,
                                                    background: i < 3 ? `${accent}22` : "rgba(255,255,255,0.05)",
                                                    border: `1px solid ${i < 3 ? accent : "rgba(255,255,255,0.08)"}`,
                                                    display: "flex", alignItems: "center", justifyContent: "center",
                                                    fontSize: 9, fontFamily: DS.mono, fontWeight: 700,
                                                    color: i < 3 ? accent : DS.lo,
                                                }}>{i + 1}</span>
                                                <span style={{
                                                    flex: 1, minWidth: 0,
                                                    fontSize: 11, color: DS.hi, fontWeight: i < 3 ? 600 : 400,
                                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                                }}>{name}</span>
                                                <div style={{ flexShrink: 0, textAlign: "right" }}>
                                                    <div style={{ fontSize: 11, fontFamily: DS.mono, fontWeight: 700, color: i < 3 ? accent : DS.mid }}>{eur(p.rev)}</div>
                                                    <div style={{ fontSize: 9, color: DS.lo, marginTop: 1 }}>{p.units.toLocaleString()} units</div>
                                                </div>
                                            </div>
                                            <div style={{ marginTop: 5, marginLeft: 28, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                                                <div style={{
                                                    height: "100%", width: `${pct}%`, borderRadius: 3,
                                                    background: i < 3
                                                        ? `linear-gradient(90deg, ${accent}, ${accent}88)`
                                                        : `linear-gradient(90deg, rgba(16,185,129,0.7), rgba(16,185,129,0.3))`,
                                                    transition: "width 0.5s ease",
                                                }} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()}
            </Card>
        </div>
        </>
    );
}
