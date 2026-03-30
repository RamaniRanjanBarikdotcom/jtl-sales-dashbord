"use client";

import { LineChart, Line, BarChart, Bar, ComposedChart, Area, AreaChart, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import dynamic from "next/dynamic";
const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });
import { Card } from "@/components/ui/Card";
import { SectionHeader as SH } from "@/components/ui/SectionHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { ChartTip } from "@/components/charts/recharts/ChartTip";
import { DS } from "@/lib/design-system";
import { CAMPAIGNS, DAILY, SPEND_HISTORY } from "@/lib/mock-data";
import { eur } from "@/lib/utils";
import { useStore } from "@/lib/store";

const FUNNEL_OPT = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item', formatter: '{b}: {c}%' },
    series: [{
        name: 'Funnel',
        type: 'funnel',
        left: '10%', top: 10, bottom: 10, width: '80%',
        min: 0, max: 100, minSize: '0%', maxSize: '100%',
        sort: 'descending', gap: 2,
        label: { show: true, position: 'inside', color: '#fff', fontSize: 10 },
        itemStyle: { borderColor: '#fff', borderWidth: 0 },
        data: [
            { value: 100, name: 'Impressions', itemStyle: { color: DS.sky } },
            { value: 65,  name: 'Clicks',      itemStyle: { color: DS.emerald } },
            { value: 30,  name: 'Add to Cart', itemStyle: { color: DS.amber } },
            { value: 12,  name: 'Purchases',   itemStyle: { color: DS.violet } }
        ]
    }]
};

const BUDGET_MIX_OPT = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}: ${eur(p.value)} (${p.percent?.toFixed(1)}%)` },
    series: [{
        type: 'pie',
        radius: ['48%', '72%'],
        center: ['50%', '48%'],
        data: [
            { name: 'Google Ads', value: 12400, itemStyle: { color: DS.sky } },
            { name: 'Meta Ads',   value: 8900,  itemStyle: { color: DS.indigo } },
            { name: 'Email',      value: 400,   itemStyle: { color: DS.emerald } },
            { name: 'Retargeting',value: 6600,  itemStyle: { color: DS.violet } },
        ],
        label: { show: true, color: '#7799bb', fontSize: 9, formatter: '{b}\n{d}%' },
        labelLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
    }]
};

export default function MarketingTab() {
    const { session } = useStore();
    const role = session?.role || "viewer";
    const isViewer = role === "viewer";

    if (isViewer) {
        return (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, gap: 16 }}>
                <span style={{ fontSize: 40 }}>🔒</span>
                <h3 style={{ fontFamily: DS.display, fontWeight: 400, fontSize: 20, color: DS.hi, margin: 0 }}>Marketing data restricted</h3>
                <p style={{ fontSize: 13, color: DS.lo, margin: 0, textAlign: "center", maxWidth: 360 }}>Ad spend, ROAS, and campaign performance are visible to Analyst, Manager and Admin roles only.</p>
                <span style={{ fontSize: 11, color: DS.violet, background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: 20, padding: "4px 14px" }}>◇ Viewer — request upgrade from Admin</span>
            </div>
        );
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                <KpiCard label="Total Ad Spend"   value={eur(28300)} delta={8.3}  note="vs last month" c={DS.orange}  icon="💸" data={DAILY} k="rev" />
                <KpiCard label="Blended ROAS"     value="4.2x"       delta={0.4}  note="vs last month" c={DS.emerald} icon="🎯" data={DAILY} k="ord" />
                <KpiCard label="Avg CPA"          value="€32.40"     delta={-1.2} note="vs last month" c={DS.sky}     icon="🛍️" data={DAILY} k="ord" />
                <KpiCard label="Email Open Rate"  value="42%"        delta={4.1}  note="vs last month" c={DS.violet}  icon="✉️" data={DAILY} k="rev" />
            </div>

            {/* Campaigns table */}
            <Card accent={DS.sky}>
                <SH title="Campaign Performance" sub="Google Ads · Meta Ads · Email"
                    right={<button style={{ fontSize: 11, color: DS.sky, background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.2)", borderRadius: 6, padding: "4px 10px" }}>↓ Export</button>} />
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                            {["Campaign", "Platform", "Spend", "ROAS", "CPA", "Conversions"].map((h, i) => (
                                <th key={i} style={{
                                    textAlign: i > 1 ? "right" : "left", fontSize: 9, color: DS.lo,
                                    letterSpacing: "0.07em", textTransform: "uppercase", padding: "0 7px 10px", fontWeight: 500
                                }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {CAMPAIGNS.map((c, i) => (
                            <tr key={i} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)`, transition: "background 0.15s" }}>
                                <td style={{ padding: "11px 7px", fontSize: 12, color: DS.hi, fontWeight: 500 }}>{c.name}</td>
                                <td style={{ padding: "11px 7px" }}>
                                    <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 20, background: "rgba(255,255,255,0.06)", color: DS.mid }}>{c.platform}</span>
                                </td>
                                <td style={{ padding: "11px 7px", textAlign: "right", fontSize: 12, color: DS.orange, fontFamily: DS.mono, fontWeight: 600 }}>{eur(c.spend)}</td>
                                <td style={{ padding: "11px 7px", textAlign: "right", fontSize: 12, color: c.roas > 3 ? DS.emerald : DS.amber, fontFamily: DS.mono, fontWeight: 600 }}>{c.roas}x</td>
                                <td style={{ padding: "11px 7px", textAlign: "right", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>€{c.cpa}</td>
                                <td style={{ padding: "11px 7px", textAlign: "right", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{c.conversions.toLocaleString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </Card>

            {/* Google vs Meta grouped bar + ROAS trend + Funnel */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <Card accent={DS.orange}>
                    <SH title="Google vs Meta — Daily Spend" sub="30D comparison" />
                    <ResponsiveContainer width="100%" height={210}>
                        <BarChart data={SPEND_HISTORY} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barGap={2} barSize={7}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                            <XAxis dataKey="d" tick={{ fill: DS.lo, fontSize: 8 }} axisLine={false} tickLine={false} tickFormatter={v => v % 5 === 0 ? `D${v}` : ''} />
                            <YAxis tick={{ fill: DS.lo, fontSize: 8 }} axisLine={false} tickLine={false} width={28} />
                            <Tooltip content={<ChartTip />} />
                            <Bar dataKey="google" name="Google Ads" fill={DS.sky}    radius={[2, 2, 0, 0]} />
                            <Bar dataKey="meta"   name="Meta Ads"   fill={DS.indigo} radius={[2, 2, 0, 0]} />
                            <Bar dataKey="email"  name="Email"      fill={DS.emerald} radius={[2, 2, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                    <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 8 }}>
                        {[["Google", DS.sky], ["Meta", DS.indigo], ["Email", DS.emerald]].map(([l, c]) => (
                            <div key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                <div style={{ width: 8, height: 8, borderRadius: 2, background: c as string }} />
                                <span style={{ fontSize: 9, color: DS.mid }}>{l}</span>
                            </div>
                        ))}
                    </div>
                </Card>

                <Card accent={DS.emerald}>
                    <SH title="ROAS Trend" sub="Daily 30D" />
                    <div style={{ height: 210, marginTop: 10 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={SPEND_HISTORY} margin={{ top: 5, right: 0, bottom: 0, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                <XAxis dataKey="d" tick={{ fill: DS.lo, fontSize: 8 }} axisLine={false} tickLine={false} tickFormatter={v => v % 10 === 0 ? `D${v}` : ''} />
                                <YAxis tick={{ fill: DS.lo, fontSize: 8 }} axisLine={false} tickLine={false} width={24}
                                    tickFormatter={v => `${(v / 100).toFixed(1)}x`} />
                                <Tooltip content={<ChartTip />} />
                                <Line type="monotone" dataKey="google" name="Google ROAS" stroke={DS.sky}    strokeWidth={2} dot={false} />
                                <Line type="monotone" dataKey="meta"   name="Meta ROAS"   stroke={DS.indigo} strokeWidth={2} dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </Card>

                <Card accent={DS.lime}>
                    <SH title="Attribution Funnel" sub="User journey" />
                    <div style={{ height: 220, marginTop: 10 }}>
                        <ReactECharts option={FUNNEL_OPT} style={{ height: "100%", width: "100%" }} />
                    </div>
                </Card>
            </div>

            {/* Spend vs Revenue dual-axis + Budget mix donut */}
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                <Card accent={DS.sky}>
                    <SH title="Spend vs Revenue" sub="Daily 30D — dual axis" />
                    <ResponsiveContainer width="100%" height={220}>
                        <ComposedChart data={SPEND_HISTORY} margin={{ top: 5, right: 30, bottom: 0, left: 0 }}>
                            <defs>
                                <linearGradient id="revMkt" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={DS.emerald} stopOpacity={0.3} />
                                    <stop offset="100%" stopColor={DS.emerald} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                            <XAxis dataKey="d" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => v % 5 === 0 ? `D${v}` : ''} />
                            <YAxis yAxisId="spend" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={36} tickFormatter={v => `€${v}`} />
                            <YAxis yAxisId="rev" orientation="right" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={46} tickFormatter={v => `€${(v/1000).toFixed(1)}K`} />
                            <Tooltip content={<ChartTip />} />
                            <Bar yAxisId="spend" dataKey="google" name="Google Spend" stackId="s" fill={DS.sky}    fillOpacity={0.7} />
                            <Bar yAxisId="spend" dataKey="meta"   name="Meta Spend"   stackId="s" fill={DS.indigo} fillOpacity={0.7} />
                            <Area yAxisId="rev" type="monotone" dataKey="revenue" name="Revenue" stroke={DS.emerald} strokeWidth={2.5} fill="url(#revMkt)" dot={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                </Card>

                <Card accent={DS.violet}>
                    <SH title="Budget Mix" sub="Spend by channel" />
                    <div style={{ height: 220 }}>
                        <ReactECharts option={BUDGET_MIX_OPT} style={{ height: "100%", width: "100%" }} />
                    </div>
                </Card>
            </div>

            {/* Daily spend area */}
            <Card accent={DS.orange}>
                <SH title="Daily Ad Spend — Last 30 Days" sub="All channels stacked" />
                <ResponsiveContainer width="100%" height={150}>
                    <AreaChart data={SPEND_HISTORY} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                        <defs>
                            <linearGradient id="gooG" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={DS.sky} stopOpacity={0.4} />
                                <stop offset="100%" stopColor={DS.sky} stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="metG" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={DS.indigo} stopOpacity={0.4} />
                                <stop offset="100%" stopColor={DS.indigo} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                        <XAxis dataKey="d" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => v % 5 === 0 ? `D${v}` : ''} />
                        <YAxis tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={34} />
                        <Tooltip content={<ChartTip />} />
                        <Area type="monotone" dataKey="google" name="Google Ads" stackId="1" stroke={DS.sky}    fill="url(#gooG)" strokeWidth={1.5} dot={false} />
                        <Area type="monotone" dataKey="meta"   name="Meta Ads"   stackId="1" stroke={DS.indigo} fill="url(#metG)" strokeWidth={1.5} dot={false} />
                    </AreaChart>
                </ResponsiveContainer>
            </Card>
        </div>
    );
}
