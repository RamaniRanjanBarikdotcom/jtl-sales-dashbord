import { DS } from "@/lib/design-system";

export function Pill({ v, size = 10 }: { v: number | string, size?: number }) {
    const numV = typeof v === 'string' ? parseFloat(v) : v;
    const flat = numV === 0;
    const up   = numV > 0;
    return (
        <span style={{
            fontSize: size, fontWeight: 700, padding: "2px 7px", borderRadius: 20, display: "inline-flex",
            alignItems: "center", gap: 3,
            background: flat ? "rgba(255,255,255,0.06)" : up ? "rgba(16,185,129,0.1)" : "rgba(244,63,94,0.1)",
            color:      flat ? DS.mid               : up ? DS.emerald            : DS.rose,
        }}>
            {flat ? "—" : up ? "▲" : "▼"}
            {flat ? "0%" : `${Math.abs(numV)}%`}
        </span>
    );
}
