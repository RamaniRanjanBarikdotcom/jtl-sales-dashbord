"use client";

import dynamic from "next/dynamic";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import type { RevenueTrendPoint } from "@/hooks/useRevenueTrend";

const ReactECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
  loading: () => <div style={{ height: 460 }} />,
});

interface ZoomPayload {
  start: number;
  end: number;
  points: RevenueTrendPoint[];
}

interface Props {
  points: RevenueTrendPoint[];
  onDrillDown: (point: RevenueTrendPoint) => void;
  onZoomChange: (payload: ZoomPayload) => void;
}

export function RevenueTrendChart({ points, onDrillDown, onZoomChange }: Props) {
  const option = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(6,14,28,0.95)",
      borderColor: "rgba(56,189,248,0.25)",
      textStyle: { color: DS.hi },
      formatter: (params: Array<{ dataIndex: number }>) => {
        const idx = params?.[0]?.dataIndex;
        const row = points[idx];
        if (!row) return "";
        const yoy = row.changePercent == null ? "-" : `${row.changePercent >= 0 ? "+" : ""}${row.changePercent.toFixed(2)}%`;
        return [
          `<strong>${row.label}</strong>`,
          `Revenue: ${eur(row.revenue)}`,
          `Prior Year: ${eur(row.priorRevenue)}`,
          `YoY: ${yoy}`,
          `Orders: ${row.orders.toLocaleString("en-US")}`,
          `Customers: ${row.customers.toLocaleString("en-US")}`,
          `AOV: ${eur(row.averageOrderValue)}`,
        ].join("<br/>");
      },
    },
    legend: {
      data: ["Current", "Prior Year"],
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
        formatter: (value: number) => {
          if (value >= 1_000_000) return `€${(value / 1_000_000).toFixed(1)}M`;
          if (value >= 1_000) return `€${Math.round(value / 1_000)}K`;
          return `€${Math.round(value)}`;
        },
      },
    },
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: 0,
        start: 0,
        end: 100,
      },
      {
        type: "slider",
        xAxisIndex: 0,
        start: 0,
        end: 100,
        bottom: 24,
        height: 20,
      },
    ],
    series: [
      {
        name: "Current",
        type: "line",
        smooth: true,
        symbolSize: 7,
        itemStyle: { color: DS.sky },
        lineStyle: { color: DS.sky, width: 2.5 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(56,189,248,0.35)" },
              { offset: 1, color: "rgba(56,189,248,0.02)" },
            ],
          },
        },
        data: points.map((p) => p.revenue),
      },
      {
        name: "Prior Year",
        type: "line",
        smooth: true,
        symbolSize: 6,
        itemStyle: { color: DS.violet },
        lineStyle: { color: DS.violet, width: 2, type: "dashed" },
        data: points.map((p) => p.priorRevenue),
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
      style={{ width: "100%", height: 460 }}
    />
  );
}
