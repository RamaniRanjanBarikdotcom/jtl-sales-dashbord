import { DS } from "@/lib/design-system";

export function Pill({ v, size = 10 }: { v: number | string, size?: number }) {
    const numV = typeof v === 'string' ? parseFloat(v) : v;
    const up = numV >= 0;
    return (
        <span style={{
            fontSize: size, fontWeight: 700, padding: "2px 7px", borderRadius: 20, display: "inline-flex",
            alignItems: "center", gap: 3,
            background: up ? "rgba(16,185,129,0.1)" : "rgba(244,63,94,0.1)",
            color: up ? DS.emerald : DS.rose,
        }}>{up ? "▲" : "▼"}{Math.abs(numV)}%</span>
    );
}
