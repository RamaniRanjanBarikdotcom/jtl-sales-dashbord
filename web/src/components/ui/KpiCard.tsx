"use client";

import { ResponsiveContainer, AreaChart, Area } from "recharts";
import { Card } from "./Card";
import { Pill } from "./Pill";
import { DS } from "@/lib/design-system";
import { DAILY } from "@/lib/mock-data";

export function Spark({ data, k, c }: { data: any[], k: string, c: string }) {
    return (
        <ResponsiveContainer width="100%" height={36}>
            <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <defs>
                    <linearGradient id={`spk${c.replace(/[^a-z0-9]/gi, "")}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={c} stopOpacity={0.4} />
                        <stop offset="100%" stopColor={c} stopOpacity={0} />
                    </linearGradient>
                </defs>
                <Area type="monotone" dataKey={k} stroke={c} strokeWidth={1.5}
                    fill={`url(#spk${c.replace(/[^a-z0-9]/gi, "")})`} dot={false} />
            </AreaChart>
        </ResponsiveContainer>
    );
}

export function KpiCard({ label, value, delta, note, c, icon, data, k, masked, onClick }: {
    label: string, value: string | number, delta: number, note: string, c: string, icon: string, data?: any[], k?: string, masked?: boolean, onClick?: () => void
}) {
    if (masked) {
        return (
            <Card accent={c} style={{ padding: "18px 20px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: DS.mid, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500 }}>{label}</span>
                    <span style={{ fontSize: 18 }}>{icon}</span>
                </div>
                <div style={{ fontFamily: DS.display, fontSize: 28, color: DS.lo, marginBottom: 6, letterSpacing: 2 }}>• • • •</div>
                <span style={{ fontSize: 9, color: DS.amber, background: "rgba(251,191,36,0.1)", padding: "2px 8px", borderRadius: 20 }}>🔒 Restricted</span>
            </Card>
        );
    }

    return (
        <Card accent={c} style={{ padding: "18px 20px 14px", cursor: onClick ? "pointer" : undefined, transition: "transform 0.15s, box-shadow 0.15s" }}
            onClick={onClick}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: DS.mid, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 500, lineHeight: 1.4 }}>{label}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {onClick && <span style={{ fontSize: 9, color: c, background: `${c}18`, border: `1px solid ${c}40`, borderRadius: 20, padding: "2px 7px", letterSpacing: "0.06em" }}>Details ↗</span>}
                    <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
                </div>
            </div>
            <div style={{ fontFamily: DS.display, fontSize: 28, color: DS.hi, letterSpacing: "-0.01em", marginBottom: 6 }}>
                {value}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Pill v={delta} />
                <span style={{ fontSize: 10, color: DS.lo }}>{note}</span>
            </div>
            <Spark data={data || DAILY} k={k || "rev"} c={c} />
        </Card>
    );
}
