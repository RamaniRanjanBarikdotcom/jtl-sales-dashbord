"use client";

import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import type { CustomersTrendPoint } from "@/hooks/useCustomersTrend";

interface Props {
  rows: CustomersTrendPoint[];
  granularity: "year" | "month" | "day";
}

function toCsv(rows: CustomersTrendPoint[]): string {
  const header = [
    "Period",
    "Period Start",
    "Period End",
    "Customers",
    "Prior Year Customers",
    "Change Percent",
    "Orders",
    "Revenue",
    "Average Order Value",
    "Average Revenue Per Customer",
  ];
  const lines = rows.map((row) => [
    row.label,
    row.periodStart,
    row.periodEnd,
    String(row.customers),
    String(row.priorCustomers),
    row.changePercent == null ? "" : row.changePercent.toFixed(2),
    String(row.orders),
    row.revenue.toFixed(2),
    row.averageOrderValue.toFixed(2),
    row.averageRevenuePerCustomer.toFixed(2),
  ]);
  return [header, ...lines]
    .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function exportCsv(rows: CustomersTrendPoint[], granularity: string) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `customers-trend-${granularity}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function CustomersDetailsTable({ rows, granularity }: Props) {
  return (
    <div style={{ border: `1px solid ${DS.border}`, borderRadius: 12, background: "rgba(255,255,255,0.015)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: `1px solid ${DS.border}` }}>
        <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600 }}>Customers Details</div>
        <button
          onClick={() => exportCsv(rows, granularity)}
          style={{ fontSize: 11, color: DS.violet, border: "1px solid rgba(139,92,246,0.25)", background: "rgba(139,92,246,0.08)", borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}
        >
          Export CSV
        </button>
      </div>

      <div style={{ maxHeight: 240, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Period", "Customers", "Prior", "YoY", "Orders", "Revenue", "AOV", "Rev/Customer"].map((h) => (
                <th key={h} style={{ textAlign: "left", fontSize: 10, color: DS.lo, letterSpacing: "0.06em", textTransform: "uppercase", padding: "8px 12px", borderBottom: `1px solid ${DS.border}`, position: "sticky", top: 0, background: "#091327" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.periodStart}-${row.periodEnd}`}>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.hi }}>{row.label}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.violet, fontFamily: DS.mono }}>{row.customers.toLocaleString("en-US")}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.sky, fontFamily: DS.mono }}>{row.priorCustomers.toLocaleString("en-US")}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: row.changePercent == null ? DS.lo : row.changePercent >= 0 ? DS.emerald : DS.rose }}>
                  {row.changePercent == null ? "-" : `${row.changePercent >= 0 ? "+" : ""}${row.changePercent.toFixed(2)}%`}
                </td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.amber, fontFamily: DS.mono }}>{row.orders.toLocaleString("en-US")}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.sky, fontFamily: DS.mono }}>{eur(row.revenue)}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.emerald, fontFamily: DS.mono }}>{eur(row.averageOrderValue)}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.hi, fontFamily: DS.mono }}>{eur(row.averageRevenuePerCustomer)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
