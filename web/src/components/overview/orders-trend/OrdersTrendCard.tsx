"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/Card";
import { SectionHeader as SH } from "@/components/ui/SectionHeader";
import { ChartTip } from "@/components/charts/recharts/ChartTip";
import { DS } from "@/lib/design-system";

interface PreviewPoint {
  month: string;
  revenue: number;
  target: number;
  orders: number;
}

interface Props {
  data: PreviewPoint[];
  loading: boolean;
  onExpand: () => void;
}

export function OrdersTrendCard({ data, loading, onExpand }: Props) {
  return (
    <Card accent={DS.violet}>
      <SH
        title="Global Orders Trend"
        sub="12M preview · click to open full drill-down"
        right={
          <button
            onClick={onExpand}
            style={{
              fontSize: 10,
              color: DS.violet,
              background: "rgba(139,92,246,0.08)",
              border: "1px solid rgba(139,92,246,0.2)",
              borderRadius: 6,
              padding: "4px 10px",
              cursor: "pointer",
            }}
          >
            Expand
          </button>
        }
      />

      <div onClick={onExpand} style={{ cursor: "pointer" }}>
        {loading ? (
          <div style={{ height: 220, borderRadius: 8, background: "rgba(255,255,255,0.05)" }} />
        ) : data.length === 0 ? (
          <div
            style={{
              height: 220,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: DS.lo,
              fontSize: 12,
            }}
          >
            No orders data yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="ordersTrendPreview" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={DS.violet} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={DS.violet} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: DS.lo, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: DS.lo, fontSize: 10 }} axisLine={false} tickLine={false} width={42} />
              <Tooltip content={<ChartTip />} />
              <Area type="monotone" dataKey="orders" name="Orders" stroke={DS.violet} strokeWidth={2.5} fill="url(#ordersTrendPreview)" dot={false} />
              <Line type="monotone" dataKey="target" name="Target" stroke={DS.sky} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

