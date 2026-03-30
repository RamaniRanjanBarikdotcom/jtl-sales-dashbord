"use client";

import { useState } from "react";
import { AreaChart, Area, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Card } from "@/components/ui/Card";
import { SectionHeader as SH } from "@/components/ui/SectionHeader";
import { BarFill } from "@/components/ui/BarFill";
import { KpiCard } from "@/components/ui/KpiCard";
import { ChartTip } from "@/components/charts/recharts/ChartTip";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import { useCustomersKpis, useCustomersSegments, useCustomersMonthly, useCustomersList } from "@/hooks/useCustomersData";
import { Paginator } from "@/components/ui/Paginator";
import { exportCustomersCsv } from "@/lib/export";
import { useStore } from "@/lib/store";

const SEGMENT_COLORS: Record<string, string> = {
    VIP: DS.amber, Regular: DS.sky, Casual: DS.violet,
    "At-Risk": DS.rose, New: DS.emerald, Churned: "#22d3ee", Unknown: DS.lo,
};

export default function CustomersTab() {
    const { session } = useStore();
    const role = session?.role || "viewer";
    const kpis     = useCustomersKpis().data ?? { totalCustomers: 0, newThisMonth: 0, avgLtv: 0, avgOrders: 0 };
    const segments = useCustomersSegments().data ?? [];
    const monthly  = useCustomersMonthly().data  ?? [];
    const [search, setSearch]       = useState("");
    const [segFilter, setSegFilter] = useState("");
    const [page, setPage]           = useState(1);
    const customersData = useCustomersList({ page, search: search || undefined, segment: segFilter || undefined }).data ?? { rows: [], total: 0, page: 1, limit: 50 };
    const customers = customersData.rows;
    const maxCount = segments.reduce((m: number, s: any) => Math.max(m, s.count), 1);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                <KpiCard label="Total Customers"    value={(kpis?.totalCustomers || 0).toLocaleString()} delta={0} note="all time"     c={DS.sky}     icon="👥" data={monthly} k="newCust" />
                <KpiCard label="New This Month"     value={(kpis?.newThisMonth   || 0).toLocaleString()} delta={0} note="this month"   c={DS.emerald} icon="✨" data={monthly} k="newCust" />
                <KpiCard label="Avg Lifetime Value" value={eur(kpis?.avgLtv      || 0)}                  delta={0} note="per customer" c={DS.violet}  icon="💰" data={monthly} k="newCust" />
                <KpiCard label="Avg Orders"         value={(kpis?.avgOrders      || 0).toFixed(1)}       delta={0} note="per customer" c={DS.amber}   icon="🛒" data={monthly} k="newCust" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
                <Card accent={DS.emerald}>
                    <SH title="New Customer Acquisition" sub="Monthly · last 12 months" />
                    {monthly.length === 0 ? (
                        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: DS.lo, fontSize: 12 }}>No data yet — sync customers from JTL</div>
                    ) : (
                        <ResponsiveContainer width="100%" height={200}>
                            <AreaChart data={monthly} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                                <defs><linearGradient id="acqG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={DS.emerald} stopOpacity={0.35} /><stop offset="100%" stopColor={DS.emerald} stopOpacity={0} /></linearGradient></defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                <XAxis dataKey="month" tick={{ fill: DS.lo, fontSize: 10 }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fill: DS.lo, fontSize: 10 }} axisLine={false} tickLine={false} width={34} />
                                <Tooltip content={<ChartTip />} />
                                <Area type="monotone" dataKey="newCust" name="New Customers" stroke={DS.emerald} strokeWidth={2} fill="url(#acqG)" dot={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </Card>

                <Card accent={DS.violet}>
                    <SH title="Customer Segments" sub="By RFM value tier" />
                    {segments.length === 0 ? (
                        <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: DS.lo, fontSize: 12 }}>No segments yet — sync customers</div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
                            {segments.map((s: any, i: number) => (
                                <div key={i}>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                        <span style={{ fontSize: 12, color: DS.hi, fontWeight: 500 }}>{s.name}</span>
                                        <span style={{ fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{s.count.toLocaleString()} · {eur(s.avg_ltv)} avg</span>
                                    </div>
                                    <BarFill v={s.count} max={maxCount} c={SEGMENT_COLORS[s.name] || DS.lo} />
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </div>

            {segments.length > 0 && (
                <Card accent={DS.amber}>
                    <SH title="Total Revenue by Segment" sub="Lifetime value contribution" />
                    <ResponsiveContainer width="100%" height={160}>
                        <BarChart data={segments} layout="vertical" margin={{ top: 0, right: 30, bottom: 0, left: 0 }} barSize={16}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" horizontal={false} />
                            <XAxis type="number" tickFormatter={v => eur(v)} tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                            <YAxis type="category" dataKey="name" tick={{ fill: DS.lo, fontSize: 10 }} axisLine={false} tickLine={false} width={70} />
                            <Tooltip content={<ChartTip />} />
                            <Bar dataKey="total_ltv" name="Total LTV" radius={[0, 4, 4, 0]}>
                                {segments.map((s: any, i: number) => <Cell key={i} fill={SEGMENT_COLORS[s.name] || DS.lo} />)}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </Card>
            )}

            <Card accent={DS.sky}>
                <SH title="Customer List" sub="From JTL-Wawi · sorted by lifetime value"
                    right={
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            {(role === "manager" || role === "admin" || role === "super_admin") && (
                                <button onClick={() => exportCustomersCsv({ search, segment: segFilter || undefined })} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer", border: `1px solid ${DS.border}`, background: "transparent", color: DS.emerald, whiteSpace: "nowrap" }}>↓ CSV</button>
                            )}
                            <input placeholder="Search name / email…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                                style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: "rgba(255,255,255,0.06)", border: `1px solid ${DS.border}`, color: DS.hi, outline: "none", width: 180 }} />
                            <select value={segFilter} onChange={e => { setSegFilter(e.target.value); setPage(1); }}
                                style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, background: "rgba(255,255,255,0.06)", border: `1px solid ${DS.border}`, color: DS.hi, outline: "none" }}>
                                <option value="">All Segments</option>
                                {["VIP","Regular","Casual","At-Risk","New","Churned"].map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                    }
                />
                {customers.length === 0 ? (
                    <div style={{ padding: "40px 0", textAlign: "center", color: DS.lo, fontSize: 12 }}>No customers synced yet — deploy new exe and run Customers sync</div>
                ) : (
                    <>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                                {["Name","Company","Region","Orders","LTV","Segment","Last Order"].map((h,i) => (
                                    <th key={i} style={{ textAlign: i > 2 ? "right" : "left", fontSize: 9, color: DS.lo, letterSpacing: "0.07em", textTransform: "uppercase", padding: "0 7px 10px", fontWeight: 500 }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {customers.map((c: any, i: number) => {
                                const sc = SEGMENT_COLORS[c.segment] || DS.lo;
                                return (
                                    <tr key={i} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                                        <td style={{ padding: "10px 7px", fontSize: 12, color: DS.hi, fontWeight: 500 }}>{[c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "—"}</td>
                                        <td style={{ padding: "10px 7px", fontSize: 11, color: DS.mid }}>{c.company || "—"}</td>
                                        <td style={{ padding: "10px 7px", fontSize: 11, color: DS.mid }}>{c.region || c.country_code || "—"}</td>
                                        <td style={{ padding: "10px 7px", textAlign: "right", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{c.total_orders || 0}</td>
                                        <td style={{ padding: "10px 7px", textAlign: "right", fontSize: 12, color: DS.sky, fontFamily: DS.mono, fontWeight: 600 }}>{eur(c.ltv || 0)}</td>
                                        <td style={{ padding: "10px 7px", textAlign: "right" }}>{c.segment ? <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 20, fontWeight: 600, background: `${sc}20`, color: sc }}>{c.segment}</span> : "—"}</td>
                                        <td style={{ padding: "10px 7px", textAlign: "right", fontSize: 11, color: DS.lo, fontFamily: DS.mono }}>{c.last_order_date ? new Date(c.last_order_date).toLocaleDateString("de-DE") : "—"}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <Paginator page={customersData.page} total={customersData.total} limit={customersData.limit} onPageChange={setPage} />
                    </>
                )}
            </Card>
        </div>
    );
}
