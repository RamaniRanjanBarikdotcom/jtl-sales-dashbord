"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { DS } from "@/lib/design-system";
import { eur, safeFloat, safeInt } from "@/lib/utils";
import { useProductIntelligence } from "@/hooks/useProductsData";
import { exportProductIntelligenceCsv } from "@/lib/export";
import { useStore , sessionHasPermission} from "@/lib/store";

const tableStyle = { width: "100%", borderCollapse: "collapse" as const, fontSize: 12 };
const headerStyle = { textAlign: "left" as const, color: DS.lo, padding: "9px 10px", borderBottom: `1px solid ${DS.border}`, fontSize: 9, textTransform: "uppercase" as const, letterSpacing: ".08em" };
const cellStyle = { color: DS.mid, padding: "9px 10px", borderBottom: `1px solid rgba(255,255,255,.04)` };

export default function ProductIntelligencePage() {
    const params = useParams<{ productId: string }>();
    const router = useRouter();
    const productId = Number(params.productId || 0);
    const report = useProductIntelligence(productId);
    const session = useStore((state) => state.session);
    const canExport = sessionHasPermission(session, "products.export");
    const [tab, setTab] = useState<"trend" | "channels" | "warehouses" | "orders" | "lines">("trend");
    const [exporting, setExporting] = useState(false);

    if (report.isLoading) return <Card accent={DS.sky}><p style={{ color: DS.mid }}>Loading real product intelligence…</p></Card>;
    if (report.isError || !report.data) return <Card accent={DS.rose}><h2 style={{ color: DS.rose }}>Product Intelligence unavailable</h2><p style={{ color: DS.mid }}>The product could not be loaded for the selected company.</p></Card>;

    const data = report.data;
    const product = data.product || {};
    const summary = data.summary || {};
    const stock = data.stock || {};
    const freshness = data.freshness || {};
    const rows = tab === "trend" ? data.trend || [] : tab === "channels" ? data.channels || [] : tab === "warehouses" ? data.inventory || [] : tab === "orders" ? data.orders || [] : data.order_lines || [];
    const columns = rows.length ? Object.keys(rows[0]).filter((key) => !["tenant_id"].includes(key)) : [];

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Card accent={DS.sky}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
                    <div>
                        <button onClick={() => router.push("/dashboard/products")} style={linkButton}>← Products</button>
                        <h1 style={{ color: DS.hi, margin: "10px 0 4px", fontFamily: DS.display }}>{product.name}</h1>
                        <p style={{ color: DS.lo, margin: 0 }}>{product.article_number || "No SKU"} · {product.ean || "No EAN"} · {product.category || "Uncategorized"}</p>
                    </div>
                    {canExport && <button disabled={exporting} onClick={async () => { try { setExporting(true); await exportProductIntelligenceCsv(productId); } finally { setExporting(false); } }} style={actionButton}>{exporting ? "Exporting…" : "Download Current Report"}</button>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: 9, marginTop: 18 }}>
                    <Metric label="Revenue" value={eur(safeFloat(summary.revenue))} color={DS.sky} />
                    <Metric label="Units" value={safeInt(summary.units).toLocaleString()} color={DS.violet} />
                    <Metric label="Orders" value={safeInt(summary.orders).toLocaleString()} color={DS.emerald} />
                    <Metric label="Total Stock" value={safeFloat(stock.total).toLocaleString()} color={DS.cyan} />
                    <Metric label="Available" value={safeFloat(stock.available).toLocaleString()} color={DS.lime} />
                    <Metric label="Reserved" value={safeFloat(stock.reserved).toLocaleString()} color={DS.amber} />
                </div>
            </Card>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Card accent={DS.emerald}>
                    <h3 style={{ color: DS.hi, marginTop: 0 }}>Performance & Risk</h3>
                    <Definition label="Performance class" value={summary.performance_class || "Unavailable"} />
                    <Definition label="Risk class" value={summary.risk_class || "Unavailable"} />
                    <Definition label="Sales velocity" value={`${safeFloat(summary.sales_velocity).toFixed(3)} units/day`} />
                    <Definition label="Average selling price" value={summary.average_price == null ? "Unavailable" : eur(safeFloat(summary.average_price))} />
                    <Definition label="Margin" value={summary.margin_available ? `${safeFloat(summary.margin_pct).toFixed(2)}%` : "Margin unavailable"} />
                    <Definition label="Margin cost coverage" value={`${safeFloat(summary.margin_cost_coverage_pct).toFixed(1)}%`} />
                    <Definition label="Last sale" value={summary.last_sale || "Never synced"} />
                    <Definition label="Returns" value={safeInt(summary.returns).toLocaleString()} />
                </Card>
                <Card accent={DS.amber}>
                    <h3 style={{ color: DS.hi, marginTop: 0 }}>Channel Coverage</h3>
                    <Definition label="Channels selling" value={(data.channels || []).map((row: any) => row.channel).join(", ") || "No records found"} />
                    <Definition label="Channels with zero sales" value={(data.channels_not_selling || []).join(", ") || "None in the known channel catalogue"} />
                    <Definition label="Last product sync" value={freshness.last_product_sync || "Never synced"} />
                    <Definition label="Last inventory sync" value={freshness.last_inventory_sync || "Never synced"} />
                    <Definition label="Last order sync" value={freshness.last_order_sync || "Never synced"} />
                </Card>
            </div>

            <Card accent={DS.violet}>
                <div style={{ display: "flex", gap: 7, marginBottom: 12 }}>
                    {(["trend", "channels", "warehouses", "orders", "lines"] as const).map((value) => <button key={value} onClick={() => setTab(value)} style={{ ...tabButton, borderColor: tab === value ? DS.violet : DS.border, color: tab === value ? DS.violet : DS.mid }}>{value === "lines" ? "Order Lines" : value[0].toUpperCase() + value.slice(1)}</button>)}
                </div>
                {rows.length === 0 ? <p style={{ color: DS.lo }}>No records found.</p> : <div style={{ overflow: "auto", maxHeight: 480 }}><table style={tableStyle}><thead><tr>{columns.map((column) => <th key={column} style={headerStyle}>{column.replaceAll("_", " ")}</th>)}</tr></thead><tbody>{rows.map((row: Record<string, unknown>, index: number) => <tr key={String(row.id || row.channel || row.warehouse_name || index)}>{columns.map((column) => <td key={column} style={cellStyle}>{formatCell(column, row[column])}</td>)}</tr>)}</tbody></table></div>}
            </Card>
        </div>
    );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
    return <div style={{ border: `1px solid ${DS.border}`, background: DS.panel, borderRadius: 10, padding: "11px 12px" }}><div style={{ color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</div><div style={{ color, fontFamily: DS.mono, fontWeight: 700, marginTop: 6, fontSize: 18 }}>{value}</div></div>;
}

function Definition({ label, value }: { label: string; value: string }) {
    return <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 10, padding: "9px 0", borderBottom: `1px solid rgba(255,255,255,.04)` }}><span style={{ color: DS.lo, fontSize: 11 }}>{label}</span><span style={{ color: DS.hi, fontSize: 11 }}>{value}</span></div>;
}

function formatCell(key: string, value: unknown) {
    if (value == null || value === "") return "Unavailable";
    if (["revenue", "gross_revenue", "line_total_gross", "unit_price_gross"].includes(key)) return eur(safeFloat(value));
    return String(value);
}

const linkButton = { border: "none", background: "transparent", color: DS.sky, cursor: "pointer", padding: 0 };
const actionButton = { border: `1px solid ${DS.sky}55`, background: `${DS.sky}12`, color: DS.sky, borderRadius: 8, padding: "9px 12px", cursor: "pointer" };
const tabButton = { background: "rgba(255,255,255,.03)", border: `1px solid ${DS.border}`, borderRadius: 8, padding: "7px 10px", cursor: "pointer" };
