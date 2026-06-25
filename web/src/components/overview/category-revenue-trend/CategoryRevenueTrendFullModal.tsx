"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import { useFilterStore } from "@/lib/store";
import { useShallow } from "zustand/react/shallow";
import {
  CategoryBreakdownDimRow,
  CategoryBreakdownProduct,
  useCategoryBreakdown,
} from "@/hooks/useCategoryBreakdown";

interface Props {
  open: boolean;
  onClose: () => void;
}

type TrendRange = { from: string; to: string };

const PAGE_SIZE = 14;

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
  if (range === "YEAR" || range === "YTD") return { from: `${end.slice(0, 4)}-01-01`, to: end };
  if (range === "ALL") return { from: "2000-01-01", to: end };
  const map: Record<string, number> = { "7D": 7, "30D": 30, "3M": 90, "6M": 180, "12M": 365, "2Y": 730, "5Y": 1825 };
  const days = map[range] ?? 365;
  return { from: addDays(end, -days), to: end };
}

export function CategoryRevenueTrendFullModal({ open, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryPage, setCategoryPage] = useState(1);

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

  const breakdownQ = useCategoryBreakdown(
    {
      from: range.from,
      to: range.to,
      category: selectedCategory,
      status,
      invoice,
      channel: salesChannel,
      platform,
      paymentMethod,
    },
    open,
  );

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelectedCategory("all");
    setCategorySearch("");
    setCategoryPage(1);
  }, [open, range.from, range.to]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const categories = breakdownQ.data?.categories ?? [];
  const filteredCategories = categories.filter((row) =>
    row.name.toLowerCase().includes(categorySearch.trim().toLowerCase()),
  );
  const totalPages = Math.max(1, Math.ceil(filteredCategories.length / PAGE_SIZE));
  const safePage = Math.min(categoryPage, totalPages);
  const pagedCategories = filteredCategories.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(0,0,0,0.82)", backdropFilter: "blur(5px)" }} />
      <div
        style={{ position: "fixed", inset: "3.5vh 2.5vw", zIndex: 1310, borderRadius: 18, border: "1px solid rgba(56,189,248,0.25)", background: "#071122", boxShadow: "0 30px 80px rgba(0,0,0,0.8)", display: "flex", flexDirection: "column", overflow: "hidden" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${DS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "rgba(255,255,255,0.015)" }}>
          <div>
            <div style={{ fontSize: 16, color: DS.hi, fontWeight: 700 }}>Revenue by Categories - Full View</div>
            <div style={{ fontSize: 11, color: DS.lo, marginTop: 3 }}>
              {range.from} to {range.to} - category-wise real data
            </div>
          </div>
          <button onClick={onClose} style={{ fontSize: 12, color: DS.hi, background: "rgba(255,255,255,0.04)", border: `1px solid ${DS.border}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>
            Close
          </button>
        </div>

        <div style={{ padding: 16, overflow: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {breakdownQ.isLoading ? (
            <div style={{ color: DS.lo, fontSize: 13 }}>Loading category breakdown...</div>
          ) : breakdownQ.isError || !breakdownQ.data ? (
            <div style={{ color: DS.rose, fontSize: 13 }}>Failed to load category breakdown data.</div>
          ) : (
            <>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
                <MetricCard label="Total Categories" value={String(breakdownQ.data.summary.totalCategories)} color={DS.sky} />
                <MetricCard label="Total Revenue" value={eur(breakdownQ.data.summary.totalRevenue)} color={DS.emerald} />
                <MetricCard label="Total Orders" value={breakdownQ.data.summary.totalOrders.toLocaleString("en-US")} color={DS.violet} />
                <MetricCard label="Avg Order Value" value={eur(breakdownQ.data.summary.avgOrderValue)} color={DS.amber} />
              </div>

              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(620px, 1.2fr) minmax(520px, 1fr)" }}>
                <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 430 }}>
                  <div style={{ padding: "10px 12px", borderBottom: `1px solid ${DS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600 }}>All Categories (Real Data)</div>
                    <input
                      value={categorySearch}
                      onChange={(e) => {
                        setCategorySearch(e.target.value);
                        setCategoryPage(1);
                      }}
                      placeholder="Search category..."
                      style={{ width: 220, fontSize: 11, color: DS.hi, background: "rgba(255,255,255,0.04)", border: `1px solid ${DS.border}`, borderRadius: 8, padding: "6px 9px" }}
                    />
                  </div>
                  <div style={{ overflow: "auto", maxHeight: 370 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          {["Category", "Share", "Revenue", "Orders", "Products", "AOV"].map((h) => (
                            <th key={h} style={{ textAlign: "left", fontSize: 10, color: DS.lo, letterSpacing: "0.06em", textTransform: "uppercase", padding: "8px 12px", borderBottom: `1px solid ${DS.border}`, position: "sticky", top: 0, background: "#091327" }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pagedCategories.length === 0 && (
                          <tr><td colSpan={6} style={{ padding: "12px", color: DS.lo, fontSize: 12 }}>No categories found.</td></tr>
                        )}
                        {pagedCategories.map((row) => {
                          const active = selectedCategory === row.name;
                          return (
                            <tr
                              key={row.name}
                              onClick={() => setSelectedCategory(row.name)}
                              style={{ cursor: "pointer", background: active ? "rgba(56,189,248,0.08)" : "transparent" }}
                            >
                              <td style={{ padding: "8px 12px", fontSize: 12, color: DS.hi, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</td>
                              <td style={{ padding: "8px 12px", fontSize: 12, color: DS.mid, fontFamily: DS.mono }}>{row.sharePercent.toFixed(2)}%</td>
                              <td style={{ padding: "8px 12px", fontSize: 12, color: DS.sky, fontFamily: DS.mono }}>{eur(row.revenue)}</td>
                              <td style={{ padding: "8px 12px", fontSize: 12, color: DS.violet, fontFamily: DS.mono }}>{row.orders.toLocaleString("en-US")}</td>
                              <td style={{ padding: "8px 12px", fontSize: 12, color: DS.amber, fontFamily: DS.mono }}>{row.products.toLocaleString("en-US")}</td>
                              <td style={{ padding: "8px 12px", fontSize: 12, color: DS.emerald, fontFamily: DS.mono }}>{eur(row.averageOrderValue)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderTop: `1px solid ${DS.border}` }}>
                    <div style={{ fontSize: 11, color: DS.lo }}>
                      Page {safePage} / {totalPages} - {filteredCategories.length.toLocaleString("en-US")} categories
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => setCategoryPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1} style={pagerBtn(safePage <= 1)}>
                        Prev
                      </button>
                      <button onClick={() => setCategoryPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages} style={pagerBtn(safePage >= totalPages)}>
                        Next
                      </button>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", padding: "10px 12px" }}>
                    <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600 }}>
                      Selected Category: {selectedCategory === "all" ? "All Categories" : selectedCategory}
                    </div>
                    <div style={{ marginTop: 8, display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                      <DimensionList title="Sales Channels" rows={breakdownQ.data.breakdown.channels} color={DS.sky} />
                      <DimensionList title="Platforms" rows={breakdownQ.data.breakdown.platforms} color={DS.violet} />
                      <DimensionList title="Payment Methods" rows={breakdownQ.data.breakdown.paymentMethods} color={DS.amber} />
                      <DimensionList title="Shipping Methods" rows={breakdownQ.data.breakdown.shippingMethods} color={DS.emerald} />
                    </div>
                  </div>

                  <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", padding: "10px 12px" }}>
                    <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600, marginBottom: 6 }}>Country Revenue Split</div>
                    <DimensionList title="Countries" rows={breakdownQ.data.breakdown.countries} color={DS.sky} limit={12} />
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
                <ProductsTable title="Top Products in Selected Category" rows={breakdownQ.data.products.top} accent={DS.emerald} />
                <ProductsTable title="Least Products in Selected Category" rows={breakdownQ.data.products.least} accent={DS.rose} />
              </div>
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ border: `1px solid ${DS.border}`, borderRadius: 10, background: "rgba(255,255,255,0.015)", padding: "10px 12px" }}>
      <div style={{ fontSize: 11, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 20, color, fontWeight: 700, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

function DimensionList({
  title,
  rows,
  color,
  limit = 8,
}: {
  title: string;
  rows: CategoryBreakdownDimRow[];
  color: string;
  limit?: number;
}) {
  const view = rows.slice(0, limit);
  const maxRevenue = Math.max(...view.map((r) => r.revenue), 0);
  return (
    <div style={{ border: `1px solid ${DS.border}`, borderRadius: 10, overflow: "hidden", background: "rgba(255,255,255,0.01)" }}>
      <div style={{ padding: "8px 10px", borderBottom: `1px solid ${DS.border}`, fontSize: 11, color: DS.hi, fontWeight: 600 }}>{title}</div>
      <div style={{ maxHeight: 180, overflow: "auto" }}>
        {view.length === 0 && <div style={{ padding: "8px 10px", fontSize: 11, color: DS.lo }}>No data</div>}
        {view.map((row) => {
          const width = maxRevenue > 0 ? Math.max(4, Math.round((row.revenue / maxRevenue) * 100)) : 0;
          return (
            <div key={`${title}-${row.name}`} style={{ padding: "7px 10px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 11, color: DS.hi, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{row.name}</div>
                <div style={{ fontSize: 11, color: DS.mid, fontFamily: DS.mono }}>{eur(row.revenue)}</div>
              </div>
              <div style={{ marginTop: 5, height: 4, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${width}%`, background: color, opacity: 0.9 }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProductsTable({ title, rows, accent }: { title: string; rows: CategoryBreakdownProduct[]; accent: string }) {
  return (
    <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", overflow: "hidden", minHeight: 300 }}>
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${DS.border}`, fontSize: 12, color: DS.hi, fontWeight: 600 }}>{title}</div>
      <div style={{ maxHeight: 300, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Product", "SKU", "Revenue", "Units", "Orders"].map((h) => (
                <th key={h} style={{ textAlign: "left", fontSize: 10, color: DS.lo, letterSpacing: "0.06em", textTransform: "uppercase", padding: "8px 12px", borderBottom: `1px solid ${DS.border}`, position: "sticky", top: 0, background: "#091327" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} style={{ padding: "10px 12px", color: DS.lo, fontSize: 12 }}>No product rows.</td></tr>
            )}
            {rows.map((row, idx) => (
              <tr key={`${title}-${row.articleNumber}-${idx}`}>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.hi, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.lo, fontFamily: DS.mono }}>{row.articleNumber || "-"}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: accent, fontFamily: DS.mono }}>{eur(row.revenue)}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.amber, fontFamily: DS.mono }}>{row.units.toLocaleString("en-US")}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.violet, fontFamily: DS.mono }}>{row.orders.toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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

