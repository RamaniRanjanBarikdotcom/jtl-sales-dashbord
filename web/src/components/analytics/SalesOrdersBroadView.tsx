"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSalesOrders, type OrderFilters } from "@/hooks/useSalesData";
import { exportSalesCsv } from "@/lib/export";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import { Paginator } from "@/components/ui/Paginator";

type ContextFilters = Omit<OrderFilters, "page" | "limit" | "enabled" | "sort" | "order">;

interface Props {
  open: boolean;
  title: string;
  subtitle?: string;
  definition: string;
  filters?: ContextFilters;
  canExport: boolean;
  onClose: () => void;
}

const buttonStyle: React.CSSProperties = {
  border: `1px solid ${DS.border}`,
  borderRadius: 7,
  background: "rgba(255,255,255,0.03)",
  color: DS.mid,
  padding: "6px 10px",
  fontSize: 10,
  cursor: "pointer",
};

function contextEntries(filters: ContextFilters): Array<[string, string]> {
  const labels: Record<string, string> = {
    from: "From",
    to: "To",
    statusOverride: "Status",
    channel: "Channel",
    paymentMethod: "Payment",
    shippingMethod: "Shipping",
    weekday: "Weekday",
    hour: "Hour",
    orderNumber: "Order",
    sku: "SKU",
  };
  return Object.entries(filters)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => [labels[key] || key, key === "hour" ? `${String(value).padStart(2, "0")}:00` : String(value)]);
}

export function SalesOrdersBroadView({
  open,
  title,
  subtitle,
  definition,
  filters = {},
  canExport,
  onClose,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<"overview" | "orders">("overview");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("order_date");
  const [order, setOrder] = useState<"ASC" | "DESC">("DESC");
  const [orderNumber, setOrderNumber] = useState("");
  const [sku, setSku] = useState("");
  const serializedFilters = JSON.stringify(filters);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    setPage(1);
    setTab("orders");
    setOrderNumber("");
    setSku("");
  }, [open, serializedFilters]);
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const orders = useSalesOrders({
    ...filters,
    orderNumber: orderNumber || filters.orderNumber,
    sku: sku || filters.sku,
    page,
    limit: 25,
    sort,
    order,
    enabled: open,
  });
  const data = orders.data;
  const contexts = useMemo(() => contextEntries(filters), [serializedFilters]);
  const exportFilters = useMemo(() => {
    const result: Record<string, unknown> = {
      ...filters,
      ...(orderNumber ? { orderNumber } : {}),
      ...(sku ? { sku } : {}),
    };
    if (filters.statusOverride) result.status = filters.statusOverride;
    delete result.statusOverride;
    return result;
  }, [serializedFilters, orderNumber, sku]);

  if (!mounted || !open) return null;

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "grid", placeItems: "center", padding: 18 }}>
      <button
        aria-label="Close broad view"
        onClick={onClose}
        style={{ position: "absolute", inset: 0, border: 0, background: "rgba(0,0,0,.72)", backdropFilter: "blur(5px)", cursor: "default" }}
      />
      <section style={{ position: "relative", width: "min(1420px, 96vw)", height: "min(880px, 92vh)", background: DS.bg, border: `1px solid ${DS.borderHi}`, borderRadius: 16, boxShadow: "0 28px 90px rgba(0,0,0,.7)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <header style={{ padding: "18px 22px", borderBottom: `1px solid ${DS.border}`, display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start" }}>
          <div>
            <div style={{ fontFamily: DS.display, color: DS.hi, fontSize: 21 }}>{title}</div>
            <div style={{ color: DS.lo, fontSize: 11, marginTop: 3 }}>{subtitle || "Underlying tenant-scoped sales records"}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {contexts.length === 0 ? <span style={{ color: DS.lo, fontSize: 9 }}>Current dashboard filters</span> : contexts.map(([label, value]) => (
                <span key={`${label}-${value}`} style={{ color: DS.sky, fontSize: 9, border: `1px solid ${DS.sky}35`, borderRadius: 20, padding: "3px 8px", background: `${DS.sky}0b` }}>{label}: {value}</span>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {canExport && <button style={buttonStyle} onClick={() => exportSalesCsv(exportFilters)}>Download CSV</button>}
            <button style={buttonStyle} onClick={onClose}>Close ✕</button>
          </div>
        </header>

        <div style={{ padding: "12px 22px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input aria-label="Filter by order number" value={orderNumber} onChange={(event) => { setOrderNumber(event.target.value); setPage(1); }} placeholder="Order number" style={{ ...buttonStyle, cursor: "text", minWidth: 145 }} />
            <input aria-label="Filter by SKU" value={sku} onChange={(event) => { setSku(event.target.value); setPage(1); }} placeholder="SKU / article" style={{ ...buttonStyle, cursor: "text", minWidth: 135 }} />
            {(["overview", "orders"] as const).map((item) => (
              <button key={item} onClick={() => setTab(item)} style={{ ...buttonStyle, color: tab === item ? DS.sky : DS.mid, borderColor: tab === item ? `${DS.sky}66` : DS.border, background: tab === item ? `${DS.sky}12` : "transparent", textTransform: "capitalize" }}>{item}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <select aria-label="Sort detail rows" value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }} style={{ ...buttonStyle, cursor: "pointer" }}>
              <option value="order_date">Order date</option>
              <option value="gross_revenue">Gross revenue</option>
              <option value="net_revenue">Net revenue</option>
              <option value="item_count">Items</option>
              <option value="order_number">Order number</option>
            </select>
            <button style={buttonStyle} onClick={() => { setOrder(order === "DESC" ? "ASC" : "DESC"); setPage(1); }}>{order === "DESC" ? "Descending ↓" : "Ascending ↑"}</button>
            {(orderNumber || sku) && <button style={buttonStyle} onClick={() => { setOrderNumber(""); setSku(""); setPage(1); }}>Clear</button>}
          </div>
        </div>

        <div style={{ padding: 22, overflow: "auto", flex: 1 }}>
          {orders.isError ? (
            <div style={{ color: DS.rose }}>Could not load underlying sales records.</div>
          ) : tab === "overview" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
                {[
                  ["Orders", data?.total.toLocaleString() || "0", DS.violet],
                  ["Revenue", eur(data?.total_revenue || 0), DS.sky],
                  ["Average Margin", data?.margin_available && data.avg_margin != null ? `${data.avg_margin.toFixed(2)}%` : "Unavailable", DS.amber],
                ].map(([label, value, color]) => (
                  <div key={label} style={{ border: `1px solid ${DS.border}`, borderTop: `2px solid ${color}`, borderRadius: 12, padding: 16, background: DS.surface }}>
                    <div style={{ color: DS.lo, fontSize: 9, textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</div>
                    <div style={{ color, fontFamily: DS.mono, fontWeight: 700, fontSize: 22, marginTop: 7 }}>{value}</div>
                  </div>
                ))}
              </div>
              <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, padding: 18, background: DS.surface }}>
                <div style={{ color: DS.hi, fontSize: 13, marginBottom: 8 }}>Metric definition</div>
                <p style={{ color: DS.mid, fontSize: 11, lineHeight: 1.65, margin: 0 }}>{definition}</p>
                <p style={{ color: DS.lo, fontSize: 10, lineHeight: 1.6, margin: "10px 0 0" }}>Values are queried from the selected tenant only. Pagination and sorting are server-side. Download uses the same active dashboard and contextual filters.</p>
              </div>
            </div>
          ) : orders.isLoading && !data ? (
            <div style={{ color: DS.lo }}>Loading order details…</div>
          ) : data?.rows.length ? (
            <>
              <div style={{ overflowX: "auto", border: `1px solid ${DS.border}`, borderRadius: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1050, fontSize: 10 }}>
                  <thead><tr>{["Order", "Date", "Channel", "Status", "Items", "Gross", "Net", "Payment", "Shipping", "Region"].map((heading) => <th key={heading} style={{ textAlign: "left", color: DS.lo, padding: "9px 10px", borderBottom: `1px solid ${DS.border}`, textTransform: "uppercase", letterSpacing: ".05em" }}>{heading}</th>)}</tr></thead>
                  <tbody>{data.rows.map((row) => (
                    <tr key={`${row.order_number}-${row.order_date}`} style={{ borderBottom: `1px solid rgba(255,255,255,.04)` }}>
                      <td style={{ color: DS.hi, padding: "9px 10px", fontFamily: DS.mono }}>{row.order_number || row.external_order_number || "—"}</td>
                      <td style={{ color: DS.mid, padding: "9px 10px", whiteSpace: "nowrap" }}>{String(row.order_date).slice(0, 10)}</td>
                      <td style={{ color: DS.sky, padding: "9px 10px" }}>{row.channel || "Unknown"}</td>
                      <td style={{ color: DS.mid, padding: "9px 10px" }}>{row.status || "Unknown"}</td>
                      <td style={{ color: DS.mid, padding: "9px 10px", fontFamily: DS.mono }}>{row.item_count}</td>
                      <td style={{ color: DS.hi, padding: "9px 10px", fontFamily: DS.mono }}>{eur(row.gross_revenue)}</td>
                      <td style={{ color: DS.mid, padding: "9px 10px", fontFamily: DS.mono }}>{eur(row.net_revenue)}</td>
                      <td style={{ color: DS.mid, padding: "9px 10px" }}>{row.payment_method || "Unknown"}</td>
                      <td style={{ color: DS.mid, padding: "9px 10px" }}>{row.shipping_method || "Unknown"}</td>
                      <td style={{ color: DS.mid, padding: "9px 10px" }}>{row.region || row.country || "Unknown"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <Paginator page={page} total={data.total} limit={data.limit} onPageChange={setPage} />
            </>
          ) : (
            <div style={{ color: DS.lo }}>No records found for the selected filters.</div>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
