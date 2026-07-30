"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { DS } from "@/lib/design-system";
import { useStore } from "@/lib/store";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { useCopilotChat } from "@/hooks/useCopilotChat";
import { CopilotConversation } from "./CopilotConversation";

export function CopilotWidget() {
    const [open, setOpen] = useState(false);
    const pathname = usePathname();
    const can = useStore((state) => state.can);
    const { data: flags } = useFeatureFlags();
    const { messages, busy, error, ask, reset } = useCopilotChat();

    useEffect(() => {
        if (!open) return;
        const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
        window.addEventListener("keydown", close);
        return () => window.removeEventListener("keydown", close);
    }, [open]);

    // No launcher while the backend feature is off — it would only ever open
    // onto an error. The full page is already the Copilot, so a floating copy
    // of it there would be noise.
    const available = !!flags?.AI_ANALYTICS_ENABLED && !!flags?.AI_ANALYTICS_SALES_ENABLED;
    if (!available || !can("copilot") || pathname?.startsWith("/dashboard/copilot")) return null;

    return (
        <>
            {open && (
                <div role="dialog" aria-label="Analytics Copilot" style={{
                    position: "fixed", right: 24, bottom: 88, zIndex: 60,
                    width: "min(400px, calc(100vw - 48px))", height: "min(580px, calc(100vh - 150px))",
                    display: "flex", flexDirection: "column",
                    background: DS.surface, border: `1px solid ${DS.violet}44`, borderRadius: 18,
                    boxShadow: "0 24px 70px rgba(0,0,0,.6)", overflow: "hidden",
                }}>
                    <div style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "13px 14px", borderBottom: `1px solid ${DS.border}`,
                        background: `linear-gradient(120deg, ${DS.violet}1f, ${DS.sky}14)`,
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                            <span aria-hidden style={{
                                width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                                background: `linear-gradient(140deg, ${DS.violet}, ${DS.sky})`,
                                display: "grid", placeItems: "center", color: "#fff", fontSize: 13,
                            }}>✦</span>
                            <div style={{ minWidth: 0 }}>
                                <div style={{ color: DS.hi, fontFamily: DS.display, fontSize: 14 }}>Analytics Copilot</div>
                                <div style={{ color: DS.lo, fontSize: 9 }}>Answers traced to your synced data</div>
                            </div>
                        </div>
                        <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                            {messages.length > 0 && (
                                <button onClick={reset} aria-label="Start a new conversation" title="New conversation" style={{
                                    background: "transparent", border: "none", color: DS.mid,
                                    fontSize: 14, cursor: "pointer", padding: "4px 6px",
                                }}>⟲</button>
                            )}
                            <button onClick={() => setOpen(false)} aria-label="Close Copilot" style={{
                                background: "transparent", border: "none", color: DS.mid,
                                fontSize: 20, cursor: "pointer", lineHeight: 1, padding: "2px 6px",
                            }}>×</button>
                        </div>
                    </div>

                    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: 12 }}>
                        <CopilotConversation messages={messages} busy={busy} error={error} onAsk={ask} compact />
                    </div>
                </div>
            )}

            <button
                onClick={() => setOpen((value) => !value)}
                aria-label={open ? "Close Analytics Copilot" : "Open Analytics Copilot"}
                aria-expanded={open}
                style={{
                    position: "fixed", right: 24, bottom: 24, zIndex: 60,
                    display: "flex", alignItems: "center", gap: 9,
                    padding: "12px 20px", borderRadius: 999, cursor: "pointer",
                    background: DS.bg, color: DS.hi, fontSize: 14, fontFamily: DS.body,
                    border: "1px solid transparent",
                    backgroundImage: `linear-gradient(${DS.bg}, ${DS.bg}), linear-gradient(100deg, ${DS.violet}, ${DS.sky})`,
                    backgroundOrigin: "border-box",
                    backgroundClip: "padding-box, border-box",
                    boxShadow: "0 10px 34px rgba(0,0,0,.5)",
                }}
            >
                <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>{open ? "×" : "✦"}</span>
                <span>Ask AI</span>
            </button>
        </>
    );
}
