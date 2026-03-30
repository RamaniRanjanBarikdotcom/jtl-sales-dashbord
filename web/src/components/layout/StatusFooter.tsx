import { DS } from "@/lib/design-system";
import { totalRev, totalOrd, avgOV } from "@/lib/mock-data";
import { eur } from "@/lib/utils";

export function StatusFooter() {
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
                <span>Revenue: <strong style={{ color: DS.sky }}>{eur(totalRev)}</strong></span>
                <span>Orders: <strong style={{ color: DS.violet }}>{totalOrd.toLocaleString()}</strong></span>
                <span>AOV: <strong style={{ color: DS.emerald }}>{eur(avgOV)}</strong></span>
            </div>
        </footer>
    );
}
