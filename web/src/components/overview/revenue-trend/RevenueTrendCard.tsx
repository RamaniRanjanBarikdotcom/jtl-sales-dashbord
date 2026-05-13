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
  target: number | null;
  orders: number;
}

interface Props {
  data: PreviewPoint[];
  loading: boolean;
  onExpand: () => void;
}

export function RevenueTrendCard({ data, loading, onExpand }: Props) {
  return (
    <div onClick={onExpand} style={{ cursor: "pointer" }}>
    <Card accent={DS.sky}>
      <SH
        title="Global Revenue Trend"
        sub="12M preview · revenue vs prior year · click to open full drill-down"
        right={
          <button
            onClick={(event) => {
              event.stopPropagation();
              onExpand();
            }}
            style={{
              fontSize: 10,
              color: DS.sky,
              background: "rgba(56,189,248,0.08)",
              border: "1px solid rgba(56,189,248,0.2)",
              borderRadius: 6,
              padding: "4px 10px",
              cursor: "pointer",
            }}
          >
            Expand
          </button>
        }
      />

      <div>
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
            No revenue data yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="revTrendPreview" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={DS.sky} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={DS.sky} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: DS.lo, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={(v) => `€${(v / 1000).toFixed(0)}K`}
                tick={{ fill: DS.lo, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={42}
              />
              <Tooltip content={<ChartTip />} />
              <Area type="monotone" dataKey="revenue" name="Revenue" stroke={DS.sky} strokeWidth={2.5} fill="url(#revTrendPreview)" dot={false} />
              <Line type="monotone" dataKey="target" name="Prior Year" stroke={DS.violet} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
    </div>
  );
}
