"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { CustomerDrawerType } from "@/components/customers/CustomerKpiDrawer";
const CustomerKpiDrawer = dynamic(
    () => import("@/components/customers/CustomerKpiDrawer").then(m => m.CustomerKpiDrawer),
    { ssr: false },
);
import { AreaChart, Area, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Card } from "@/components/ui/Card";
import { SectionHeader as SH } from "@/components/ui/SectionHeader";
import { BarFill } from "@/components/ui/BarFill";
import { KpiCard } from "@/components/ui/KpiCard";
import { ChartTip } from "@/components/charts/recharts/ChartTip";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import { useCustomersKpis, useCustomersSegments, useCustomersMonthly, useCustomersList, type CustomerRow, type CustomerSegment } from "@/hooks/useCustomersData";
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
    const kpisQ = useCustomersKpis();
    const segmentsQ = useCustomersSegments();
    const monthlyQ = useCustomersMonthly();
    const kpis     = kpisQ.data ?? { totalCustomers: 0, newThisPeriod: 0, avgLtv: 0, avgOrders: 0, deltaNew: null };
    const segments = segmentsQ.data ?? [];
    const monthly  = monthlyQ.data  ?? [];
    const [drawerType, setDrawerType] = useState<CustomerDrawerType>(null);
    const [search, setSearch]       = useState("");
    const [segFilter, setSegFilter] = useState("");
    const [page, setPage]           = useState(1);
    const [isExporting, setIsExporting] = useState(false);
    const customersListQ = useCustomersList({ page, search: search || undefined, segment: segFilter || undefined });
    const customersData = customersListQ.data ?? { rows: [], total: 0, page: 1, limit: 50 };
    const customers = customersData.rows as CustomerRow[];
    const maxCount = segments.reduce((m: number, s: CustomerSegment) => Math.max(m, s.count), 1);
    const isInitialLoading =
        ((kpisQ.isLoading || kpisQ.isPending) && !kpisQ.data) ||
        ((customersListQ.isLoading || customersListQ.isPending) && !customersListQ.data);

    if (isInitialLoading) {
        const shimmer = {
            background: "linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.08) 40%, rgba(255,255,255,0.03) 100%)",
            backgroundSize: "240% 100%",
            animation: "customersShimmer 1.1s linear infinite",
            border: `1px solid ${DS.border}`,
            borderRadius: 14,
        } as const;
        return (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <style>{`@keyframes customersShimmer { 0% { background-position: 200% 0; } 100% { background-position: -40% 0; } }`}</style>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} style={{ ...shimmer, height: 128 }} />
                    ))}
                </div>
                <div style={{ ...shimmer, height: 220 }} />
                <div style={{ ...shimmer, height: 400 }} />
            </div>
        );
    }

    return (
        <>
        <CustomerKpiDrawer type={drawerType} onClose={() => setDrawerType(null)} />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
                <KpiCard label="Total Customers"    value={(kpis?.totalCustomers || 0).toLocaleString()} delta={null}           note="all time"      c={DS.sky}     icon="👥" data={monthly} k="newCust" onClick={() => setDrawerType("total")} />
                <KpiCard label="New This Period"    value={(kpis?.newThisPeriod  || 0).toLocaleString()} delta={kpis?.deltaNew ?? null} note="vs prev period" c={DS.emerald} icon="✨" data={monthly} k="newCust" onClick={() => setDrawerType("new")} />
                <KpiCard label="Avg Lifetime Value" value={eur(kpis?.avgLtv      || 0)}                  delta={null}           note="per customer"  c={DS.violet}  icon="💰" data={monthly} k="newCust" onClick={() => setDrawerType("ltv")} />
                <KpiCard label="Avg Orders"         value={Number(kpis?.avgOrders ?? 0).toFixed(1)}      delta={null}           note="per customer"  c={DS.amber}   icon="🛒" data={monthly} k="newCust" onClick={() => setDrawerType("total")} />
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
                            {segments.map((s: CustomerSegment, i: number) => (
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
                                {segments.map((s: CustomerSegment, i: number) => <Cell key={i} fill={SEGMENT_COLORS[s.name] || DS.lo} />)}
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
                                <button
                                    onClick={async () => {
                                        try {
                                            setIsExporting(true);
                                            await exportCustomersCsv({ search, segment: segFilter || undefined });
                                        } finally {
                                            setIsExporting(false);
                                        }
                                    }}
                                    disabled={isExporting}
                                    aria-label="Export customers as CSV"
                                    style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: isExporting ? "not-allowed" : "pointer", border: `1px solid ${DS.border}`, background: "transparent", color: isExporting ? DS.lo : DS.emerald, whiteSpace: "nowrap", opacity: isExporting ? 0.75 : 1 }}
                                >
                                    {isExporting ? "Exporting..." : "↓ CSV"}
                                </button>
                            )}
                            <input placeholder="Search name / email…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
                                aria-label="Search customers"
                                style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: "rgba(255,255,255,0.06)", border: `1px solid ${DS.border}`, color: DS.hi, outline: "none", width: 180 }} />
                            <select value={segFilter} onChange={e => { setSegFilter(e.target.value); setPage(1); }}
                                aria-label="Filter by customer segment"
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
                            {customers.map((c: CustomerRow, i: number) => {
                                const segment = c.segment || "Unknown";
                                const sc = SEGMENT_COLORS[segment] || DS.lo;
                                return (
                                    <tr key={i} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                                        <td style={{ padding: "10px 7px", fontSize: 12, color: DS.hi, fontWeight: 500 }}>{[c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "—"}</td>
                                        <td style={{ padding: "10px 7px", fontSize: 11, color: DS.mid }}>{c.company || "—"}</td>
                                        <td style={{ padding: "10px 7px", fontSize: 11, color: DS.mid }}>{c.region || c.country_code || "—"}</td>
                                        <td style={{ padding: "10px 7px", textAlign: "right", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{c.total_orders || 0}</td>
                                        <td style={{ padding: "10px 7px", textAlign: "right", fontSize: 12, color: DS.sky, fontFamily: DS.mono, fontWeight: 600 }}>{eur(c.ltv || 0)}</td>
                                        <td style={{ padding: "10px 7px", textAlign: "right" }}>{c.segment ? <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 20, fontWeight: 600, background: `${sc}20`, color: sc }}>{segment}</span> : "—"}</td>
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
        </>
    );
}
