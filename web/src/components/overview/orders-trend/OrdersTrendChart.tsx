"use client";

import dynamic from "next/dynamic";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import type { OrdersTrendPoint } from "@/hooks/useOrdersTrend";

const ReactECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
  loading: () => <div style={{ height: 420 }} />,
});

interface ZoomPayload {
  start: number;
  end: number;
  points: OrdersTrendPoint[];
}

interface Props {
  points: OrdersTrendPoint[];
  onDrillDown: (point: OrdersTrendPoint) => void;
  onZoomChange: (payload: ZoomPayload) => void;
  metric?: "orders" | "aov";
  height?: number;
}

export function OrdersTrendChart({ points, onDrillDown, onZoomChange, metric = "orders", height = 420 }: Props) {
  const isAov = metric === "aov";
  const option = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(6,14,28,0.95)",
      borderColor: "rgba(139,92,246,0.25)",
      textStyle: { color: DS.hi },
      formatter: (params: Array<{ dataIndex: number }>) => {
        const idx = params?.[0]?.dataIndex;
        const row = points[idx];
        if (!row) return "";
        const yoy = row.changePercent == null ? "-" : `${row.changePercent >= 0 ? "+" : ""}${row.changePercent.toFixed(2)}%`;
        return [
          `<strong>${row.label}</strong>`,
          `${isAov ? "AOV" : "Orders"}: ${isAov ? eur(row.averageOrderValue) : row.orders.toLocaleString("en-US")}`,
          `Prior Year Orders: ${row.priorOrders.toLocaleString("en-US")}`,
          `YoY: ${yoy}`,
          `Revenue: ${eur(row.revenue)}`,
          `Customers: ${row.customers.toLocaleString("en-US")}`,
          `AOV: ${eur(row.averageOrderValue)}`,
        ].join("<br/>");
      },
    },
    legend: {
      data: isAov ? ["Avg Order Value", "Orders"] : ["Orders", "Prior Year Orders"],
      textStyle: { color: DS.lo },
      top: 10,
    },
    grid: {
      left: 56,
      right: 28,
      top: 58,
      bottom: 88,
    },
    xAxis: {
      type: "category",
      data: points.map((p) => p.label),
      boundaryGap: false,
      axisLine: { lineStyle: { color: "rgba(255,255,255,0.12)" } },
      axisLabel: { color: DS.lo, fontSize: 11 },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } },
      axisLabel: {
        color: DS.lo,
        formatter: (value: number) => (isAov ? `€${Math.round(value)}` : `${Math.round(value)}`),
      },
    },
    dataZoom: [
      { type: "inside", xAxisIndex: 0, start: 0, end: 100 },
      { type: "slider", xAxisIndex: 0, start: 0, end: 100, bottom: 24, height: 20 },
    ],
    series: [
      {
        name: isAov ? "Avg Order Value" : "Orders",
        type: isAov ? "line" : "bar",
        smooth: isAov,
        symbolSize: isAov ? 5 : 0,
        barMaxWidth: 24,
        itemStyle: { color: isAov ? DS.emerald : "rgba(139,92,246,0.78)", borderRadius: [4, 4, 0, 0] },
        lineStyle: isAov ? { color: DS.emerald, width: 2.5 } : undefined,
        areaStyle: isAov ? { color: "rgba(52,211,153,0.16)" } : undefined,
        data: points.map((p) => (isAov ? p.averageOrderValue : p.orders)),
      },
      {
        name: isAov ? "Orders" : "Prior Year Orders",
        type: "line",
        smooth: true,
        symbolSize: 6,
        itemStyle: { color: DS.sky },
        lineStyle: { color: DS.sky, width: 2, type: isAov ? "solid" : "dashed" },
        data: points.map((p) => p.priorOrders),
      },
    ],
    animationDuration: 350,
  };

  const onEvents = {
    click: (params: { dataIndex?: number }) => {
      const index = params?.dataIndex;
      if (typeof index !== "number") return;
      const row = points[index];
      if (!row) return;
      onDrillDown(row);
    },
    datazoom: (event: { batch?: Array<{ start?: number; end?: number }>; start?: number; end?: number }) => {
      const zoom = event?.batch?.[0] || event;
      const start = Number(zoom?.start ?? 0);
      const end = Number(zoom?.end ?? 100);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;
      onZoomChange({ start, end, points });
    },
  };

  return (
    <ReactECharts
      option={option}
      onEvents={onEvents}
      notMerge
      lazyUpdate
      style={{ width: "100%", height }}
    />
  );
}
