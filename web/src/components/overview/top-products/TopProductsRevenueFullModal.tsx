"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import { useFilterStore } from "@/lib/store";
import { useShallow } from "zustand/react/shallow";
import {
  type ProductBreakdownRow,
  type TopProductListItem,
  useTopProductsBreakdown,
} from "@/hooks/useTopProductsBreakdown";

interface Props {
  open: boolean;
  initialProductId?: number | null;
  onClose: () => void;
}

type TrendRange = { from: string; to: string };

const PAGE_SIZE = 16;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function resolveInitialRange(range: string, from?: string, to?: string): TrendRange {
  const end = to || todayIso();
  if (from) return { from, to: end };

  if (range === "TODAY" || range === "DAY") return { from: end, to: end };
  if (range === "YESTERDAY") {
    const y = addDays(end, -1);
    return { from: y, to: y };
  }
  if (range === "MONTH") {
    const [year, month] = end.split("-");
    return { from: `${year}-${month}-01`, to: end };
  }
  if (range === "YEAR" || range === "YTD") {
    return { from: `${end.slice(0, 4)}-01-01`, to: end };
  }
  if (range === "ALL") {
    return { from: "2000-01-01", to: end };
  }

  const map: Record<string, number> = {
    "7D": 7,
    "30D": 30,
    "3M": 90,
    "6M": 180,
    "12M": 365,
    "2Y": 730,
    "5Y": 1825,
  };
  const days = map[range] ?? 365;
  return { from: addDays(end, -days), to: end };
}

export function TopProductsRevenueFullModal({ open, initialProductId, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [productPage, setProductPage] = useState(1);

  const {
    range: filterRange,
    from: filterFrom,
    to: filterTo,
    status,
    invoice,
    platform,
    salesChannel,
    paymentMethod,
  } = useFilterStore(
    useShallow((s) => ({
      range: s.range,
      from: s.from,
      to: s.to,
      status: s.status,
      invoice: s.invoice,
      platform: s.platform,
      salesChannel: s.salesChannel,
      paymentMethod: s.paymentMethod,
    })),
  );

  const range = useMemo(
    () => resolveInitialRange(filterRange, filterFrom, filterTo),
    [filterRange, filterFrom, filterTo],
  );

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelectedProductId(initialProductId ?? null);
    setProductSearch("");
    setProductPage(1);
  }, [open, initialProductId, range.from, range.to]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const breakdownQ = useTopProductsBreakdown(
    {
      from: range.from,
      to: range.to,
      productId: selectedProductId,
      search: productSearch,
      status,
      invoice,
      channel: salesChannel,
      platform,
      paymentMethod,
    },
    open,
  );

  useEffect(() => {
    if (!breakdownQ.data?.selectedProductId) return;
    if (!selectedProductId) {
      setSelectedProductId(breakdownQ.data.selectedProductId);
    }
  }, [breakdownQ.data?.selectedProductId, selectedProductId]);

  if (!open || !mounted) return null;

  const topProducts = breakdownQ.data?.topProducts ?? [];
  const filteredTopProducts = topProducts.filter((row) => {
    const term = productSearch.trim().toLowerCase();
    if (!term) return true;
    return row.name.toLowerCase().includes(term) || row.articleNumber.toLowerCase().includes(term);
  });

  const totalPages = Math.max(1, Math.ceil(filteredTopProducts.length / PAGE_SIZE));
  const safePage = Math.min(productPage, totalPages);
  const pagedProducts = filteredTopProducts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1360,
          background: "rgba(0,0,0,0.82)",
          backdropFilter: "blur(4px)",
        }}
      />
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          position: "fixed",
          inset: "3vh 2vw",
          zIndex: 1370,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRadius: 18,
          border: "1px solid rgba(16,185,129,0.24)",
          background: "#071122",
          boxShadow: "0 30px 80px rgba(0,0,0,0.78)",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: `1px solid ${DS.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 18, color: DS.hi, fontWeight: 700 }}>
              Top Products by Revenue - Full View
            </div>
            <div style={{ fontSize: 12, color: DS.lo, marginTop: 2 }}>
              {range.from} to {range.to} - real product source data
            </div>
          </div>
          <button onClick={onClose} style={closeBtnStyle}>
            Close
          </button>
        </div>

        <div style={{ padding: 16, overflow: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {breakdownQ.isLoading ? (
            <div style={{ color: DS.lo, fontSize: 13 }}>Loading top product revenue data...</div>
          ) : breakdownQ.isError || !breakdownQ.data ? (
            <div style={{ color: DS.rose, fontSize: 13 }}>Failed to load top product breakdown data.</div>
          ) : (
            <>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
                <MetricCard label="Selected Revenue" value={eur(breakdownQ.data.summary.revenue)} color={DS.sky} />
                <MetricCard label="Units" value={breakdownQ.data.summary.units.toLocaleString("en-US")} color={DS.emerald} />
                <MetricCard label="Orders" value={breakdownQ.data.summary.orders.toLocaleString("en-US")} color={DS.violet} />
                <MetricCard label="Customers" value={breakdownQ.data.summary.customers.toLocaleString("en-US")} color={DS.amber} />
                <MetricCard label="Avg Order Value" value={eur(breakdownQ.data.summary.averageOrderValue)} color={DS.mid} />
                <MetricCard label="Revenue Share" value={`${breakdownQ.data.summary.revenueSharePct.toFixed(2)}%`} color={DS.rose} />
              </div>

              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(680px, 1.15fr) minmax(520px, 1fr)" }}>
                <TopProductsListPanel
                  products={pagedProducts}
                  total={filteredTopProducts.length}
                  page={safePage}
                  totalPages={totalPages}
                  selectedProductId={breakdownQ.data.selectedProductId}
                  onSelect={(id) => setSelectedProductId(id)}
                  onPageChange={setProductPage}
                  searchValue={productSearch}
                  onSearchChange={(value) => {
                    setProductSearch(value);
                    setProductPage(1);
                  }}
                />

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ ...panelStyle, padding: 12 }}>
                    <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600 }}>
                      Selected Product
                    </div>
                    {breakdownQ.data.selectedProduct ? (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 13, color: DS.hi, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {breakdownQ.data.selectedProduct.name}
                        </div>
                        <div style={{ fontSize: 11, color: DS.lo, marginTop: 3 }}>
                          SKU: {breakdownQ.data.selectedProduct.articleNumber} | Product ID: {breakdownQ.data.selectedProduct.productId}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: DS.lo, marginTop: 8 }}>No selected product in current range.</div>
                    )}
                  </div>

                  <div style={{ ...panelStyle, padding: 12, display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                    <DimensionList title="Countries" rows={breakdownQ.data.breakdown.countries} color={DS.sky} limit={10} />
                    <DimensionList title="Sales Channels" rows={breakdownQ.data.breakdown.channels} color={DS.violet} limit={10} />
                    <DimensionList title="Platforms" rows={breakdownQ.data.breakdown.platforms} color={DS.emerald} limit={10} />
                    <DimensionList title="Payment Methods" rows={breakdownQ.data.breakdown.paymentMethods} color={DS.amber} limit={10} />
                    <div style={{ gridColumn: "1 / -1" }}>
                      <DimensionList title="Shipping Methods" rows={breakdownQ.data.breakdown.shippingMethods} color={DS.rose} limit={12} />
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
                <OrderRecordsTable rows={breakdownQ.data.records.orders} />
                <CustomerRecordsTable rows={breakdownQ.data.records.customers} />
              </div>
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

function TopProductsListPanel({
  products,
  total,
  page,
  totalPages,
  selectedProductId,
  onSelect,
  onPageChange,
  searchValue,
  onSearchChange,
}: {
  products: TopProductListItem[];
  total: number;
  page: number;
  totalPages: number;
  selectedProductId: number | null;
  onSelect: (id: number) => void;
  onPageChange: (page: number) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
}) {
  const maxRevenue = Math.max(...products.map((row) => row.revenue), 0);
  return (
    <div style={{ ...panelStyle, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 500 }}>
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${DS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600 }}>Top Products (Revenue)</div>
        <input
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search product or SKU"
          style={{ width: 230, ...inputStyle }}
        />
      </div>
      <div style={{ maxHeight: 460, overflow: "auto", padding: "8px 10px" }}>
        {products.length === 0 ? (
          <div style={{ color: DS.lo, fontSize: 12, padding: "12px 6px" }}>No products found.</div>
        ) : (
          products.map((row) => {
            const active = selectedProductId === row.productId;
            const width = maxRevenue > 0 ? Math.max(4, Math.round((row.revenue / maxRevenue) * 100)) : 0;
            return (
              <div
                key={`tp-${row.productId}`}
                onClick={() => onSelect(row.productId)}
                style={{
                  cursor: "pointer",
                  border: `1px solid ${active ? "rgba(56,189,248,0.38)" : "rgba(255,255,255,0.06)"}`,
                  borderRadius: 10,
                  padding: "8px 10px",
                  marginBottom: 8,
                  background: active ? "rgba(56,189,248,0.08)" : "rgba(255,255,255,0.015)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ color: DS.mid, fontFamily: DS.mono, fontSize: 11, width: 24, flexShrink: 0 }}>
                      #{row.rank}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: DS.hi, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {row.name}
                      </div>
                      <div style={{ color: DS.lo, fontSize: 10, marginTop: 1 }}>
                        {row.articleNumber}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: DS.sky, fontFamily: DS.mono, fontSize: 12 }}>{eur(row.revenue)}</div>
                    <div style={{ color: DS.lo, fontSize: 10 }}>{row.orders.toLocaleString("en-US")} orders</div>
                  </div>
                </div>
                <div style={{ marginTop: 6, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${width}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, rgba(16,185,129,0.9), rgba(56,189,248,0.8))",
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderTop: `1px solid ${DS.border}` }}>
        <div style={{ fontSize: 11, color: DS.lo }}>
          Page {page} / {totalPages} - {total.toLocaleString("en-US")} products
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} style={pagerBtn(page <= 1)}>
            Prev
          </button>
          <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} style={pagerBtn(page >= totalPages)}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function DimensionList({
  title,
  rows,
  color,
  limit,
}: {
  title: string;
  rows: ProductBreakdownRow[];
  color: string;
  limit: number;
}) {
  const view = rows.slice(0, limit);
  const maxRevenue = Math.max(...view.map((r) => r.revenue), 0);
  return (
    <div style={{ border: `1px solid ${DS.border}`, borderRadius: 10, background: "rgba(255,255,255,0.012)", overflow: "hidden" }}>
      <div style={{ padding: "7px 10px", borderBottom: `1px solid ${DS.border}`, fontSize: 11, color: DS.hi, fontWeight: 600 }}>
        {title}
      </div>
      <div style={{ maxHeight: 170, overflow: "auto" }}>
        {view.length === 0 ? (
          <div style={{ padding: "8px 10px", color: DS.lo, fontSize: 11 }}>No data</div>
        ) : (
          view.map((row) => {
            const width = maxRevenue > 0 ? Math.max(4, Math.round((row.revenue / maxRevenue) * 100)) : 0;
            return (
              <div key={`${title}-${row.name}`} style={{ padding: "7px 10px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 11, color: DS.hi, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
                    {row.name}
                  </div>
                  <div style={{ fontSize: 10, color: DS.lo }}>{row.orders.toLocaleString("en-US")} ord</div>
                </div>
                <div style={{ marginTop: 4, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ flex: 1, height: 4, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                    <div style={{ width: `${width}%`, height: "100%", background: color }} />
                  </div>
                  <div style={{ fontSize: 10, color: DS.mid, fontFamily: DS.mono }}>{eur(row.revenue)}</div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function OrderRecordsTable({ rows }: { rows: Array<{ orderNumber: string; orderDate: string; revenue: number; units: number; country: string; channel: string; platform: string; paymentMethod: string; shippingMethod: string; customerName: string }> }) {
  return (
    <div style={{ ...panelStyle, minHeight: 320, overflow: "hidden" }}>
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${DS.border}`, fontSize: 12, color: DS.hi, fontWeight: 600 }}>
        Product Order Records ({rows.length.toLocaleString("en-US")})
      </div>
      <div style={{ maxHeight: 300, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Order", "Date", "Revenue", "Units", "Country", "Platform", "Shipping"].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} style={emptyCellStyle}>No order records in this range.</td></tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.orderNumber}-${row.orderDate}`}>
                  <td style={tdStyle}>{row.orderNumber}</td>
                  <td style={tdStyle}>{row.orderDate}</td>
                  <td style={{ ...tdStyle, color: DS.sky, fontFamily: DS.mono }}>{eur(row.revenue)}</td>
                  <td style={{ ...tdStyle, color: DS.emerald, fontFamily: DS.mono }}>{row.units.toLocaleString("en-US")}</td>
                  <td style={tdStyle}>{row.country}</td>
                  <td style={tdStyle}>{row.platform || row.channel}</td>
                  <td style={tdStyle}>{row.shippingMethod}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomerRecordsTable({ rows }: { rows: Array<{ customerName: string; email: string; country: string; orders: number; units: number; revenue: number; averageOrderValue: number; lastOrderDate: string }> }) {
  return (
    <div style={{ ...panelStyle, minHeight: 320, overflow: "hidden" }}>
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${DS.border}`, fontSize: 12, color: DS.hi, fontWeight: 600 }}>
        Customer Breakdown ({rows.length.toLocaleString("en-US")})
      </div>
      <div style={{ maxHeight: 300, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Customer", "Country", "Orders", "Units", "Revenue", "AOV", "Last Order"].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} style={emptyCellStyle}>No customer records in this range.</td></tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.customerName}-${row.email}`}>
                  <td style={tdStyle}>{row.customerName}</td>
                  <td style={tdStyle}>{row.country}</td>
                  <td style={{ ...tdStyle, color: DS.violet, fontFamily: DS.mono }}>{row.orders.toLocaleString("en-US")}</td>
                  <td style={{ ...tdStyle, color: DS.emerald, fontFamily: DS.mono }}>{row.units.toLocaleString("en-US")}</td>
                  <td style={{ ...tdStyle, color: DS.sky, fontFamily: DS.mono }}>{eur(row.revenue)}</td>
                  <td style={{ ...tdStyle, color: DS.amber, fontFamily: DS.mono }}>{eur(row.averageOrderValue)}</td>
                  <td style={tdStyle}>{row.lastOrderDate}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ border: `1px solid ${DS.border}`, borderRadius: 10, background: "rgba(255,255,255,0.012)", padding: "10px 12px" }}>
      <div style={{ fontSize: 11, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 20, color, fontWeight: 700, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </div>
    </div>
  );
}

const closeBtnStyle = {
  fontSize: 12,
  color: DS.hi,
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${DS.border}`,
  borderRadius: 8,
  padding: "6px 12px",
  cursor: "pointer",
} as const;

const panelStyle = {
  border: `1px solid ${DS.border}`,
  borderRadius: 12,
  background: "rgba(255,255,255,0.015)",
} as const;

const inputStyle = {
  fontSize: 11,
  color: DS.hi,
  background: "rgba(255,255,255,0.04)",
  border: `1px solid ${DS.border}`,
  borderRadius: 8,
  padding: "6px 9px",
} as const;

const thStyle = {
  textAlign: "left" as const,
  fontSize: 10,
  color: DS.lo,
  letterSpacing: "0.06em",
  textTransform: "uppercase" as const,
  padding: "8px 10px",
  borderBottom: `1px solid ${DS.border}`,
  position: "sticky" as const,
  top: 0,
  background: "#091327",
};

const tdStyle = {
  padding: "8px 10px",
  fontSize: 11,
  color: DS.hi,
  borderBottom: "1px solid rgba(255,255,255,0.04)",
  verticalAlign: "top" as const,
};

const emptyCellStyle = {
  padding: "10px",
  fontSize: 12,
  color: DS.lo,
};

function pagerBtn(disabled: boolean) {
  return {
    fontSize: 11,
    color: disabled ? DS.lo : DS.hi,
    border: `1px solid ${DS.border}`,
    background: "rgba(255,255,255,0.04)",
    borderRadius: 8,
    padding: "5px 9px",
    cursor: disabled ? "not-allowed" : "pointer",
  } as const;
}
