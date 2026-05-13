"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import { useFilterStore } from "@/lib/store";
import { useShallow } from "zustand/react/shallow";
import {
  type RevenueTrendGranularity,
  type RevenueTrendPoint,
  useRevenueTrend,
} from "@/hooks/useRevenueTrend";
import { useSalesOrders } from "@/hooks/useSalesData";
import { RevenueSummaryCards } from "./RevenueSummaryCards";
import { RevenueTrendChart } from "./RevenueTrendChart";
import { RevenueDetailsTable } from "./RevenueDetailsTable";

type TrendRange = { from: string; to: string };
type TrendState = { granularity: RevenueTrendGranularity; range: TrendRange };

interface Props {
  open: boolean;
  onClose: () => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function toMonthBounds(dateIso: string): TrendRange {
  const [yRaw, mRaw] = dateIso.split("-");
  const y = Number.parseInt(yRaw, 10);
  const m = Number.parseInt(mRaw, 10);
  const first = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  const lastDate = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(lastDate).padStart(2, "0")}`;
  return { from: first, to: last };
}

function normalizeRangeForGranularity(range: TrendRange, granularity: RevenueTrendGranularity): TrendRange {
  if (granularity === "day") return range;
  if (granularity === "month") {
    const fromBounds = toMonthBounds(range.from);
    const toBounds = toMonthBounds(range.to);
    return { from: fromBounds.from, to: toBounds.to };
  }
  const fromYear = range.from.slice(0, 4);
  const toYear = range.to.slice(0, 4);
  return { from: `${fromYear}-01-01`, to: `${toYear}-12-31` };
}

function resolveInitialRange(
  range: string,
  from?: string,
  to?: string,
): TrendRange {
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

function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function chooseGranularity(from: string, to: string): RevenueTrendGranularity {
  const days = daysBetween(from, to);
  if (days > 540) return "year";
  if (days > 62) return "month";
  return "day";
}

function getVisibleRangeFromZoom(
  start: number,
  end: number,
  points: RevenueTrendPoint[],
): TrendRange | null {
  if (points.length === 0) return null;
  const max = points.length - 1;
  const startIndex = Math.max(0, Math.min(max, Math.floor((start / 100) * max)));
  const endIndex = Math.max(startIndex, Math.min(max, Math.ceil((end / 100) * max)));
  const from = points[startIndex]?.periodStart;
  const to = points[endIndex]?.periodEnd;
  if (!from || !to) return null;
  return { from, to };
}

function sameState(a: TrendState, b: TrendState): boolean {
  return (
    a.granularity === b.granularity &&
    a.range.from === b.range.from &&
    a.range.to === b.range.to
  );
}

function formatMonthYear(dateIso: string): string {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m] = dateIso.split("-");
  const monthIndex = Number.parseInt(m, 10) - 1;
  if (monthIndex < 0 || monthIndex > 11) return dateIso;
  return `${names[monthIndex]} ${y}`;
}

function breadcrumbLabel(state: TrendState): string {
  if (state.granularity === "year") return "All Years";
  if (state.granularity === "month") {
    const fromYear = state.range.from.slice(0, 4);
    const toYear = state.range.to.slice(0, 4);
    return fromYear === toYear ? fromYear : `${fromYear} - ${toYear}`;
  }
  const monthLabel = formatMonthYear(state.range.from);
  if (state.range.from.slice(0, 7) === state.range.to.slice(0, 7)) return monthLabel;
  return `${monthLabel} to ${formatMonthYear(state.range.to)}`;
}

export function RevenueTrendFullModal({ open, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [granularity, setGranularity] = useState<RevenueTrendGranularity>("year");
  const [range, setRange] = useState<TrendRange>({ from: "2000-01-01", to: todayIso() });
  const [history, setHistory] = useState<TrendState[]>([]);
  const [detailsPage, setDetailsPage] = useState(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const rootState = useMemo<TrendState>(() => {
    const initial = resolveInitialRange(filterRange, filterFrom, filterTo);
    return { granularity: "year", range: initial };
  }, [filterRange, filterFrom, filterTo]);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    setGranularity(rootState.granularity);
    setRange(rootState.range);
    setHistory([]);
  }, [open, rootState]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const revenueTrendQ = useRevenueTrend(
    {
      from: range.from,
      to: range.to,
      granularity,
      compare: "prior_year",
      status,
      invoice,
      channel: salesChannel,
      platform,
      paymentMethod,
    },
    open,
  );

  const data = revenueTrendQ.data;
  const detailsQ = useSalesOrders({
    from: range.from,
    to: range.to,
    page: detailsPage,
    limit: 20,
    enabled: open,
  });
  const detailRows = detailsQ.data?.rows ?? [];
  const detailTotal = detailsQ.data?.total ?? 0;
  const detailTotalPages = Math.max(1, Math.ceil(detailTotal / 20));

  const scopedParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("from", range.from);
    params.set("to", range.to);
    if (status && status !== "all") params.set("status", status);
    if (invoice && invoice !== "all") params.set("invoice", invoice);
    if (salesChannel && salesChannel !== "all") params.set("channel", salesChannel);
    if (platform && platform !== "all") params.set("platform", platform);
    if (paymentMethod && paymentMethod !== "all") params.set("paymentMethod", paymentMethod);
    return params.toString();
  }, [range.from, range.to, status, invoice, salesChannel, platform, paymentMethod]);

  const channelQ = useQuery({
    queryKey: ["overview", "revenue-modal", "channels", scopedParams],
    enabled: open,
    queryFn: async () => {
      const res = await api.get(`/sales/channels?${scopedParams}`);
      const rows = (res.data?.data ?? res.data ?? []) as Array<Record<string, unknown>>;
      return rows
        .map((r) => ({
          label: String(r.channel ?? "Unknown"),
          revenue: Number(r.revenue ?? 0) || 0,
          orders: Number(r.orders ?? 0) || 0,
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8);
    },
    staleTime: 60_000,
  });

  const paymentShipQ = useQuery({
    queryKey: ["overview", "revenue-modal", "payment-shipping", scopedParams],
    enabled: open,
    queryFn: async () => {
      const res = await api.get(`/sales/payment-shipping?${scopedParams}`);
      const payload = (res.data?.data ?? res.data ?? {}) as Record<string, unknown>;
      const payment = Array.isArray(payload.payment_methods) ? payload.payment_methods : [];
      const shipping = Array.isArray(payload.shipping_methods) ? payload.shipping_methods : [];
      return {
        payment: payment
          .map((r) => ({
            label: String((r as Record<string, unknown>).label ?? "Unknown"),
            revenue: Number((r as Record<string, unknown>).revenue ?? 0) || 0,
            orders: Number((r as Record<string, unknown>).orders ?? 0) || 0,
          }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 8),
        shipping: shipping
          .map((r) => ({
            label: String((r as Record<string, unknown>).label ?? "Unknown"),
            revenue: Number((r as Record<string, unknown>).revenue ?? 0) || 0,
            orders: Number((r as Record<string, unknown>).orders ?? 0) || 0,
          }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 8),
      };
    },
    staleTime: 60_000,
  });

  const countryQ = useQuery({
    queryKey: ["overview", "revenue-modal", "countries", scopedParams],
    enabled: open,
    queryFn: async () => {
      const params = new URLSearchParams(scopedParams);
      params.set("locationDimension", "country");
      const res = await api.get(`/sales/regional?${params.toString()}`);
      const payload = (res.data?.data ?? res.data ?? {}) as Record<string, unknown>;
      const rows = Array.isArray(payload.regions) ? payload.regions : [];
      return rows
        .map((r) => {
          const item = r as Record<string, unknown>;
          return {
            label: String(item.name ?? "Unknown"),
            revenue: Number(item.revenue ?? 0) || 0,
            orders: Number(item.orders ?? 0) || 0,
          };
        })
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8);
    },
    staleTime: 60_000,
  });

  const platformQ = useQuery({
    queryKey: ["overview", "revenue-modal", "platforms", scopedParams],
    enabled: open,
    queryFn: async () => {
      const params = new URLSearchParams(scopedParams);
      params.set("locationDimension", "country");
      const res = await api.get(`/sales/regional?${params.toString()}`);
      const payload = (res.data?.data ?? res.data ?? {}) as Record<string, unknown>;
      const rows = Array.isArray(payload.platform_mix) ? payload.platform_mix : [];
      return rows
        .map((r) => {
          const item = r as Record<string, unknown>;
          return {
            label: String(item.platform ?? "Unknown"),
            revenue: Number(item.revenue ?? 0) || 0,
            orders: Number(item.orders ?? 0) || 0,
          };
        })
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8);
    },
    staleTime: 60_000,
  });

  const pushStateAndSet = (next: TrendState) => {
    const current: TrendState = { granularity, range };
    if (sameState(current, next)) return;
    setHistory((prev) => [...prev, current]);
    setGranularity(next.granularity);
    setRange(next.range);
  };

  const onDrillDown = (point: RevenueTrendPoint) => {
    if (granularity === "year") {
      const year = point.periodStart.slice(0, 4);
      pushStateAndSet({
        granularity: "month",
        range: { from: `${year}-01-01`, to: `${year}-12-31` },
      });
      return;
    }
    if (granularity === "month") {
      const monthBounds = toMonthBounds(point.periodStart);
      pushStateAndSet({
        granularity: "day",
        range: monthBounds,
      });
    }
  };

  const onZoomChange = ({ start, end, points }: { start: number; end: number; points: RevenueTrendPoint[] }) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const visible = getVisibleRangeFromZoom(start, end, points);
      if (!visible) return;
      const nextGranularity = chooseGranularity(visible.from, visible.to);
      if (nextGranularity === granularity) return;
      const nextState: TrendState = {
        granularity: nextGranularity,
        range: normalizeRangeForGranularity(visible, nextGranularity),
      };
      pushStateAndSet(nextState);
    }, 400);
  };

  const onBack = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setHistory((prev) => prev.slice(0, -1));
    setGranularity(previous.granularity);
    setRange(previous.range);
  };

  useEffect(() => {
    setDetailsPage(1);
  }, [granularity, range.from, range.to]);

  const trail: TrendState[] = [...history, { granularity, range }];

  const onBreadcrumbClick = (index: number) => {
    const target = trail[index];
    if (!target) return;
    setGranularity(target.granularity);
    setRange(target.range);
    setHistory(trail.slice(0, index));
  };

  if (!open || !mounted) return null;

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1300,
          background: "rgba(0,0,0,0.82)",
          backdropFilter: "blur(5px)",
        }}
      />

      <div
        style={{
          position: "fixed",
          inset: "3.5vh 2.5vw",
          zIndex: 1310,
          borderRadius: 18,
          border: `1px solid rgba(56,189,248,0.25)`,
          background: "#071122",
          boxShadow: "0 30px 80px rgba(0,0,0,0.8)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: `1px solid ${DS.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            background: "rgba(255,255,255,0.015)",
          }}
        >
          <div>
            <div style={{ fontSize: 16, color: DS.hi, fontWeight: 700 }}>Revenue Trend Full View</div>
            <div style={{ fontSize: 11, color: DS.lo, marginTop: 3 }}>
              {range.from} to {range.to} · {granularity.toUpperCase()}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {history.length > 0 && (
              <button
                onClick={onBack}
                style={{
                  fontSize: 12,
                  color: DS.hi,
                  background: "rgba(255,255,255,0.04)",
                  border: `1px solid ${DS.border}`,
                  borderRadius: 8,
                  padding: "6px 10px",
                  cursor: "pointer",
                }}
              >
                Back
              </button>
            )}
            <button
              onClick={onClose}
              style={{
                fontSize: 12,
                color: DS.hi,
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${DS.border}`,
                borderRadius: 8,
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </div>

        <div
          style={{
            padding: "8px 18px",
            borderBottom: `1px solid ${DS.border}`,
            display: "flex",
            alignItems: "center",
            gap: 8,
            overflowX: "auto",
          }}
        >
          {trail.map((item, index) => {
            const isLast = index === trail.length - 1;
            return (
              <div key={`${item.granularity}-${item.range.from}-${item.range.to}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {index > 0 && <span style={{ color: DS.lo }}>›</span>}
                <button
                  onClick={() => onBreadcrumbClick(index)}
                  disabled={isLast}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: isLast ? DS.hi : DS.sky,
                    cursor: isLast ? "default" : "pointer",
                    fontSize: 12,
                    whiteSpace: "nowrap",
                    fontWeight: isLast ? 700 : 500,
                    padding: 0,
                  }}
                >
                  {breadcrumbLabel(item)}
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ padding: 16, overflow: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {revenueTrendQ.isLoading ? (
            <div style={{ color: DS.lo, fontSize: 13 }}>Loading trend data...</div>
          ) : revenueTrendQ.isError || !data ? (
            <div style={{ color: DS.rose, fontSize: 13 }}>Failed to load trend data.</div>
          ) : (
            <>
              <RevenueSummaryCards summary={data.summary} />
              <div
                style={{
                  border: `1px solid ${DS.border}`,
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.015)",
                  padding: "8px 8px 0",
                }}
              >
                <RevenueTrendChart
                  points={data.points}
                  onDrillDown={onDrillDown}
                  onZoomChange={onZoomChange}
                />
              </div>

              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(360px, 1fr) minmax(520px, 1.4fr)" }}>
                <RevenueDetailsTable rows={data.points} granularity={granularity} />

                <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", overflow: "hidden", minHeight: 300, display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: `1px solid ${DS.border}` }}>
                    <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600 }}>Revenue Order Records</div>
                    <div style={{ fontSize: 11, color: DS.lo }}>{detailTotal.toLocaleString("en-US")} total</div>
                  </div>
                  <div style={{ maxHeight: 260, overflow: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          {["Order #", "Date", "Revenue", "Channel", "Payment", "Shipping", "City/Country"].map((h) => (
                            <th
                              key={h}
                              style={{
                                textAlign: "left",
                                fontSize: 10,
                                color: DS.lo,
                                letterSpacing: "0.06em",
                                textTransform: "uppercase",
                                padding: "8px 12px",
                                borderBottom: `1px solid ${DS.border}`,
                                position: "sticky",
                                top: 0,
                                background: "#091327",
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {detailsQ.isLoading && (
                          <tr>
                            <td colSpan={7} style={{ padding: "10px 12px", fontSize: 12, color: DS.lo }}>Loading orders...</td>
                          </tr>
                        )}
                        {detailsQ.isError && (
                          <tr>
                            <td colSpan={7} style={{ padding: "10px 12px", fontSize: 12, color: DS.rose }}>Failed to load order records.</td>
                          </tr>
                        )}
                        {!detailsQ.isLoading && !detailsQ.isError && detailRows.length === 0 && (
                          <tr>
                            <td colSpan={7} style={{ padding: "10px 12px", fontSize: 12, color: DS.lo }}>No order records in this range.</td>
                          </tr>
                        )}
                        {!detailsQ.isLoading && !detailsQ.isError && detailRows.map((row) => (
                          <tr key={`${row.order_number}-${row.order_date}-${row.customer_number ?? ""}`}>
                            <td style={{ padding: "8px 12px", fontSize: 12, color: DS.hi, fontFamily: DS.mono }}>{row.order_number || "-"}</td>
                            <td style={{ padding: "8px 12px", fontSize: 12, color: DS.lo }}>{String(row.order_date || "").slice(0, 10)}</td>
                            <td style={{ padding: "8px 12px", fontSize: 12, color: DS.sky, fontFamily: DS.mono }}>{eur(row.gross_revenue)}</td>
                            <td style={{ padding: "8px 12px", fontSize: 12, color: DS.hi }}>{row.channel || "Unknown"}</td>
                            <td style={{ padding: "8px 12px", fontSize: 12, color: DS.hi }}>{row.payment_method || "Unknown"}</td>
                            <td style={{ padding: "8px 12px", fontSize: 12, color: DS.hi }}>{row.shipping_method || "Unknown"}</td>
                            <td style={{ padding: "8px 12px", fontSize: 12, color: DS.hi }}>{[row.city, row.country].filter(Boolean).join(", ") || "Unknown"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderTop: `1px solid ${DS.border}`, marginTop: "auto" }}>
                    <div style={{ fontSize: 11, color: DS.lo }}>Page {detailsPage} / {detailTotalPages}</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => setDetailsPage((p) => Math.max(1, p - 1))}
                        disabled={detailsPage <= 1}
                        style={{
                          fontSize: 11,
                          color: detailsPage <= 1 ? DS.lo : DS.hi,
                          border: `1px solid ${DS.border}`,
                          background: "rgba(255,255,255,0.04)",
                          borderRadius: 8,
                          padding: "5px 9px",
                          cursor: detailsPage <= 1 ? "not-allowed" : "pointer",
                        }}
                      >
                        Prev
                      </button>
                      <button
                        onClick={() => setDetailsPage((p) => Math.min(detailTotalPages, p + 1))}
                        disabled={detailsPage >= detailTotalPages}
                        style={{
                          fontSize: 11,
                          color: detailsPage >= detailTotalPages ? DS.lo : DS.hi,
                          border: `1px solid ${DS.border}`,
                          background: "rgba(255,255,255,0.04)",
                          borderRadius: 8,
                          padding: "5px 9px",
                          cursor: detailsPage >= detailTotalPages ? "not-allowed" : "pointer",
                        }}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", overflow: "hidden" }}>
                <div style={{ padding: "10px 12px", borderBottom: `1px solid ${DS.border}` }}>
                  <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600 }}>Revenue Drivers Breakdown</div>
                  <div style={{ fontSize: 11, color: DS.lo, marginTop: 2 }}>Live aggregated segments for the selected range</div>
                </div>
                <div style={{ display: "grid", gap: 8, padding: 10, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                  <RevenueList title="Top Channels" rows={channelQ.data ?? []} />
                  <RevenueList title="Top Platforms" rows={platformQ.data ?? []} />
                  <RevenueList title="Top Countries" rows={countryQ.data ?? []} />
                  <RevenueList title="Top Payment Methods" rows={paymentShipQ.data?.payment ?? []} />
                  <RevenueList title="Top Shipping Methods" rows={paymentShipQ.data?.shipping ?? []} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

type RevenueListRow = {
  label: string;
  revenue: number;
  orders: number;
};

function RevenueList({ title, rows }: { title: string; rows: RevenueListRow[] }) {
  return (
    <div style={{ border: `1px solid ${DS.border}`, borderRadius: 10, overflow: "hidden", background: "rgba(255,255,255,0.01)" }}>
      <div style={{ padding: "8px 10px", borderBottom: `1px solid ${DS.border}`, fontSize: 11, color: DS.hi, fontWeight: 600 }}>{title}</div>
      <div style={{ maxHeight: 146, overflow: "auto" }}>
        {rows.length === 0 && (
          <div style={{ padding: "8px 10px", fontSize: 11, color: DS.lo }}>No data</div>
        )}
        {rows.map((row) => (
          <div key={`${title}-${row.label}`} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center", padding: "7px 10px", borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
            <div style={{ fontSize: 11, color: DS.hi, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</div>
            <div style={{ fontSize: 11, color: DS.sky, fontFamily: DS.mono }}>{eur(row.revenue)}</div>
            <div style={{ fontSize: 11, color: DS.amber, fontFamily: DS.mono }}>{row.orders}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
