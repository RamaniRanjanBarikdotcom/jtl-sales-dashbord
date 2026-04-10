"use client";

import { useState } from "react";
import { AreaChart, Area, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";
import { GaugeChart } from "@/components/charts/echarts/GaugeChart";
import { Card } from "@/components/ui/Card";
import { SectionHeader as SH } from "@/components/ui/SectionHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { BarFill } from "@/components/ui/BarFill";
import { ChartTip } from "@/components/charts/recharts/ChartTip";
import { DetailPanel, StatRow, SectionLabel, Badge, MiniBar } from "@/components/ui/DetailPanel";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import { useInventoryKpis, useInventoryAlerts, useInventoryMovements } from "@/hooks/useInventoryData";
import { useProductsCategories } from "@/hooks/useProductsData";

type AlertItem = {
    product: string; warehouse: string; stock: number;
    status: string; dsi: number; reorderQty: number;
};

export default function InventoryTab() {
    const kpis = useInventoryKpis().data ?? { totalValue: 0, lowStockCount: 0, outOfStock: 0, avgSellThrough: 0, warehouseFillPct: 0, valueLabel: "at list price" };
    const INVENTORY_ALERTS: AlertItem[] = useInventoryAlerts().data ?? [];
    const movements = useInventoryMovements().data ?? { warehouses: [], dsi: [], daily: [] };
    const CATS = useProductsCategories().data ?? [];
    const WAREHOUSES = movements?.warehouses ?? [];
    const DSI_PRODUCTS = movements?.dsi ?? [];
    const DAILY = movements?.daily ?? [];
    const TURNOVER_DATA = DSI_PRODUCTS.map((p: any) => ({
        name: p.name,
        turnover: p.dsi > 0 ? Math.round(365 / p.dsi * 10) / 10 : 0,
    })).sort((a: any, b: any) => b.turnover - a.turnover);
    const totalFill = WAREHOUSES.length > 0
        ? Math.round(WAREHOUSES.reduce((s: number, w: any) => s + w.used, 0) / WAREHOUSES.reduce((s: number, w: any) => s + w.capacity, 0) * 100)
        : 0;
    const [selected, setSelected] = useState<AlertItem | null>(null);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                <KpiCard label="Total Value in Stock" value={eur(kpis.totalValue)}            delta={0}    note={kpis.valueLabel}   c={DS.sky}     icon="🏭" data={DSI_PRODUCTS} k="dsi" />
                <KpiCard label="Items Low Stock"       value={String(kpis.lowStockCount)}     delta={0}    note="stock ≤ 5"     c={DS.amber}   icon="⚠️" data={INVENTORY_ALERTS} k="stock" />
                <KpiCard label="Items Out of Stock"    value={String(kpis.outOfStock)}        delta={0}    note="zero stock"    c={DS.rose}    icon="🚨" data={INVENTORY_ALERTS} k="dsi" />
                <KpiCard label="In-Stock Rate"         value={`${kpis.avgSellThrough}%`}      delta={0}    note="of all SKUs"   c={DS.emerald} icon="📈" data={DSI_PRODUCTS} k="dsi" />
            </div>

            {/* Warehouse fill */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
                <Card accent={DS.sky}>
                    <SH title="Overall Capacity" sub="All warehouses" />
                    <div style={{ height: 160 }}>
                        <GaugeChart val={totalFill} name="Utilisation" color={totalFill > 80 ? DS.rose : totalFill > 60 ? DS.amber : DS.emerald} />
                    </div>
                </Card>
                {(WAREHOUSES as any[]).map((w: any, i: number) => (
                    <Card key={i} accent={w.color}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                            <div>
                                <p style={{ margin: 0, fontSize: 10, color: DS.lo, letterSpacing: "0.08em", textTransform: "uppercase" }}>{w.name}</p>
                                <p style={{ margin: "4px 0 0", fontFamily: DS.display, fontSize: 26, color: DS.hi }}>{w.fill}%</p>
                            </div>
                            <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 20, fontWeight: 600,
                                background: w.fill > 80 ? "rgba(244,63,94,0.12)" : w.fill > 60 ? "rgba(245,158,11,0.1)" : "rgba(16,185,129,0.1)",
                                color: w.fill > 80 ? DS.rose : w.fill > 60 ? DS.amber : DS.emerald,
                            }}>{w.fill > 80 ? "⚠ Full" : w.fill > 60 ? "Moderate" : "Healthy"}</span>
                        </div>
                        <BarFill v={w.fill} max={100} c={w.color} h={8} />
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
                            <span style={{ fontSize: 9, color: DS.lo }}>Used: {w.used.toLocaleString()}</span>
                            <span style={{ fontSize: 9, color: DS.lo }}>Cap: {w.capacity.toLocaleString()}</span>
                        </div>
                    </Card>
                ))}
            </div>

            {/* Alerts table — clickable rows */}
            <Card accent={DS.amber}>
                <SH title="Inventory Alerts" sub="Click a row for details · Products requiring immediate action" />
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                            {["Product", "Warehouse", "Stock", "Status", "Days of Stock", "Reorder Qty"].map((h, i) => (
                                <th key={i} style={{
                                    textAlign: i > 1 ? "right" : "left", fontSize: 9, color: DS.lo,
                                    letterSpacing: "0.07em", textTransform: "uppercase", padding: "0 7px 10px", fontWeight: 500
                                }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {INVENTORY_ALERTS.map((a, i) => {
                            const c = a.status === 'out_of_stock' ? DS.rose : a.status === 'low_stock' ? DS.amber : DS.sky;
                            const isActive = selected?.product === a.product && selected?.warehouse === a.warehouse;
                            return (
                                <tr
                                    key={i}
                                    onClick={() => setSelected(a)}
                                    style={{
                                        borderBottom: `1px solid rgba(255,255,255,0.03)`,
                                        transition: "background 0.15s",
                                        cursor: "pointer",
                                        background: isActive ? DS.panelHi : "transparent",
                                    }}
                                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = DS.panel; }}
                                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                                >
                                    <td style={{ padding: "11px 7px", fontSize: 12, color: DS.hi, fontWeight: 500 }}>{a.product}</td>
                                    <td style={{ padding: "11px 7px" }}>
                                        <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 20, background: "rgba(255,255,255,0.06)", color: DS.mid }}>{a.warehouse}</span>
                                    </td>
                                    <td style={{ padding: "11px 7px", textAlign: "right", fontSize: 12, color: DS.hi, fontFamily: DS.mono, fontWeight: 600 }}>{a.stock}</td>
                                    <td style={{ padding: "11px 7px", textAlign: "right" }}>
                                        <span style={{
                                            fontSize: 10, padding: "2px 7px", borderRadius: 20, fontWeight: 600,
                                            background: `rgba(${c === DS.rose ? '244,63,94' : c === DS.amber ? '245,158,11' : '56,189,248'},0.12)`,
                                            color: c
                                        }}>{a.status.replace('_', ' ').toUpperCase()}</span>
                                    </td>
                                    <td style={{ padding: "11px 7px", textAlign: "right", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{a.dsi} days</td>
                                    <td style={{ padding: "11px 7px", textAlign: "right", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{a.reorderQty}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </Card>

            {/* Stock movements + DSI bar */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Card accent={DS.sky}>
                    <SH title="Stock Movements" sub="Incoming vs Outgoing 30D" />
                    <div style={{ height: 200, marginTop: 10 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={DAILY} margin={{ top: 5, right: 0, bottom: 0, left: 0 }}>
                                <defs>
                                    <linearGradient id="movIn2" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={DS.emerald} stopOpacity={0.3} />
                                        <stop offset="100%" stopColor={DS.emerald} stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="movOut2" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={DS.sky} stopOpacity={0.3} />
                                        <stop offset="100%" stopColor={DS.sky} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                <XAxis dataKey="d" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={34} />
                                <Tooltip content={<ChartTip />} />
                                <Area type="monotone" dataKey="ord" name="Out" stroke={DS.sky}    fill="url(#movOut2)" dot={false} />
                                <Area type="monotone" dataKey="rev" name="In"  stroke={DS.emerald} fill="url(#movIn2)"  dot={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </Card>

                <Card accent={DS.amber}>
                    <SH title="Days of Stock (DSI)" sub="Target: 30 days · red = critical" />
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={DSI_PRODUCTS} layout="vertical" margin={{ top: 0, right: 30, bottom: 0, left: 0 }} barSize={12}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                            <XAxis type="number" domain={[0, 80]} tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                            <YAxis type="category" dataKey="name" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={90} />
                            <Tooltip content={<ChartTip />} />
                            <ReferenceLine x={30} stroke={DS.amber} strokeDasharray="4 3" strokeWidth={1.5} />
                            <Bar dataKey="dsi" name="Days of Stock" radius={[0, 4, 4, 0]}>
                                {(DSI_PRODUCTS as any[]).map((p: any, i: number) => (
                                    <Cell key={i} fill={p.dsi === 0 ? DS.rose : p.dsi < 10 ? DS.amber : p.dsi > 60 ? DS.violet : DS.emerald} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </Card>
            </div>

            {/* Turnover + Category valuation */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Card accent={DS.emerald}>
                    <SH title="Inventory Turnover Rate" sub="Annual turns (higher = better)" />
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={TURNOVER_DATA} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 0 }} barSize={12}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                            <XAxis type="number" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                            <YAxis type="category" dataKey="name" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={90} />
                            <Tooltip content={<ChartTip />} />
                            <Bar dataKey="turnover" name="Turns/year" radius={[0, 4, 4, 0]}>
                                {TURNOVER_DATA.map((p: any, i: number) => (
                                    <Cell key={i} fill={p.turnover > 10 ? DS.emerald : p.turnover > 5 ? DS.sky : DS.amber} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </Card>

                <Card accent={DS.violet}>
                    <SH title="Categories Valuation" sub="Value locked in stock" />
                    <div style={{ height: 200, marginTop: 10 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={CATS} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 0 }} barSize={14}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                                <XAxis type="number" tick={false} axisLine={false} tickLine={false} />
                                <YAxis type="category" dataKey="name" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={80} />
                                <Tooltip content={<ChartTip />} />
                                <Bar dataKey="v" name="Value %" radius={[0, 4, 4, 0]}>
                                    {CATS.map((c, i) => <Cell key={i} fill={c.c} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </Card>
            </div>

            {/* Inventory Alert Detail Panel */}
            <DetailPanel
                open={!!selected}
                title={selected?.product || ""}
                subtitle={`Warehouse: ${selected?.warehouse || ""}`}
                onClose={() => setSelected(null)}
            >
                {selected && (() => {
                    const statusColor = selected.status === 'out_of_stock' ? DS.rose : selected.status === 'low_stock' ? DS.amber : DS.sky;
                    const dsiColor = selected.dsi === 0 ? DS.rose : selected.dsi < 10 ? DS.amber : selected.dsi < 30 ? DS.sky : DS.emerald;
                    const urgency = selected.status === 'out_of_stock' ? "Critical — Reorder Immediately" : selected.status === 'low_stock' ? "Warning — Reorder Soon" : "Normal";
                    return (
                        <>
                            {/* Status badges */}
                            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                                <Badge text={selected.status.replace('_', ' ').toUpperCase()} color={statusColor} />
                                <Badge text={urgency} color={statusColor} />
                            </div>

                            {/* KPI grid */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 4 }}>
                                {[
                                    { l: "Current Stock", v: String(selected.stock), c: selected.stock === 0 ? DS.rose : DS.hi },
                                    { l: "Days of Stock", v: `${selected.dsi} days`, c: dsiColor },
                                    { l: "Reorder Qty", v: String(selected.reorderQty), c: DS.sky },
                                    { l: "Warehouse", v: selected.warehouse, c: DS.mid },
                                ].map((item, i) => (
                                    <div key={i} style={{
                                        padding: "12px 14px", borderRadius: 10,
                                        background: DS.panel,
                                        border: `1px solid ${DS.border}`,
                                    }}>
                                        <div style={{ fontSize: 9, color: DS.lo, marginBottom: 4, letterSpacing: "0.06em", textTransform: "uppercase" }}>{item.l}</div>
                                        <div style={{ fontSize: 18, color: item.c, fontFamily: DS.mono, fontWeight: 700 }}>{item.v}</div>
                                    </div>
                                ))}
                            </div>

                            {/* DSI progress bar */}
                            <SectionLabel text="Days of Stock vs Target (30 days)" />
                            <div style={{ marginBottom: 4 }}>
                                <MiniBar value={Math.min(selected.dsi, 60)} max={60} color={dsiColor} label={`${selected.dsi} days remaining (target: 30)`} />
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                                <span style={{ fontSize: 9, color: DS.rose }}>Critical (0)</span>
                                <span style={{ fontSize: 9, color: DS.amber }}>Target (30)</span>
                                <span style={{ fontSize: 9, color: DS.emerald }}>Healthy (60+)</span>
                            </div>

                            {/* Details */}
                            <SectionLabel text="Stock Details" />
                            <StatRow label="Product" value={selected.product} />
                            <StatRow label="Warehouse" value={selected.warehouse} />
                            <StatRow label="Current Stock" value={String(selected.stock)} color={selected.stock === 0 ? DS.rose : DS.hi} />
                            <StatRow label="Days of Stock" value={`${selected.dsi} days`} color={dsiColor} />
                            <StatRow label="Status" value={selected.status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} color={statusColor} />
                            <StatRow label="Recommended Reorder Qty" value={String(selected.reorderQty)} color={DS.sky} />

                            {/* Action recommendation */}
                            <SectionLabel text="Action Required" />
                            <div style={{
                                padding: "12px 14px", borderRadius: 10,
                                background: `${statusColor}10`,
                                border: `1px solid ${statusColor}30`,
                            }}>
                                <div style={{ fontSize: 11, color: statusColor, fontWeight: 600, marginBottom: 6 }}>
                                    {selected.status === 'out_of_stock' ? '🚨 Out of Stock — Immediate Action Required' :
                                        selected.status === 'low_stock' ? '⚠️ Low Stock — Reorder Soon' :
                                            '✓ Stock Level Normal'}
                                </div>
                                <div style={{ fontSize: 11, color: DS.mid, lineHeight: 1.6 }}>
                                    {selected.status === 'out_of_stock'
                                        ? `Order ${selected.reorderQty} units immediately to avoid lost sales. Contact your supplier for expedited delivery.`
                                        : selected.status === 'low_stock'
                                            ? `Place an order for ${selected.reorderQty} units within the next ${selected.dsi} days to maintain uninterrupted stock.`
                                            : `Stock is at a healthy level. Continue monitoring and reorder when DSI drops below 15 days.`}
                                </div>
                            </div>
                        </>
                    );
                })()}
            </DetailPanel>
        </div>
    );
}
