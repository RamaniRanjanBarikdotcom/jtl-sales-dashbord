import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";

export const ChartTip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
        <div style={{
            background: "rgba(4,6,15,0.97)", border: `1px solid ${DS.borderHi}`,
            borderRadius: 10, padding: "10px 14px", backdropFilter: "blur(20px)", minWidth: 140
        }}>
            <p style={{ color: DS.mid, fontSize: 10, marginBottom: 6, letterSpacing: "0.07em", textTransform: "uppercase" }}>{label}</p>
            {payload.map((p: any, i: number) => (
                <div key={i} style={{
                    display: "flex", justifyContent: "space-between",
                    gap: 14, fontSize: 12, margin: "3px 0"
                }}>
                    <span style={{ color: p.color || DS.sky }}>{p.name}</span>
                    <strong style={{ color: DS.hi }}>{
                        typeof p.value === "number" && p.value > 999 ? eur(p.value) : p.value
                    }</strong>
                </div>
            ))}
        </div>
    );
};
