"use client";

import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import { useOverviewKpis } from "@/hooks/useOverviewData";

export function StatusFooter() {
    const { data } = useOverviewKpis();
    const revenue = data?.totalRevenue ?? 0;
    const orders  = data?.totalOrders  ?? 0;
    const aov     = orders > 0 ? revenue / orders : 0;

    return (
        <footer style={{
            height: 30, display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "0 24px",
            background: "rgba(7,10,24,0.96)",
            borderTop: `1px solid ${DS.border}`, flexShrink: 0,
        }}>
            <span style={{ fontSize: 9, color: DS.lo, fontFamily: DS.mono }}>
                📡 JTL-Wawi (MS SQL) → Sync Engine → PostgreSQL → REST API → Dashboard
            </span>
            <div style={{ display: "flex", gap: 18, fontSize: 9, color: DS.lo, fontFamily: DS.mono }}>
                <span>Revenue: <strong style={{ color: DS.sky }}>{eur(revenue)}</strong></span>
                <span>Orders: <strong style={{ color: DS.violet }}>{orders.toLocaleString()}</strong></span>
                <span>AOV: <strong style={{ color: DS.emerald }}>{eur(Math.round(aov * 100) / 100)}</strong></span>
            </div>
        </footer>
    );
}
