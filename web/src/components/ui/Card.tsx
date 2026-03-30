import { ReactNode } from "react";
import { DS } from "@/lib/design-system";

export function Card({ children, accent, style = {}, onClick }: { children: ReactNode, accent?: string, style?: any, onClick?: () => void }) {
    return (
        <div onClick={onClick} style={{
            background: 'rgba(255,255,255,0.032)',
            border: `1px solid ${DS.border}`,
            borderRadius: 16, padding: "22px 24px",
            position: "relative", overflow: "hidden", ...style
        }}>
            {accent && <div style={{
                position: "absolute", top: 0, left: "15%", right: "15%",
                height: 1, background: `radial-gradient(ellipse at 50%, ${accent}88, transparent 80%)`
            }} />}
            {children}
        </div>
    );
}
