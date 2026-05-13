"use client";

import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import type { ActiveProductsTrendSummary } from "@/hooks/useActiveProductsTrend";

interface Props {
  summary: ActiveProductsTrendSummary;
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

export function ActiveProductsSummaryCards({ summary }: Props) {
  const yoy = summary.changePercent == null ? "-" : `${summary.changePercent >= 0 ? "+" : ""}${summary.changePercent.toFixed(2)}%`;
  return (
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
      {pill("Active Products", summary.activeProducts.toLocaleString("en-US"), DS.violet)}
      {pill("Prior Year", summary.priorActiveProducts.toLocaleString("en-US"), DS.sky)}
      {pill("YoY", yoy, summary.changePercent == null ? DS.lo : summary.changePercent >= 0 ? DS.emerald : DS.rose)}
      {pill("Units Sold", summary.unitsSold.toLocaleString("en-US", { maximumFractionDigits: 2 }), DS.amber)}
      {pill("Orders", summary.orders.toLocaleString("en-US"), DS.emerald)}
      {pill("Revenue", eur(summary.revenue), DS.sky)}
    </div>
  );
}
