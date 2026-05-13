"use client";

import dynamic from "next/dynamic";
import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import type { ActiveProductsTrendPoint } from "@/hooks/useActiveProductsTrend";

const ReactECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
  loading: () => <div style={{ height: 460 }} />,
});

interface ZoomPayload {
  start: number;
  end: number;
  points: ActiveProductsTrendPoint[];
}

interface Props {
  points: ActiveProductsTrendPoint[];
  onDrillDown: (point: ActiveProductsTrendPoint) => void;
  onZoomChange: (payload: ZoomPayload) => void;
}

export function ActiveProductsTrendChart({ points, onDrillDown, onZoomChange }: Props) {
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
          `Active Products: ${row.activeProducts.toLocaleString("en-US")}`,
          `Prior Year Active: ${row.priorActiveProducts.toLocaleString("en-US")}`,
          `YoY: ${yoy}`,
          `Units Sold: ${row.unitsSold.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
          `Orders: ${row.orders.toLocaleString("en-US")}`,
          `Revenue: ${eur(row.revenue)}`,
        ].join("<br/>");
      },
    },
    legend: {
      data: ["Active Products", "Prior Year Active", "Units Sold"],
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
    yAxis: [
      {
        type: "value",
        name: "Active",
        axisLine: { show: false },
        splitLine: { lineStyle: { color: "rgba(255,255,255,0.05)" } },
        axisLabel: { color: DS.lo },
      },
      {
        type: "value",
        name: "Units",
        axisLine: { show: false },
        splitLine: { show: false },
        axisLabel: { color: DS.lo },
      },
    ],
    dataZoom: [
      { type: "inside", xAxisIndex: 0, start: 0, end: 100 },
      { type: "slider", xAxisIndex: 0, start: 0, end: 100, bottom: 24, height: 20 },
    ],
    series: [
      {
        name: "Active Products",
        type: "bar",
        barMaxWidth: 24,
        itemStyle: { color: "rgba(139,92,246,0.78)", borderRadius: [4, 4, 0, 0] },
        data: points.map((p) => p.activeProducts),
      },
      {
        name: "Prior Year Active",
        type: "line",
        smooth: true,
        symbolSize: 6,
        itemStyle: { color: DS.sky },
        lineStyle: { color: DS.sky, width: 2, type: "dashed" },
        data: points.map((p) => p.priorActiveProducts),
      },
      {
        name: "Units Sold",
        type: "line",
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 5,
        itemStyle: { color: DS.amber },
        lineStyle: { color: DS.amber, width: 2 },
        data: points.map((p) => p.unitsSold),
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
