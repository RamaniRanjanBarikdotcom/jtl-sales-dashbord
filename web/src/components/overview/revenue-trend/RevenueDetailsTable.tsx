"use client";

import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import type { RevenueTrendPoint } from "@/hooks/useRevenueTrend";

interface Props {
  rows: RevenueTrendPoint[];
  granularity: "year" | "month" | "day";
}

function toCsv(rows: RevenueTrendPoint[]): string {
  const header = [
    "Period",
    "Period Start",
    "Period End",
    "Revenue",
    "Prior Year Revenue",
    "Change Percent",
    "Orders",
    "Customers",
    "Average Order Value",
  ];
  const lines = rows.map((row) => [
    row.label,
    row.periodStart,
    row.periodEnd,
    row.revenue.toFixed(2),
    row.priorRevenue.toFixed(2),
    row.changePercent == null ? "" : row.changePercent.toFixed(2),
    String(row.orders),
    String(row.customers),
    row.averageOrderValue.toFixed(2),
  ]);
  return [header, ...lines]
    .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function exportCsv(rows: RevenueTrendPoint[], granularity: string) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `revenue-trend-${granularity}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function RevenueDetailsTable({ rows, granularity }: Props) {
  return (
    <div
      style={{
        border: `1px solid ${DS.border}`,
        borderRadius: 12,
        background: "rgba(255,255,255,0.015)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          borderBottom: `1px solid ${DS.border}`,
        }}
      >
        <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600 }}>Revenue Details</div>
        <button
          onClick={() => exportCsv(rows, granularity)}
          style={{
            fontSize: 11,
            color: DS.sky,
            border: `1px solid rgba(56,189,248,0.25)`,
            background: "rgba(56,189,248,0.08)",
            borderRadius: 8,
            padding: "5px 10px",
            cursor: "pointer",
          }}
        >
          Export CSV
        </button>
      </div>

      <div style={{ maxHeight: 240, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Period", "Revenue", "Prior Year", "Change", "Orders", "Customers", "AOV"].map((h) => (
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
            {rows.map((row) => (
              <tr key={`${row.periodStart}-${row.periodEnd}`}>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.hi }}>{row.label}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.sky, fontFamily: DS.mono }}>{eur(row.revenue)}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.violet, fontFamily: DS.mono }}>{eur(row.priorRevenue)}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: row.changePercent == null ? DS.lo : row.changePercent >= 0 ? DS.emerald : DS.rose }}>
                  {row.changePercent == null ? "-" : `${row.changePercent >= 0 ? "+" : ""}${row.changePercent.toFixed(2)}%`}
                </td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.hi, fontFamily: DS.mono }}>{row.orders.toLocaleString("en-US")}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.hi, fontFamily: DS.mono }}>{row.customers.toLocaleString("en-US")}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.emerald, fontFamily: DS.mono }}>{eur(row.averageOrderValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
