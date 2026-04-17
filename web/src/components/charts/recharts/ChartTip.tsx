import { DS } from "@/lib/design-system";
import { eur } from "@/lib/utils";
import type { TooltipContentProps } from "recharts";

type ChartTipProps = Partial<TooltipContentProps<number, string>>;

export const ChartTip = ({ active, payload, label }: ChartTipProps) => {
    if (!active || !Array.isArray(payload) || payload.length === 0) return null;

    const validPoints = payload.filter((p) => p && p.value != null);
    if (validPoints.length === 0) return null;

    return (
        <div style={{
            background: "rgba(4,6,15,0.97)", border: `1px solid ${DS.borderHi}`,
            borderRadius: 10,
            padding: "10px 12px",
            backdropFilter: "blur(20px)",
            minWidth: 140,
            maxWidth: "min(300px, calc(100vw - 24px))",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
        }}>
            <p style={{ color: DS.mid, fontSize: 10, marginBottom: 6, letterSpacing: "0.07em", textTransform: "uppercase" }}>{String(label ?? "")}</p>
            {validPoints.map((p, i: number) => (
                <div key={i} style={{
                    display: "flex", justifyContent: "space-between",
                    gap: 14, fontSize: 12, margin: "3px 0"
                }}>
                    <span style={{ color: p.color || DS.sky }}>{String(p.name ?? "Value")}</span>
                    <strong style={{ color: DS.hi }}>{
                        typeof p.value === "number" && p.value > 999 ? eur(p.value) : String(p.value)
                    }</strong>
                </div>
            ))}
        </div>
    );
};
