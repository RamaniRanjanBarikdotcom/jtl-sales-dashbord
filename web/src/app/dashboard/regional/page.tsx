"use client";

import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Card } from "@/components/ui/Card";
import { SectionHeader as SH } from "@/components/ui/SectionHeader";
import { Pill } from "@/components/ui/Pill";
import { KpiCard } from "@/components/ui/KpiCard";
import { BarFill } from "@/components/ui/BarFill";
import { ChartTip } from "@/components/charts/recharts/ChartTip";
import { DS } from "@/lib/design-system";
import { REGIONS, MONTHLY, REGIONAL_CY_PY } from "@/lib/mock-data";
import { eur } from "@/lib/utils";

export default function RegionalTab() {
    const maxRev = Math.max(...REGIONS.map(r => r.rev));

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                <KpiCard label="Top Region"       value="East"    delta={19.4}  note="€341K revenue" c={DS.sky}     icon="🏅" data={MONTHLY} k="revenue" />
                <KpiCard label="Fastest Growing"  value="Intl."   delta={31.2}  note="YoY"           c={DS.emerald} icon="🚀" data={MONTHLY} k="orders" />
                <KpiCard label="Needs Attention"  value="Central" delta={-1.3}  note="declining"     c={DS.rose}    icon="⚠️" data={MONTHLY} k="margin" />
            </div>

            {/* Regional breakdown table + Revenue bar */}
            <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 12 }}>
                <Card accent={DS.sky}>
                    <SH title="Regional Breakdown" sub="Revenue · Orders · Growth"
                        right={<button style={{ fontSize: 10, color: DS.sky, background: "rgba(56,189,248,0.07)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: 6, padding: "4px 10px" }}>↓ Export</button>} />
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
                            {[...REGIONS].sort((a, b) => b.rev - a.rev).map((r, i) => (
                                <tr key={i} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)`, transition: "background 0.15s", cursor: "pointer" }}
                                    onMouseEnter={e => e.currentTarget.style.background = DS.panelHi}
                                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                    <td style={{ padding: "11px 7px" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <div style={{ width: 8, height: 8, borderRadius: 2, background: r.c, flexShrink: 0 }} />
                                            <span style={{ fontSize: 12, color: DS.hi, fontWeight: 500 }}>{r.name}</span>
                                        </div>
                                    </td>
                                    <td style={{ padding: "11px 7px", textAlign: "right", fontSize: 12, color: DS.sky, fontFamily: DS.mono, fontWeight: 600 }}>{eur(r.rev)}</td>
                                    <td style={{ padding: "11px 7px", textAlign: "right", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{r.orders.toLocaleString()}</td>
                                    <td style={{ padding: "11px 7px", textAlign: "right", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{r.customers.toLocaleString()}</td>
                                    <td style={{ padding: "11px 7px", textAlign: "right" }}><Pill v={r.growth} /></td>
                                    <td style={{ padding: "11px 7px", textAlign: "right", width: 72 }}><BarFill v={r.rev} max={maxRev} c={r.c} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <Card accent={DS.violet}>
                        <SH title="Revenue by Region" />
                        <ResponsiveContainer width="100%" height={185}>
                            <BarChart data={[...REGIONS].sort((a, b) => b.rev - a.rev)} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barSize={20}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                <XAxis dataKey="name" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                                <YAxis tickFormatter={v => eur(v)} tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={38} />
                                <Tooltip content={<ChartTip />} />
                                <Bar dataKey="rev" name="Revenue" radius={[3, 3, 0, 0]}>
                                    {REGIONS.map((r, i) => <Cell key={i} fill={r.c} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </Card>

                    <Card accent={DS.emerald}>
                        <SH title="YoY Growth Rate" sub="By Region" />
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {[...REGIONS].sort((a, b) => b.growth - a.growth).map((r, i) => (
                                <div key={i}>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                        <span style={{ fontSize: 11, color: DS.mid }}>{r.name}</span>
                                        <Pill v={r.growth} />
                                    </div>
                                    <div style={{ height: 4, borderRadius: 4, background: "rgba(255,255,255,0.05)", overflow: "hidden" }}>
                                        <div style={{
                                            width: `${Math.min(Math.abs(r.growth) / 35 * 100, 100)}%`, height: "100%", borderRadius: 4,
                                            background: r.growth >= 0 ? `linear-gradient(90deg, ${DS.emerald}88, ${DS.emerald})` : `linear-gradient(90deg, ${DS.rose}88, ${DS.rose})`,
                                        }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            </div>

            {/* CY vs PY grouped bar */}
            <Card accent={DS.indigo}>
                <SH title="Current Year vs Prior Year" sub="Revenue comparison by region" />
                <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={REGIONAL_CY_PY} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barGap={6} barSize={22}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: DS.lo, fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={v => eur(v)} tick={{ fill: DS.lo, fontSize: 10 }} axisLine={false} tickLine={false} width={46} />
                        <Tooltip content={<ChartTip />} />
                        <Bar dataKey="cy" name="Current Year" radius={[3, 3, 0, 0]}>
                            {REGIONAL_CY_PY.map((r, i) => <Cell key={i} fill={r.c} />)}
                        </Bar>
                        <Bar dataKey="py" name="Prior Year" radius={[3, 3, 0, 0]}>
                            {REGIONAL_CY_PY.map((r, i) => <Cell key={i} fill={r.c} fillOpacity={0.3} />)}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 14, height: 8, borderRadius: 2, background: DS.sky }} />
                        <span style={{ fontSize: 9, color: DS.mid }}>Current Year (2026)</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 14, height: 8, borderRadius: 2, background: DS.sky, opacity: 0.3 }} />
                        <span style={{ fontSize: 9, color: DS.mid }}>Prior Year (2025)</span>
                    </div>
                </div>
            </Card>

            {/* Multi-region trend line */}
            <Card accent={DS.amber}>
                <SH title="Regional Order Volume Trend" sub="12-month breakdown" />
                <ResponsiveContainer width="100%" height={180}>
                    <LineChart
                        data={MONTHLY.map((m, i) => ({
                            month: m.month,
                            East:    Math.round(m.orders * 0.33 + i * 10),
                            North:   Math.round(m.orders * 0.26 - i * 2),
                            South:   Math.round(m.orders * 0.21 + i * 4),
                            West:    Math.round(m.orders * 0.19 + i * 2),
                        }))}
                        margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                        <XAxis dataKey="month" tick={{ fill: DS.lo, fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: DS.lo, fontSize: 10 }} axisLine={false} tickLine={false} width={34} />
                        <Tooltip content={<ChartTip />} />
                        {["East", "North", "South", "West"].map((r, i) => (
                            <Line key={r} type="monotone" dataKey={r} stroke={[DS.sky, DS.cyan, DS.violet, DS.amber][i]}
                                strokeWidth={1.5} dot={false} />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 10 }}>
                    {["East", "North", "South", "West"].map((r, i) => (
                        <div key={r} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <div style={{ width: 16, height: 2, borderRadius: 1, background: [DS.sky, DS.cyan, DS.violet, DS.amber][i] }} />
                            <span style={{ fontSize: 10, color: DS.mid }}>{r}</span>
                        </div>
                    ))}
                </div>
            </Card>
        </div>
    );
}
