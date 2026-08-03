"use client";

import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import type { ActiveProductsTrendPoint } from "@/hooks/useActiveProductsTrend";
import { downloadClientCsv } from "@/lib/csv";
import { useStore , sessionHasPermission} from "@/lib/store";

interface Props {
  rows: ActiveProductsTrendPoint[];
  granularity: "year" | "month" | "day";
}

const CSV_HEADERS = [
    "Period",
    "Period Start",
    "Period End",
    "Active Products",
    "Prior Year Active Products",
    "Change Percent",
    "Units Sold",
    "Orders",
    "Revenue",
    "Average Revenue Per Active Product",
];

function exportCsv(rows: ActiveProductsTrendPoint[], granularity: string) {
  downloadClientCsv(`active-products-trend-${granularity}.csv`, CSV_HEADERS, rows.map((row) => [
    row.label,
    row.periodStart,
    row.periodEnd,
    String(row.activeProducts),
    String(row.priorActiveProducts),
    row.changePercent == null ? "" : row.changePercent.toFixed(2),
    row.unitsSold.toFixed(2),
    String(row.orders),
    row.revenue.toFixed(2),
    row.averageRevenuePerActiveProduct.toFixed(2),
  ]), { module: "overview_active_products_trend", granularity, complete: true });
}

export function ActiveProductsDetailsTable({ rows, granularity }: Props) {
  const session = useStore((state) => state.session);
  const canExport = sessionHasPermission(session, "products.export");
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
        <div style={{ fontSize: 12, color: DS.hi, fontWeight: 600 }}>Active Products Details</div>
        {canExport && <button
          onClick={() => exportCsv(rows, granularity)}
          style={{
            fontSize: 11,
            color: DS.violet,
            border: `1px solid rgba(139,92,246,0.25)`,
            background: "rgba(139,92,246,0.08)",
            borderRadius: 8,
            padding: "5px 10px",
            cursor: "pointer",
          }}
        >
          Export CSV
        </button>}
      </div>

      <div style={{ maxHeight: 240, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Period", "Active", "Prior", "YoY", "Units", "Orders", "Revenue", "Avg/Active"].map((h) => (
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
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.violet, fontFamily: DS.mono }}>{row.activeProducts.toLocaleString("en-US")}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.sky, fontFamily: DS.mono }}>{row.priorActiveProducts.toLocaleString("en-US")}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: row.changePercent == null ? DS.lo : row.changePercent >= 0 ? DS.emerald : DS.rose }}>
                  {row.changePercent == null ? "-" : `${row.changePercent >= 0 ? "+" : ""}${row.changePercent.toFixed(2)}%`}
                </td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.amber, fontFamily: DS.mono }}>{row.unitsSold.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.emerald, fontFamily: DS.mono }}>{row.orders.toLocaleString("en-US")}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.sky, fontFamily: DS.mono }}>{eur(row.revenue)}</td>
                <td style={{ padding: "8px 12px", fontSize: 12, color: DS.hi, fontFamily: DS.mono }}>{eur(row.averageRevenuePerActiveProduct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
