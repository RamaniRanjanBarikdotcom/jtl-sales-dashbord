"use client";

import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import type { RevenueTrendSummary } from "@/hooks/useRevenueTrend";

interface Props {
  summary: RevenueTrendSummary;
}

function pill(label: string, value: string, color: string) {
  return (
    <div
      style={{
        border: `1px solid ${DS.border}`,
        background: "rgba(255,255,255,0.02)",
        borderRadius: 12,
        padding: "10px 12px",
      }}
    >
      <div style={{ fontSize: 10, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 18, color, fontWeight: 700, fontFamily: DS.mono, marginTop: 4 }}>{value}</div>
    </div>
  );
}

export function RevenueSummaryCards({ summary }: Props) {
  const yoy = summary.changePercent == null ? "-" : `${summary.changePercent >= 0 ? "+" : ""}${summary.changePercent.toFixed(2)}%`;
  return (
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
      {pill("Revenue", eur(summary.revenue), DS.sky)}
      {pill("Prior Year", eur(summary.priorRevenue), DS.violet)}
      {pill("YoY", yoy, summary.changePercent == null ? DS.lo : summary.changePercent >= 0 ? DS.emerald : DS.rose)}
      {pill("Orders", summary.orders.toLocaleString("en-US"), DS.amber)}
      {pill("Customers", summary.customers.toLocaleString("en-US"), DS.emerald)}
      {pill("AOV", eur(summary.averageOrderValue), DS.sky)}
    </div>
  );
}
