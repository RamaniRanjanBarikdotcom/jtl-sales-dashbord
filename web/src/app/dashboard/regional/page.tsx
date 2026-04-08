"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Card } from "@/components/ui/Card";
import { SectionHeader as SH } from "@/components/ui/SectionHeader";
import { Pill } from "@/components/ui/Pill";
import { KpiCard } from "@/components/ui/KpiCard";
import { BarFill } from "@/components/ui/BarFill";
import { ChartTip } from "@/components/charts/recharts/ChartTip";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import { useRegionalData, RegionRow } from "@/hooks/useSalesData";

const REGION_COLORS = [DS.sky, DS.violet, DS.emerald, DS.amber, DS.rose, DS.cyan, DS.indigo];

function regionColor(i: number) { return REGION_COLORS[i % REGION_COLORS.length]; }

export default function RegionalTab() {
    const { data = { regions: [], cities: [], total_revenue: 0 }, isLoading } = useRegionalData();
    const { regions, cities } = data;

    const sortedByRev  = [...regions].sort((a, b) => b.revenue - a.revenue);
    const maxRev       = sortedByRev[0]?.revenue || 1;

    const topRegion    = sortedByRev[0];
    const fastestGrow  = [...regions].filter(r => r.growth_pct !== null).sort((a, b) => (b.growth_pct ?? 0) - (a.growth_pct ?? 0))[0];
    const needsAttn    = [...regions].filter(r => r.growth_pct !== null).sort((a, b) => (a.growth_pct ?? 0) - (b.growth_pct ?? 0))[0];

    const cyPyData = regions.map((r, i) => ({
        name: r.name.length > 10 ? r.name.slice(0, 10) + '…' : r.name,
        cy:   r.revenue,
        py:   r.py_revenue,
        c:    regionColor(i),
    }));

    if (isLoading) return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: DS.mid, fontSize: 13 }}>
            Loading regional data…
        </div>
    );

    if (!regions.length) return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: DS.mid, fontSize: 13 }}>
            No regional data available for this period.
        </div>
    );

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                <KpiCard
                    label="Top Region"
                    value={topRegion?.name ?? "—"}
                    delta={topRegion?.growth_pct ?? 0}
                    note={topRegion ? eur(topRegion.revenue) + " revenue" : ""}
                    c={DS.sky} icon="🏅"
                    data={[]} k="revenue"
                />
                <KpiCard
                    label="Fastest Growing"
                    value={fastestGrow?.name ?? "—"}
                    delta={fastestGrow?.growth_pct ?? 0}
                    note="YoY"
                    c={DS.emerald} icon="🚀"
                    data={[]} k="orders"
                />
                <KpiCard
                    label="Needs Attention"
                    value={needsAttn?.name ?? "—"}
                    delta={needsAttn?.growth_pct ?? 0}
                    note="declining or no growth"
                    c={DS.rose} icon="⚠️"
                    data={[]} k="margin"
                />
            </div>

            {/* Regional breakdown table + Revenue bar */}
            <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 12 }}>
                <Card accent={DS.sky}>
                    <SH title="Regional Breakdown" sub="Revenue · Orders · Customers · Growth · Share" />
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                                {["Region", "Revenue", "Orders", "Customers", "Growth", "Share"].map((h, i) => (
                                    <th key={i} style={{
                                        textAlign: i > 0 ? "right" : "left", fontSize: 9, color: DS.lo,
                                        letterSpacing: "0.07em", textTransform: "uppercase", padding: "0 7px 10px", fontWeight: 500
                                    }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {sortedByRev.map((r: RegionRow, i: number) => (
                                <tr key={i} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)`, cursor: "pointer" }}
                                    onMouseEnter={e => (e.currentTarget.style.background = DS.panelHi)}
                                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                                    <td style={{ padding: "11px 7px" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <div style={{ width: 8, height: 8, borderRadius: 2, background: regionColor(i), flexShrink: 0 }} />
                                            <span style={{ fontSize: 12, color: DS.hi, fontWeight: 500 }}>{r.name}</span>
                                        </div>
                                    </td>
                                    <td style={{ padding: "11px 7px", textAlign: "right", fontSize: 12, color: DS.sky, fontFamily: DS.mono, fontWeight: 600 }}>{eur(r.revenue)}</td>
                                    <td style={{ padding: "11px 7px", textAlign: "right", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{r.orders.toLocaleString()}</td>
                                    <td style={{ padding: "11px 7px", textAlign: "right", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{r.customers.toLocaleString()}</td>
                                    <td style={{ padding: "11px 7px", textAlign: "right" }}>
                                        {r.growth_pct !== null ? <Pill v={r.growth_pct} /> : <span style={{ fontSize: 10, color: DS.lo }}>—</span>}
                                    </td>
                                    <td style={{ padding: "11px 7px", textAlign: "right", width: 72 }}><BarFill v={r.revenue} max={maxRev} c={regionColor(i)} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <Card accent={DS.violet}>
                        <SH title="Revenue by Region" />
                        <ResponsiveContainer width="100%" height={185}>
                            <BarChart data={sortedByRev.map((r, i) => ({ name: r.name.length > 8 ? r.name.slice(0,8)+'…' : r.name, rev: r.revenue, c: regionColor(i) }))}
                                margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barSize={20}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                <XAxis dataKey="name" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                                <YAxis tickFormatter={v => eur(v)} tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={38} />
                                <Tooltip content={<ChartTip />} />
                                <Bar dataKey="rev" name="Revenue" radius={[3, 3, 0, 0]}>
                                    {sortedByRev.map((_, i) => <Cell key={i} fill={regionColor(i)} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </Card>

                    <Card accent={DS.emerald}>
                        <SH title="YoY Growth Rate" sub="By Region" />
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {[...regions].filter(r => r.growth_pct !== null).sort((a, b) => (b.growth_pct ?? 0) - (a.growth_pct ?? 0)).map((r, i) => (
                                <div key={i}>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                        <span style={{ fontSize: 11, color: DS.mid }}>{r.name}</span>
                                        <Pill v={r.growth_pct!} />
                                    </div>
                                    <div style={{ height: 4, borderRadius: 4, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                                        <div style={{
                                            width: `${Math.min(Math.abs(r.growth_pct!) / 35 * 100, 100)}%`, height: "100%", borderRadius: 4,
                                            background: r.growth_pct! >= 0
                                                ? `linear-gradient(90deg, ${DS.emerald}88, ${DS.emerald})`
                                                : `linear-gradient(90deg, ${DS.rose}88, ${DS.rose})`,
                                        }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            </div>

            {/* CY vs PY grouped bar */}
            {cyPyData.length > 0 && (
                <Card accent={DS.indigo}>
                    <SH title="Current Period vs Prior Year" sub="Revenue comparison by region" />
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={cyPyData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barGap={6} barSize={22}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                            <XAxis dataKey="name" tick={{ fill: DS.lo, fontSize: 10 }} axisLine={false} tickLine={false} />
                            <YAxis tickFormatter={v => eur(v)} tick={{ fill: DS.lo, fontSize: 10 }} axisLine={false} tickLine={false} width={46} />
                            <Tooltip content={<ChartTip />} />
                            <Bar dataKey="cy" name="Current Period" radius={[3, 3, 0, 0]}>
                                {cyPyData.map((r, i) => <Cell key={i} fill={r.c} />)}
                            </Bar>
                            <Bar dataKey="py" name="Prior Year" radius={[3, 3, 0, 0]}>
                                {cyPyData.map((r, i) => <Cell key={i} fill={r.c} fillOpacity={0.3} />)}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                    <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ width: 14, height: 8, borderRadius: 2, background: DS.sky }} />
                            <span style={{ fontSize: 9, color: DS.mid }}>Current Period</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ width: 14, height: 8, borderRadius: 2, background: DS.sky, opacity: 0.3 }} />
                            <span style={{ fontSize: 9, color: DS.mid }}>Prior Year</span>
                        </div>
                    </div>
                </Card>
            )}

            {/* Top cities table */}
            {cities.length > 0 && (
                <Card accent={DS.amber}>
                    <SH title="Top Cities" sub="Revenue · Orders · Country" />
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                                {["City", "Country", "Revenue", "Orders"].map((h, i) => (
                                    <th key={i} style={{
                                        textAlign: i > 1 ? "right" : "left", fontSize: 9, color: DS.lo,
                                        letterSpacing: "0.07em", textTransform: "uppercase", padding: "0 7px 10px", fontWeight: 500
                                    }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {cities.map((c, i) => (
                                <tr key={i} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}
                                    onMouseEnter={e => (e.currentTarget.style.background = DS.panelHi)}
                                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                                    <td style={{ padding: "9px 7px", fontSize: 12, color: DS.hi }}>{c.city}</td>
                                    <td style={{ padding: "9px 7px", fontSize: 11, color: DS.mid }}>{c.country}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 12, color: DS.sky, fontFamily: DS.mono, fontWeight: 600 }}>{eur(c.revenue)}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{c.orders.toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>
            )}
        </div>
    );
}
