import { clamp } from "@/lib/utils";

export function BarFill({ v, max = 100, c = "#38bdf8", h = 3 }: { v: number, max?: number, c?: string, h?: number }) {
    return (
        <div style={{ height: h, borderRadius: h, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
            <div style={{
                width: `${clamp(v / max * 100, 0, 100)}%`, height: "100%", borderRadius: h,
                background: `linear-gradient(90deg, ${c}99, ${c})`, transition: "width 0.9s ease"
            }} />
        </div>
    );
}
