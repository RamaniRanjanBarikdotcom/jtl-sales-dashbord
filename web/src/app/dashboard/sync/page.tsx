"use client";

import { BarChart, Bar, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { GaugeChart } from "@/components/charts/echarts/GaugeChart";
import { Card } from "@/components/ui/Card";
import { SectionHeader as SH } from "@/components/ui/SectionHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { ChartTip } from "@/components/charts/recharts/ChartTip";
import { DS } from "@/lib/design-system";
import { SYNC_JOBS, SYNC_VOLUME, DAILY } from "@/lib/mock-data";

export default function SyncTab() {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                <KpiCard label="System Health"     value="99.8%"   delta={0.1}   note="vs last week"  c={DS.emerald} icon="💊" data={DAILY} k="rev" />
                <KpiCard label="Failed Jobs (24h)" value="1"       delta={-2}    note="vs yesterday"  c={DS.rose}    icon="❌" data={DAILY} k="ord" />
                <KpiCard label="Rows Synced Today" value="42,804"  delta={14.2}  note="vs yesterday"  c={DS.sky}     icon="💾" data={DAILY} k="rev" />
                <KpiCard label="Avg Latency"       value="1.2s"    delta={-0.1}  note="vs yesterday"  c={DS.amber}   icon="⚡" data={DAILY} k="ord" />
            </div>

            {/* Sync jobs table */}
            <Card accent={DS.cyan}>
                <SH title="Sync Jobs Log" sub="Recent extractions & loads"
                    right={<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: DS.emerald, boxShadow: `0 0 6px ${DS.emerald}88`, animation: "blink 2.4s infinite" }} />
                        <span style={{ fontSize: 10, color: DS.lo }}>Live</span>
                    </div>} />
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                            {["Job Type", "Status", "Last Run", "Duration", "Rows Synced"].map((h, i) => (
                                <th key={i} style={{
                                    textAlign: i > 2 ? "right" : "left", fontSize: 9, color: DS.lo,
                                    letterSpacing: "0.07em", textTransform: "uppercase", padding: "0 7px 10px", fontWeight: 500
                                }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {SYNC_JOBS.map((j, i) => {
                            const c = j.status === 'success' ? DS.emerald : j.status === 'running' ? DS.sky : DS.rose;
                            return (
                                <tr key={i} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)`, transition: "background 0.15s" }}>
                                    <td style={{ padding: "11px 7px", fontSize: 12, color: DS.hi, fontWeight: 500 }}>{j.type}</td>
                                    <td style={{ padding: "11px 7px" }}>
                                        <span style={{
                                            fontSize: 10, padding: "2px 7px", borderRadius: 20, fontWeight: 600,
                                            background: `rgba(${c === DS.emerald ? '16,185,129' : c === DS.sky ? '56,189,248' : '244,63,94'},0.12)`,
                                            color: c
                                        }}>{j.status.toUpperCase()}</span>
                                    </td>
                                    <td style={{ padding: "11px 7px", fontSize: 11, color: DS.lo, fontFamily: DS.mono }}>{j.lastRun}</td>
                                    <td style={{ padding: "11px 7px", textAlign: "right", fontSize: 11, color: DS.lo, fontFamily: DS.mono }}>{j.duration}</td>
                                    <td style={{ padding: "11px 7px", textAlign: "right", fontSize: 11, color: DS.hi, fontFamily: DS.mono }}>{j.rows}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </Card>

            {/* Volume history + Latency trend + Health gauge */}
            <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", gap: 12 }}>
                <Card accent={DS.sky}>
                    <SH title="Sync Volume History" sub="Rows per job type · last 14 days" />
                    <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={SYNC_VOLUME} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barSize={14}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                            <XAxis dataKey="day" tick={{ fill: DS.lo, fontSize: 8 }} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: DS.lo, fontSize: 8 }} axisLine={false} tickLine={false} width={34} />
                            <Tooltip content={<ChartTip />} />
                            <Bar dataKey="orders"    name="Orders"    stackId="v" fill={DS.sky}     />
                            <Bar dataKey="inventory" name="Inventory" stackId="v" fill={DS.emerald} />
                            <Bar dataKey="customers" name="Customers" stackId="v" fill={DS.violet}  />
                            <Bar dataKey="products"  name="Products"  stackId="v" fill={DS.amber}   radius={[3, 3, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                    <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 8 }}>
                        {[["Orders", DS.sky], ["Inventory", DS.emerald], ["Customers", DS.violet], ["Products", DS.amber]].map(([l, c]) => (
                            <div key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                <div style={{ width: 8, height: 8, borderRadius: 2, background: c as string }} />
                                <span style={{ fontSize: 9, color: DS.mid }}>{l}</span>
                            </div>
                        ))}
                    </div>
                </Card>

                <Card accent={DS.cyan}>
                    <SH title="Latency Trend" sub="Avg (ms) per run" />
                    <div style={{ height: 200, marginTop: 10 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={DAILY} margin={{ top: 5, right: 0, bottom: 0, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                <XAxis dataKey="d" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={34} />
                                <Tooltip content={<ChartTip />} />
                                <Bar dataKey="ord" name="Latency (ms)" radius={[3, 3, 0, 0]}>
                                    {DAILY.map((_, i) => <Cell key={i} fill={DS.cyan} fillOpacity={0.6 + (i % 5) * 0.1} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </Card>

                <Card accent={DS.emerald}>
                    <SH title="Sync Health Gauge" sub="Current system status" />
                    <div style={{ height: 210, marginTop: 0, marginLeft: -20, marginRight: -20 }}>
                        <GaugeChart val={99.8} name="Health" color={DS.emerald} />
                    </div>
                </Card>
            </div>

            {/* Error rate line */}
            <Card accent={DS.rose}>
                <SH title="Error Rate Trend" sub="Failed jobs % per day" />
                <ResponsiveContainer width="100%" height={130}>
                    <LineChart
                        data={DAILY.map((d, i) => ({ ...d, errorRate: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0][i] || (i % 7 === 3 ? 2.1 : i % 11 === 5 ? 1.4 : 0) }))}
                        margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                        <XAxis dataKey="d" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={v => `${v}%`} tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={30} domain={[0, 5]} />
                        <Tooltip content={<ChartTip />} />
                        <Line type="monotone" dataKey="errorRate" name="Error Rate %" stroke={DS.rose} strokeWidth={2} dot={(p: any) => p.value > 0 ? <circle cx={p.cx} cy={p.cy} r={4} fill={DS.rose} stroke="none" /> : <></>} />
                    </LineChart>
                </ResponsiveContainer>
            </Card>
        </div>
    );
}
