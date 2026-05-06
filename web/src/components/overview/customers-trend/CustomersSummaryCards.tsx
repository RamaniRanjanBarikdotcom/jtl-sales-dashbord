"use client";

import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import type { CustomersTrendSummary } from "@/hooks/useCustomersTrend";

interface Props {
  summary: CustomersTrendSummary;
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

export function CustomersSummaryCards({ summary }: Props) {
  const yoy = summary.changePercent == null ? "-" : `${summary.changePercent >= 0 ? "+" : ""}${summary.changePercent.toFixed(2)}%`;
  return (
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
      {pill("Customers", summary.customers.toLocaleString("en-US"), DS.violet)}
      {pill("Prior Year", summary.priorCustomers.toLocaleString("en-US"), DS.sky)}
      {pill("YoY", yoy, summary.changePercent == null ? DS.lo : summary.changePercent >= 0 ? DS.emerald : DS.rose)}
      {pill("Orders", summary.orders.toLocaleString("en-US"), DS.amber)}
      {pill("Revenue", eur(summary.revenue), DS.sky)}
      {pill("Avg/Customer", eur(summary.averageRevenuePerCustomer), DS.emerald)}
    </div>
  );
}
