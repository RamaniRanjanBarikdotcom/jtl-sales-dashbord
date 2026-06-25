"use client";

import { useEffect, useMemo, useState } from "react";
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
import { useFilterStore } from "@/lib/store";

const REGION_COLORS = [DS.sky, DS.violet, DS.emerald, DS.amber, DS.rose, DS.cyan, DS.indigo];
function regionColor(i: number) { return REGION_COLORS[i % REGION_COLORS.length]; }

export default function RegionalTab() {
    const { regionalLocationDimension, regionalLocation, setRegionalLocation } = useFilterStore();
    const locationDimension = regionalLocationDimension;
    const selectedLocation = regionalLocation;
    const {
        data = {
            regions: [],
            cities: [],
            total_revenue: 0,
            location_dimension: 'region',
            active_location: null,
            location_options: [],
            location_insights: [],
            platform_mix: [],
            top_products: [],
            least_products: [],
            top_product_routes: [],
            least_product_routes: [],
        },
        isLoading,
    } = useRegionalData({
        locationDimension,
        location: selectedLocation === 'all' ? undefined : selectedLocation,
    });
    const { regions, cities } = data;
    const locationOptions = data.location_options ?? [];
    const locationInsights = data.location_insights ?? [];
    const platformMix = data.platform_mix ?? [];
    const topProducts = data.top_products ?? [];
    const leastProducts = data.least_products ?? [];
    const topProductRoutes = data.top_product_routes ?? [];
    const leastProductRoutes = data.least_product_routes ?? [];
    const dimLabel = locationDimension.charAt(0).toUpperCase() + locationDimension.slice(1);
    const [countryMetric, setCountryMetric] = useState<"revenue" | "orders" | "good_rate_pct" | "avg_order_value">("revenue");
    const [countryPerformanceView, setCountryPerformanceView] = useState<"all" | "highest" | "least">("all");
    const [countryRows, setCountryRows] = useState<5 | 8 | 10>(8);
    const [countryMinOrders, setCountryMinOrders] = useState<0 | 5 | 10 | 20>(5);
    const [countryBreakdownPage, setCountryBreakdownPage] = useState(1);
    const [yoyPage, setYoyPage] = useState(1);

    const sortedByRev  = [...regions].sort((a, b) => b.revenue - a.revenue);
    const countryBase = useMemo(
        () => [...regions].filter((r) => r.orders >= countryMinOrders),
        [regions, countryMinOrders],
    );
    const topCountries = useMemo(
        () => [...countryBase]
            .sort((a, b) =>
                ((Number(b[countryMetric] ?? 0) - Number(a[countryMetric] ?? 0)))
                || (b.revenue - a.revenue)
                || (b.orders - a.orders)
            )
            .slice(0, countryRows),
        [countryBase, countryMetric, countryRows],
    );
    const leastCountries = useMemo(
        () => [...countryBase]
            .sort((a, b) =>
                ((Number(a[countryMetric] ?? 0) - Number(b[countryMetric] ?? 0)))
                || (a.revenue - b.revenue)
                || (a.orders - b.orders)
            )
            .slice(0, countryRows),
        [countryBase, countryMetric, countryRows],
    );
    const countryBreakdownRows = useMemo(() => {
        if (countryPerformanceView === "highest") return topCountries;
        if (countryPerformanceView === "least") return leastCountries;
        return [...countryBase].sort((a, b) =>
            (Number(b[countryMetric] ?? 0) - Number(a[countryMetric] ?? 0))
            || (b.revenue - a.revenue)
            || (b.orders - a.orders)
        );
    }, [countryBase, countryMetric, countryPerformanceView, topCountries, leastCountries]);
    const breakdownRows = locationDimension === "country" ? countryBreakdownRows : sortedByRev;
    const maxRev = breakdownRows[0]?.revenue || 1;
    const breakdownPageSize = countryRows;
    const countryBreakdownTotalPages = Math.max(1, Math.ceil(breakdownRows.length / breakdownPageSize));
    const countryBreakdownRowsPaged = useMemo(() => {
        if (locationDimension !== "country") return breakdownRows;
        const safePage = Math.min(countryBreakdownPage, countryBreakdownTotalPages);
        const start = (safePage - 1) * breakdownPageSize;
        return breakdownRows.slice(start, start + breakdownPageSize);
    }, [breakdownRows, breakdownPageSize, countryBreakdownPage, countryBreakdownTotalPages, locationDimension]);
    const yoyRows = useMemo(
        () => [...breakdownRows].filter(r => r.growth_pct !== null).sort((a, b) => (b.growth_pct ?? 0) - (a.growth_pct ?? 0)),
        [breakdownRows],
    );
    const yoyPageSize = countryRows;
    const yoyTotalPages = Math.max(1, Math.ceil(yoyRows.length / yoyPageSize));
    const yoyRowsPaged = useMemo(() => {
        if (locationDimension !== "country") return yoyRows;
        const safePage = Math.min(yoyPage, yoyTotalPages);
        const start = (safePage - 1) * yoyPageSize;
        return yoyRows.slice(start, start + yoyPageSize);
    }, [yoyRows, yoyPage, yoyPageSize, yoyTotalPages, locationDimension]);
    const locationSorted = [...locationInsights].sort((a, b) => b.orders - a.orders);
    const bestLocation = useMemo(
        () => [...locationInsights].filter((r) => r.orders > 0).sort((a, b) => b.good_rate_pct - a.good_rate_pct)[0],
        [locationInsights],
    );
    const riskyLocation = useMemo(
        () => [...locationInsights].filter((r) => r.orders > 0).sort((a, b) => a.good_rate_pct - b.good_rate_pct)[0],
        [locationInsights],
    );

    const topRegion    = sortedByRev[0];
    const fastestGrow  = [...regions].filter(r => r.growth_pct !== null).sort((a, b) => (b.growth_pct ?? 0) - (a.growth_pct ?? 0))[0];
    const needsAttn    = [...regions].filter(r => r.growth_pct !== null).sort((a, b) => (a.growth_pct ?? 0) - (b.growth_pct ?? 0))[0];
    useEffect(() => {
        if (selectedLocation === 'all') return;
        if (!locationOptions.includes(selectedLocation)) {
            setRegionalLocation('all');
        }
    }, [selectedLocation, locationOptions, setRegionalLocation]);
    useEffect(() => {
        setCountryBreakdownPage(1);
        setYoyPage(1);
    }, [locationDimension, countryMetric, countryPerformanceView, countryRows, countryMinOrders, selectedLocation]);

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
            <Card accent={DS.indigo}>
                <SH
                    title="Location Intelligence"
                    sub={`Active filter: ${selectedLocation === 'all' ? `All ${locationDimension}` : selectedLocation}. Track good vs bad orders and platform/order-value quality by location.`}
                />
            </Card>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                <KpiCard
                    label={`Top ${dimLabel}`}
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
                    label={`Needs Attention (${dimLabel})`}
                    value={needsAttn?.name ?? "—"}
                    delta={needsAttn?.growth_pct ?? 0}
                    note="declining or no growth"
                    c={DS.rose} icon="⚠️"
                    data={[]} k="margin"
                />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                <KpiCard
                    label="Best Location (Quality)"
                    value={bestLocation?.location ?? "—"}
                    delta={bestLocation?.good_rate_pct ?? 0}
                    note={bestLocation ? `${bestLocation.orders.toLocaleString()} orders` : ""}
                    c={DS.emerald} icon="✅"
                    data={[]} k="orders"
                />
                <KpiCard
                    label="At-Risk Location"
                    value={riskyLocation?.location ?? "—"}
                    delta={(riskyLocation?.good_rate_pct ?? 0) - 100}
                    note={riskyLocation ? `${riskyLocation.bad_orders.toLocaleString()} bad orders` : ""}
                    c={DS.rose} icon="⚠️"
                    data={[]} k="orders"
                />
                <KpiCard
                    label="Selected Scope"
                    value={selectedLocation === 'all' ? `All ${locationDimension}` : selectedLocation}
                    delta={0}
                    note={`${locationSorted.length.toLocaleString()} locations tracked`}
                    c={DS.indigo} icon="📍"
                    data={[]} k="revenue"
                />
            </div>

            {/* Regional breakdown table + Revenue bar */}
            <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 12 }}>
                <Card accent={DS.sky}>
                    <SH title={`${dimLabel} Breakdown`} sub="Revenue · Orders · Customers · Growth · Share" />
                    {locationDimension === "country" && (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
                            <select
                                value={countryPerformanceView}
                                onChange={(e) => setCountryPerformanceView(e.target.value as "all" | "highest" | "least")}
                                style={{ background: DS.panel, border: `1px solid ${DS.border}`, color: DS.hi, fontSize: 12, borderRadius: 8, padding: "8px 10px", outline: "none" }}
                            >
                                <option value="all">All Countries</option>
                                <option value="highest">Highest Performing</option>
                                <option value="least">Least Performing</option>
                            </select>
                            <select
                                value={countryMetric}
                                onChange={(e) => setCountryMetric(e.target.value as "revenue" | "orders" | "good_rate_pct" | "avg_order_value")}
                                style={{ background: DS.panel, border: `1px solid ${DS.border}`, color: DS.hi, fontSize: 12, borderRadius: 8, padding: "8px 10px", outline: "none" }}
                            >
                                <option value="revenue">Metric: Revenue</option>
                                <option value="orders">Metric: Orders</option>
                                <option value="good_rate_pct">Metric: Good Order %</option>
                                <option value="avg_order_value">Metric: Avg Order Value</option>
                            </select>
                            <select
                                value={countryMinOrders}
                                onChange={(e) => setCountryMinOrders(Number(e.target.value) as 0 | 5 | 10 | 20)}
                                style={{ background: DS.panel, border: `1px solid ${DS.border}`, color: DS.hi, fontSize: 12, borderRadius: 8, padding: "8px 10px", outline: "none" }}
                            >
                                <option value={0}>Min Orders: 0+</option>
                                <option value={5}>Min Orders: 5+</option>
                                <option value={10}>Min Orders: 10+</option>
                                <option value={20}>Min Orders: 20+</option>
                            </select>
                            <select
                                value={countryRows}
                                onChange={(e) => setCountryRows(Number(e.target.value) as 5 | 8 | 10)}
                                style={{ background: DS.panel, border: `1px solid ${DS.border}`, color: DS.hi, fontSize: 12, borderRadius: 8, padding: "8px 10px", outline: "none" }}
                            >
                                <option value={5}>Rows: 5</option>
                                <option value={8}>Rows: 8</option>
                                <option value={10}>Rows: 10</option>
                            </select>
                        </div>
                    )}
                    <div style={{ maxHeight: 360, overflowY: "auto", overflowX: "hidden", paddingRight: 2 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                                <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                                    {[dimLabel, "Revenue", "Orders", "Customers", "Growth", "Share"].map((h, i) => (
                                        <th key={i} style={{
                                            textAlign: i > 0 ? "right" : "left", fontSize: 9, color: DS.lo,
                                            letterSpacing: "0.07em", textTransform: "uppercase", padding: "0 7px 10px", fontWeight: 500,
                                            position: "sticky", top: 0, background: DS.panel,
                                        }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {countryBreakdownRowsPaged.map((r: RegionRow, i: number) => (
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
                    </div>
                    {locationDimension === "country" && (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                            <span style={{ fontSize: 11, color: DS.lo }}>
                                Page {countryBreakdownPage} of {countryBreakdownTotalPages} · {breakdownRows.length.toLocaleString()} countries
                            </span>
                            <div style={{ display: "flex", gap: 8 }}>
                                <button
                                    onClick={() => setCountryBreakdownPage((p) => Math.max(1, p - 1))}
                                    disabled={countryBreakdownPage <= 1}
                                    style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${DS.border}`, background: DS.panel, color: DS.hi, opacity: countryBreakdownPage <= 1 ? 0.5 : 1, cursor: countryBreakdownPage <= 1 ? "not-allowed" : "pointer" }}
                                >
                                    Prev
                                </button>
                                <button
                                    onClick={() => setCountryBreakdownPage((p) => Math.min(countryBreakdownTotalPages, p + 1))}
                                    disabled={countryBreakdownPage >= countryBreakdownTotalPages}
                                    style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${DS.border}`, background: DS.panel, color: DS.hi, opacity: countryBreakdownPage >= countryBreakdownTotalPages ? 0.5 : 1, cursor: countryBreakdownPage >= countryBreakdownTotalPages ? "not-allowed" : "pointer" }}
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    )}
                </Card>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <Card accent={DS.violet}>
                        <SH title={`Revenue by ${dimLabel}`} />
                        <ResponsiveContainer width="100%" height={185}>
                            <BarChart data={countryBreakdownRowsPaged
                                .map((r, i) => ({ name: r.name.length > 8 ? r.name.slice(0,8)+'…' : r.name, rev: r.revenue, c: regionColor(i) }))}
                                margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barSize={20}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                <XAxis dataKey="name" tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} />
                                <YAxis tickFormatter={v => eur(v)} tick={{ fill: DS.lo, fontSize: 9 }} axisLine={false} tickLine={false} width={38} />
                                <Tooltip content={<ChartTip />} />
                                <Bar dataKey="rev" name="Revenue" radius={[3, 3, 0, 0]}>
                                    {countryBreakdownRowsPaged.map((_, i) => <Cell key={i} fill={regionColor(i)} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </Card>

                    <Card accent={DS.emerald}>
                        <SH title="YoY Growth Rate" sub={`By ${dimLabel}`} />
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 300, overflowY: "auto", paddingRight: 2 }}>
                            {yoyRowsPaged.map((r, i) => (
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
                        {locationDimension === "country" && (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                                <span style={{ fontSize: 11, color: DS.lo }}>
                                    Page {yoyPage} of {yoyTotalPages} · {yoyRows.length.toLocaleString()} countries
                                </span>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <button
                                        onClick={() => setYoyPage((p) => Math.max(1, p - 1))}
                                        disabled={yoyPage <= 1}
                                        style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${DS.border}`, background: DS.panel, color: DS.hi, opacity: yoyPage <= 1 ? 0.5 : 1, cursor: yoyPage <= 1 ? "not-allowed" : "pointer" }}
                                    >
                                        Prev
                                    </button>
                                    <button
                                        onClick={() => setYoyPage((p) => Math.min(yoyTotalPages, p + 1))}
                                        disabled={yoyPage >= yoyTotalPages}
                                        style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${DS.border}`, background: DS.panel, color: DS.hi, opacity: yoyPage >= yoyTotalPages ? 0.5 : 1, cursor: yoyPage >= yoyTotalPages ? "not-allowed" : "pointer" }}
                                    >
                                        Next
                                    </button>
                                </div>
                            </div>
                        )}
                    </Card>
                </div>
            </div>

            {/* CY vs PY grouped bar */}
            {cyPyData.length > 0 && (
                <Card accent={DS.indigo}>
                    <SH title="Current Period vs Prior Year" sub={`Revenue comparison by ${locationDimension}`} />
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

            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 12 }}>
                <Card accent={DS.emerald}>
                    <SH
                        title={`Order Quality by ${locationDimension.charAt(0).toUpperCase()}${locationDimension.slice(1)}`}
                        sub="Good = not cancelled/returned · Bad = cancelled or returned"
                    />
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                                {["Location", "Orders", "Good", "Bad", "Good %", "Avg Price"].map((h, i) => (
                                    <th key={i} style={{
                                        textAlign: i > 0 ? "right" : "left", fontSize: 9, color: DS.lo,
                                        letterSpacing: "0.07em", textTransform: "uppercase", padding: "0 7px 10px", fontWeight: 500
                                    }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {locationSorted.slice(0, 18).map((r, i) => (
                                <tr key={i} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                                    <td style={{ padding: "9px 7px", fontSize: 11, color: DS.hi }}>{r.location}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{r.orders.toLocaleString()}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.emerald, fontFamily: DS.mono }}>{r.good_orders.toLocaleString()}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.rose, fontFamily: DS.mono }}>{r.bad_orders.toLocaleString()}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right" }}><Pill v={r.good_rate_pct - 100} /></td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.sky, fontFamily: DS.mono }}>{eur(r.avg_order_value)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {locationSorted.length === 0 && (
                        <div style={{ padding: "18px 8px", color: DS.lo, fontSize: 12 }}>No location quality data for current filters.</div>
                    )}
                </Card>

                <Card accent={DS.sky}>
                    <SH
                        title="Platform Mix in Selected Location"
                        sub="Orders, revenue and average order value by platform"
                    />
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                                {["Platform", "Orders", "Share", "Good %", "Avg Price"].map((h, i) => (
                                    <th key={i} style={{
                                        textAlign: i > 0 ? "right" : "left", fontSize: 9, color: DS.lo,
                                        letterSpacing: "0.07em", textTransform: "uppercase", padding: "0 7px 10px", fontWeight: 500
                                    }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {platformMix.slice(0, 14).map((p, i) => (
                                <tr key={i} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                                    <td style={{ padding: "9px 7px", fontSize: 11, color: DS.hi }}>{p.platform}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{p.orders.toLocaleString()}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.violet, fontFamily: DS.mono }}>{p.share_pct.toFixed(1)}%</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right" }}><Pill v={p.good_rate_pct - 100} /></td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.sky, fontFamily: DS.mono }}>{eur(p.avg_order_value)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {platformMix.length === 0 && (
                        <div style={{ padding: "18px 8px", color: DS.lo, fontSize: 12 }}>No platform mix data for current location scope.</div>
                    )}
                </Card>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Card accent={DS.cyan}>
                    <SH
                        title="Most Ordered Products (Selected Location)"
                        sub="Products with highest demand in the current location filter"
                    />
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                                {["Product", "SKU", "Qty", "Orders", "Revenue"].map((h, i) => (
                                    <th key={i} style={{
                                        textAlign: i > 1 ? "right" : "left", fontSize: 9, color: DS.lo,
                                        letterSpacing: "0.07em", textTransform: "uppercase", padding: "0 7px 10px", fontWeight: 500
                                    }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {topProducts.slice(0, 10).map((p, i) => (
                                <tr key={`${p.product_id}-${i}`} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                                    <td style={{ padding: "9px 7px", fontSize: 11, color: DS.hi }}>{p.product_name}</td>
                                    <td style={{ padding: "9px 7px", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{p.sku}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.sky, fontFamily: DS.mono }}>{p.quantity.toLocaleString()}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{p.orders.toLocaleString()}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.emerald, fontFamily: DS.mono }}>{eur(p.revenue)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {topProducts.length === 0 && (
                        <div style={{ padding: "18px 8px", color: DS.lo, fontSize: 12 }}>No top-product data for current location scope.</div>
                    )}
                </Card>

                <Card accent={DS.amber}>
                    <SH
                        title="Least Ordered Products (Selected Location)"
                        sub="Products with lowest demand in the current location filter"
                    />
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                                {["Product", "SKU", "Qty", "Orders", "Revenue"].map((h, i) => (
                                    <th key={i} style={{
                                        textAlign: i > 1 ? "right" : "left", fontSize: 9, color: DS.lo,
                                        letterSpacing: "0.07em", textTransform: "uppercase", padding: "0 7px 10px", fontWeight: 500
                                    }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {leastProducts.slice(0, 10).map((p, i) => (
                                <tr key={`${p.product_id}-${i}`} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                                    <td style={{ padding: "9px 7px", fontSize: 11, color: DS.hi }}>{p.product_name}</td>
                                    <td style={{ padding: "9px 7px", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{p.sku}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.sky, fontFamily: DS.mono }}>{p.quantity.toLocaleString()}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{p.orders.toLocaleString()}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.emerald, fontFamily: DS.mono }}>{eur(p.revenue)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {leastProducts.length === 0 && (
                        <div style={{ padding: "18px 8px", color: DS.lo, fontSize: 12 }}>No least-product data for current location scope.</div>
                    )}
                </Card>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Card accent={DS.indigo}>
                    <SH
                        title="Platform + Shipping for Most Ordered Product"
                        sub={topProducts[0] ? `Product: ${topProducts[0].product_name}` : "No product selected"}
                    />
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                                {["Platform", "Shipping", "Orders", "Qty", "Revenue"].map((h, i) => (
                                    <th key={i} style={{
                                        textAlign: i > 1 ? "right" : "left", fontSize: 9, color: DS.lo,
                                        letterSpacing: "0.07em", textTransform: "uppercase", padding: "0 7px 10px", fontWeight: 500
                                    }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {topProductRoutes.map((r, i) => (
                                <tr key={`${r.platform}-${r.shipping_method}-${i}`} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                                    <td style={{ padding: "9px 7px", fontSize: 11, color: DS.hi }}>{r.platform}</td>
                                    <td style={{ padding: "9px 7px", fontSize: 11, color: DS.mid }}>{r.shipping_method}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{r.orders.toLocaleString()}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.sky, fontFamily: DS.mono }}>{r.quantity.toLocaleString()}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.emerald, fontFamily: DS.mono }}>{eur(r.revenue)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {topProductRoutes.length === 0 && (
                        <div style={{ padding: "18px 8px", color: DS.lo, fontSize: 12 }}>No platform/shipping mix found for most ordered product.</div>
                    )}
                </Card>

                <Card accent={DS.rose}>
                    <SH
                        title="Platform + Shipping for Least Ordered Product"
                        sub={leastProducts[0] ? `Product: ${leastProducts[0].product_name}` : "No product selected"}
                    />
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                                {["Platform", "Shipping", "Orders", "Qty", "Revenue"].map((h, i) => (
                                    <th key={i} style={{
                                        textAlign: i > 1 ? "right" : "left", fontSize: 9, color: DS.lo,
                                        letterSpacing: "0.07em", textTransform: "uppercase", padding: "0 7px 10px", fontWeight: 500
                                    }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {leastProductRoutes.map((r, i) => (
                                <tr key={`${r.platform}-${r.shipping_method}-${i}`} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                                    <td style={{ padding: "9px 7px", fontSize: 11, color: DS.hi }}>{r.platform}</td>
                                    <td style={{ padding: "9px 7px", fontSize: 11, color: DS.mid }}>{r.shipping_method}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{r.orders.toLocaleString()}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.sky, fontFamily: DS.mono }}>{r.quantity.toLocaleString()}</td>
                                    <td style={{ padding: "9px 7px", textAlign: "right", fontSize: 11, color: DS.emerald, fontFamily: DS.mono }}>{eur(r.revenue)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {leastProductRoutes.length === 0 && (
                        <div style={{ padding: "18px 8px", color: DS.lo, fontSize: 12 }}>No platform/shipping mix found for least ordered product.</div>
                    )}
                </Card>
            </div>

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
