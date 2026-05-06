"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import { useFilterStore } from "@/lib/store";
import { useShallow } from "zustand/react/shallow";
import { useSalesOrders } from "@/hooks/useSalesData";
import {
  CancelledTrendGranularity,
  CancelledTrendPoint,
  useCancelledTrend,
} from "@/hooks/useCancelledTrend";

const ReactECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
  loading: () => <div style={{ height: 420 }} />,
});

type TrendRange = { from: string; to: string };
type TrendState = { granularity: CancelledTrendGranularity; range: TrendRange };

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

function normalizeRangeForGranularity(range: TrendRange, granularity: CancelledTrendGranularity): TrendRange {
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

function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function chooseGranularity(from: string, to: string): CancelledTrendGranularity {
  const days = daysBetween(from, to);
  if (days > 540) return "year";
  if (days > 62) return "month";
  return "day";
}

function getVisibleRangeFromZoom(start: number, end: number, points: CancelledTrendPoint[]): TrendRange | null {
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
  return a.granularity === b.granularity && a.range.from === b.range.from && a.range.to === b.range.to;
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

function toCsv(rows: CancelledTrendPoint[]): string {
  const header = [
    "Period",
    "Cancelled Orders",
    "Prior Cancelled Orders",
    "Change Percent",
    "Cancellation Rate",
    "Cancelled Revenue",
    "Prior Cancelled Revenue",
    "Total Orders",
  ];
  const lines = rows.map((row) => [
    row.label,
    String(row.cancelledOrders),
    String(row.priorCancelledOrders),
    row.changePercent == null ? "" : row.changePercent.toFixed(2),
    row.cancellationRate.toFixed(2),
    row.cancelledRevenue.toFixed(2),
    row.priorCancelledRevenue.toFixed(2),
    String(row.totalOrders),
  ]);
  return [header, ...lines].map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
}

function exportCsv(rows: CancelledTrendPoint[], granularity: string) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cancelled-orders-trend-${granularity}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function CancelledOrdersTrendModal({ open, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [granularity, setGranularity] = useState<CancelledTrendGranularity>("year");
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
    setDetailsPage(1);
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

  const trendQ = useCancelledTrend(
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

  const data = trendQ.data;
  const detailsQ = useSalesOrders({
    from: range.from,
    to: range.to,
    page: detailsPage,
    limit: 20,
    statusOverride: "cancelled",
    enabled: open,
  });
  const detailRows = detailsQ.data?.rows ?? [];
  const detailTotal = detailsQ.data?.total ?? 0;
  const detailTotalPages = Math.max(1, Math.ceil(detailTotal / 20));
  const pointsForTable = useMemo(
    () => (data?.points ?? []).filter((p) => p.cancelledOrders > 0 || p.cancelledRevenue > 0),
    [data?.points],
  );

  const pushStateAndSet = useCallback((next: TrendState) => {
    const current: TrendState = { granularity, range };
    if (sameState(current, next)) return;
    setHistory((prev) => [...prev, current]);
    setGranularity(next.granularity);
    setRange(next.range);
  }, [granularity, range]);

  const onDrillDown = useCallback((point: CancelledTrendPoint) => {
    if (granularity === "year") {
      const year = point.periodStart.slice(0, 4);
      pushStateAndSet({ granularity: "month", range: { from: `${year}-01-01`, to: `${year}-12-31` } });
      return;
    }
    if (granularity === "month") {
      pushStateAndSet({ granularity: "day", range: toMonthBounds(point.periodStart) });
    }
  }, [granularity, pushStateAndSet]);

  const onZoomChange = useCallback(({ start, end, points }: { start: number; end: number; points: CancelledTrendPoint[] }) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const visible = getVisibleRangeFromZoom(start, end, points);
      if (!visible) return;
      const nextGranularity = chooseGranularity(visible.from, visible.to);
      if (nextGranularity === granularity) return;
      pushStateAndSet({
        granularity: nextGranularity,
        range: normalizeRangeForGranularity(visible, nextGranularity),
      });
    }, 400);
  }, [granularity, pushStateAndSet]);

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

  const chartEvents = useMemo(
    () => ({
      click: (params: { dataIndex?: number }) => {
        const index = params?.dataIndex;
        if (typeof index !== "number") return;
        const point = data?.points?.[index];
        if (!point) return;
        onDrillDown(point);
      },
      datazoom: (event: { batch?: Array<{ start?: number; end?: number }>; start?: number; end?: number }) => {
        const zoom = event?.batch?.[0] || event;
        const start = Number(zoom?.start ?? 0);
        const end = Number(zoom?.end ?? 100);
        if (!Number.isFinite(start) || !Number.isFinite(end) || !data) return;
        onZoomChange({ start, end, points: data.points });
      },
    }),
    [data, onZoomChange],
  );

  const chartOption = useMemo(() => {
    const points = data?.points ?? [];
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(6,14,28,0.95)",
        borderColor: "rgba(244,63,94,0.25)",
        textStyle: { color: DS.hi },
        formatter: (params: Array<{ dataIndex: number }>) => {
          const idx = params?.[0]?.dataIndex;
          const row = points[idx];
          if (!row) return "";
          const yoy = row.changePercent == null ? "-" : `${row.changePercent >= 0 ? "+" : ""}${row.changePercent.toFixed(2)}%`;
          return [
            `<strong>${row.label}</strong>`,
            `Cancelled Orders: ${row.cancelledOrders.toLocaleString("en-US")}`,
            `Prior Cancelled: ${row.priorCancelledOrders.toLocaleString("en-US")}`,
            `YoY: ${yoy}`,
            `Cancel Rate: ${row.cancellationRate.toFixed(2)}%`,
            `Cancelled Revenue: ${eur(row.cancelledRevenue)}`,
            `Total Orders: ${row.totalOrders.toLocaleString("en-US")}`,
          ].join("<br/>");
        },
      },
      legend: { data: ["Cancelled Orders", "Prior Year Orders", "Cancelled Revenue"], textStyle: { color: DS.lo }, top: 10 },
      grid: { left: 56, right: 58, top: 58, bottom: 88 },
      xAxis: { type: "category", data: points.map((p) => p.label), axisLine: { lineStyle: { color: "rgba(255,255,255,0.12)" } }, axisLabel: { color: DS.lo, fontSize: 11 } },
      yAxis: [
        { type: "value", name: "Orders", nameTextStyle: { color: DS.lo }, axisLine: { show: false }, splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } }, axisLabel: { color: DS.lo } },
        { type: "value", name: "Revenue", nameTextStyle: { color: DS.lo }, axisLine: { show: false }, splitLine: { show: false }, axisLabel: { color: DS.lo, formatter: (value: number) => `€${Math.round(value / 1000)}K` } },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: 0, start: 0, end: 100 },
        { type: "slider", xAxisIndex: 0, start: 0, end: 100, bottom: 24, height: 20 },
      ],
      series: [
        {
          name: "Cancelled Orders",
          type: "bar",
          barMaxWidth: 24,
          itemStyle: { color: "rgba(244,63,94,0.78)", borderRadius: [4, 4, 0, 0] },
          data: points.map((p) => p.cancelledOrders),
        },
        {
          name: "Prior Year Orders",
          type: "line",
          smooth: true,
          symbolSize: 6,
          itemStyle: { color: DS.violet },
          lineStyle: { color: DS.violet, width: 2, type: "dashed" },
          data: points.map((p) => p.priorCancelledOrders),
        },
        {
          name: "Cancelled Revenue",
          type: "line",
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 7,
          itemStyle: { color: DS.sky },
          lineStyle: { color: DS.sky, width: 2.2 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(56,189,248,0.28)" },
                { offset: 1, color: "rgba(56,189,248,0.02)" },
              ],
            },
          },
          data: points.map((p) => p.cancelledRevenue),
        },
      ],
      animationDuration: 250,
      animationDurationUpdate: 200,
    };
  }, [data?.points]);

  if (!open || !mounted) return null;

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(0,0,0,0.82)", backdropFilter: "blur(5px)" }} />

      <div
        style={{
          position: "fixed",
          inset: "3.5vh 2.5vw",
          zIndex: 1310,
          borderRadius: 18,
          border: `1px solid rgba(244,63,94,0.28)`,
          background: "#071122",
          boxShadow: "0 30px 80px rgba(0,0,0,0.8)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${DS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "rgba(255,255,255,0.015)" }}>
          <div>
            <div style={{ fontSize: 16, color: DS.hi, fontWeight: 700 }}>Cancelled Orders Full View</div>
            <div style={{ fontSize: 11, color: DS.lo, marginTop: 3 }}>{range.from} to {range.to} · {granularity.toUpperCase()}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {history.length > 0 && (
              <button onClick={onBack} style={{ fontSize: 12, color: DS.hi, background: "rgba(255,255,255,0.04)", border: `1px solid ${DS.border}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>Back</button>
            )}
            <button onClick={onClose} style={{ fontSize: 12, color: DS.hi, background: "rgba(255,255,255,0.04)", border: `1px solid ${DS.border}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>Close</button>
          </div>
        </div>

        <div style={{ padding: "8px 18px", borderBottom: `1px solid ${DS.border}`, display: "flex", alignItems: "center", gap: 8, overflowX: "auto" }}>
          {trail.map((item, index) => {
            const isLast = index === trail.length - 1;
            return (
              <div key={`${item.granularity}-${item.range.from}-${item.range.to}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {index > 0 && <span style={{ color: DS.lo }}>›</span>}
                <button
                  onClick={() => onBreadcrumbClick(index)}
                  disabled={isLast}
                  style={{ border: "none", background: "transparent", color: isLast ? DS.hi : DS.rose, cursor: isLast ? "default" : "pointer", fontSize: 12, whiteSpace: "nowrap", fontWeight: isLast ? 700 : 500, padding: 0 }}
                >
                  {breadcrumbLabel(item)}
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ padding: 16, overflow: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {trendQ.isLoading ? (
            <div style={{ color: DS.lo, fontSize: 13 }}>Loading cancelled trend data...</div>
          ) : trendQ.isError || !data ? (
            <div style={{ color: DS.rose, fontSize: 13 }}>Failed to load cancelled trend data.</div>
          ) : (
            <>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
                <StatCard label="Cancelled Orders" value={data.summary.cancelledOrders.toLocaleString("en-US")} color={DS.rose} />
                <StatCard label="Prior Year" value={data.summary.priorCancelledOrders.toLocaleString("en-US")} color={DS.violet} />
                <StatCard label="YoY" value={data.summary.changePercent == null ? "-" : `${data.summary.changePercent >= 0 ? "+" : ""}${data.summary.changePercent.toFixed(2)}%`} color={data.summary.changePercent == null ? DS.lo : data.summary.changePercent >= 0 ? DS.rose : DS.emerald} />
                <StatCard label="Cancel Rate" value={`${data.summary.cancellationRate.toFixed(2)}%`} color={DS.amber} />
                <StatCard label="Cancelled Revenue" value={eur(data.summary.cancelledRevenue)} color={DS.sky} />
                <StatCard label="Prior Revenue" value={eur(data.summary.priorCancelledRevenue)} color={DS.emerald} />
              </div>

              <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", padding: "8px 8px 0" }}>
                <ReactECharts
                  notMerge
                  lazyUpdate
                  onEvents={chartEvents}
                  option={chartOption}
                  style={{ width: "100%", height: 340 }}
                />
              </div>

              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(340px, 1fr) minmax(520px, 1.4fr)" }}>
                <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", overflow: "hidden", minHeight: 300, display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: `1px solid ${DS.border}` }}>
                    <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600 }}>Cancelled Orders Details</div>
                    <button
                      onClick={() => exportCsv(data.points, granularity)}
                      style={{ fontSize: 11, color: DS.rose, border: `1px solid rgba(244,63,94,0.25)`, background: "rgba(244,63,94,0.08)", borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}
                    >
                      Export CSV
                    </button>
                  </div>
                  <div style={{ maxHeight: 320, overflow: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          {["Period", "Cancelled", "Prior", "YoY", "Rate", "Revenue", "Total Orders"].map((h) => (
                            <th
                              key={h}
                              style={{ textAlign: "left", fontSize: 10, color: DS.lo, letterSpacing: "0.06em", textTransform: "uppercase", padding: "8px 12px", borderBottom: `1px solid ${DS.border}`, position: "sticky", top: 0, background: "#091327" }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pointsForTable.length === 0 && (
                          <tr>
                            <td colSpan={7} style={{ padding: "10px 12px", fontSize: 12, color: DS.lo }}>
                              No cancelled trend rows for the current filters.
                            </td>
                          </tr>
                        )}
                        {pointsForTable.map((row) => (
                          <tr key={`${row.periodStart}-${row.periodEnd}`}>
                            <td style={{ padding: "8px 12px", fontSize: 12, color: DS.hi }}>{row.label}</td>
                            <td style={{ padding: "8px 12px", fontSize: 12, color: DS.rose, fontFamily: DS.mono }}>{row.cancelledOrders.toLocaleString("en-US")}</td>
                            <td style={{ padding: "8px 12px", fontSize: 12, color: DS.violet, fontFamily: DS.mono }}>{row.priorCancelledOrders.toLocaleString("en-US")}</td>
                            <td style={{ padding: "8px 12px", fontSize: 12, color: row.changePercent == null ? DS.lo : row.changePercent >= 0 ? DS.rose : DS.emerald }}>
                              {row.changePercent == null ? "-" : `${row.changePercent >= 0 ? "+" : ""}${row.changePercent.toFixed(2)}%`}
                            </td>
                            <td style={{ padding: "8px 12px", fontSize: 12, color: DS.amber, fontFamily: DS.mono }}>{row.cancellationRate.toFixed(2)}%</td>
                            <td style={{ padding: "8px 12px", fontSize: 12, color: DS.sky, fontFamily: DS.mono }}>{eur(row.cancelledRevenue)}</td>
                            <td style={{ padding: "8px 12px", fontSize: 12, color: DS.hi, fontFamily: DS.mono }}>{row.totalOrders.toLocaleString("en-US")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", overflow: "hidden", minHeight: 300, display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: `1px solid ${DS.border}` }}>
                    <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600 }}>
                      Cancelled Order Records
                    </div>
                    <div style={{ fontSize: 11, color: DS.lo }}>
                      {detailTotal.toLocaleString("en-US")} total
                    </div>
                  </div>
                  <div style={{ maxHeight: 320, overflow: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          {["Order #", "Date", "Revenue", "Channel", "Payment", "Shipping", "City/Country"].map((h) => (
                            <th
                              key={h}
                              style={{ textAlign: "left", fontSize: 10, color: DS.lo, letterSpacing: "0.06em", textTransform: "uppercase", padding: "8px 12px", borderBottom: `1px solid ${DS.border}`, position: "sticky", top: 0, background: "#091327" }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {detailsQ.isLoading && (
                          <tr>
                            <td colSpan={7} style={{ padding: "10px 12px", fontSize: 12, color: DS.lo }}>Loading cancelled orders...</td>
                          </tr>
                        )}
                        {detailsQ.isError && (
                          <tr>
                            <td colSpan={7} style={{ padding: "10px 12px", fontSize: 12, color: DS.rose }}>Failed to load cancelled order records.</td>
                          </tr>
                        )}
                        {!detailsQ.isLoading && !detailsQ.isError && detailRows.length === 0 && (
                          <tr>
                            <td colSpan={7} style={{ padding: "10px 12px", fontSize: 12, color: DS.lo }}>No cancelled orders in this range.</td>
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
                    <div style={{ fontSize: 11, color: DS.lo }}>
                      Page {detailsPage} / {detailTotalPages}
                    </div>
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

              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "minmax(320px, 1fr) minmax(520px, 1.4fr)" }}>
                <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", overflow: "hidden", minHeight: 260 }}>
                  <div style={{ padding: "10px 12px", borderBottom: `1px solid ${DS.border}` }}>
                    <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600 }}>Cancellation Reason Breakdown</div>
                    <div style={{ fontSize: 11, color: DS.lo, marginTop: 2 }}>Derived from status/payment/shipping signals</div>
                  </div>
                  <div style={{ maxHeight: 260, overflow: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          {["Reason", "Orders", "Share", "Revenue"].map((h) => (
                            <th
                              key={h}
                              style={{ textAlign: "left", fontSize: 10, color: DS.lo, letterSpacing: "0.06em", textTransform: "uppercase", padding: "8px 12px", borderBottom: `1px solid ${DS.border}`, position: "sticky", top: 0, background: "#091327" }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(data.reasonBreakdown ?? []).length === 0 && (
                          <tr>
                            <td colSpan={4} style={{ padding: "10px 12px", fontSize: 12, color: DS.lo }}>
                              No cancellation reasons in this range.
                            </td>
                          </tr>
                        )}
                        {(data.reasonBreakdown ?? []).map((row) => (
                          <tr key={row.label}>
                            <td style={{ padding: "8px 12px", fontSize: 12, color: DS.hi }}>{row.label}</td>
                            <td style={{ padding: "8px 12px", fontSize: 12, color: DS.rose, fontFamily: DS.mono }}>{row.cancelledOrders.toLocaleString("en-US")}</td>
                            <td style={{ padding: "8px 12px", fontSize: 12, color: DS.amber, fontFamily: DS.mono }}>{row.sharePct.toFixed(2)}%</td>
                            <td style={{ padding: "8px 12px", fontSize: 12, color: DS.sky, fontFamily: DS.mono }}>{eur(row.cancelledRevenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", overflow: "hidden", minHeight: 260 }}>
                  <div style={{ padding: "10px 12px", borderBottom: `1px solid ${DS.border}` }}>
                    <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600 }}>Top Risk Segments</div>
                    <div style={{ fontSize: 11, color: DS.lo, marginTop: 2 }}>Where cancellations are concentrated</div>
                  </div>
                  <div style={{ display: "grid", gap: 8, padding: 10, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                    <RiskList title="Platforms" rows={data.topRiskSegments?.platforms ?? []} />
                    <RiskList title="Channels" rows={data.topRiskSegments?.channels ?? []} />
                    <RiskList title="Payment Methods" rows={data.topRiskSegments?.paymentMethods ?? []} />
                    <RiskList title="Shipping Methods" rows={data.topRiskSegments?.shippingMethods ?? []} />
                    <RiskList title="Countries" rows={data.topRiskSegments?.countries ?? []} />
                    <RiskList title="Top SKUs" rows={data.topRiskSegments?.skus ?? []} />
                  </div>
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

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ border: `1px solid ${DS.border}`, background: "rgba(255,255,255,0.02)", borderRadius: 12, padding: "10px 12px" }}>
      <div style={{ fontSize: 10, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 18, color, fontWeight: 700, fontFamily: DS.mono, marginTop: 4 }}>{value}</div>
    </div>
  );
}

type RiskRow = {
  label: string;
  cancelledOrders: number;
  cancelledRevenue: number;
  sharePct: number;
};

function RiskList({ title, rows }: { title: string; rows: RiskRow[] }) {
  return (
    <div style={{ border: `1px solid ${DS.border}`, borderRadius: 10, overflow: "hidden", background: "rgba(255,255,255,0.01)" }}>
      <div style={{ padding: "8px 10px", borderBottom: `1px solid ${DS.border}`, fontSize: 11, color: DS.hi, fontWeight: 600 }}>{title}</div>
      <div style={{ maxHeight: 144, overflow: "auto" }}>
        {rows.length === 0 && (
          <div style={{ padding: "8px 10px", fontSize: 11, color: DS.lo }}>No data</div>
        )}
        {rows.map((row) => (
          <div key={`${title}-${row.label}`} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center", padding: "7px 10px", borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
            <div style={{ fontSize: 11, color: DS.hi, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</div>
            <div style={{ fontSize: 11, color: DS.rose, fontFamily: DS.mono }}>{row.cancelledOrders}</div>
            <div style={{ fontSize: 11, color: DS.amber, fontFamily: DS.mono }}>{row.sharePct.toFixed(1)}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}
