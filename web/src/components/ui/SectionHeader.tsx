import { ReactNode } from "react";
import { DS } from "@/lib/design-system";

export function SectionHeader({ title, sub, right }: { title: string, sub?: string, right?: ReactNode }) {
    return (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
                <h3 style={{ fontFamily: DS.display, fontWeight: 400, fontSize: 15, color: DS.hi, margin: 0 }}>{title}</h3>
                {sub && <p style={{ fontSize: 10, color: DS.lo, margin: "2px 0 0", letterSpacing: "0.06em", textTransform: "uppercase" }}>{sub}</p>}
            </div>
            {right}
        </div>
    );
}
