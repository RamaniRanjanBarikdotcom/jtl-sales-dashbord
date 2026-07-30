"use client";

import { useEffect, useRef, useState } from "react";
import { DS } from "@/lib/design-system";
import { CopilotMessage } from "@/hooks/useCopilotChat";
import { COPILOT_QUICK_PROMPTS, COPILOT_SUGGESTIONS } from "@/lib/copilot-suggestions";

export function CopilotConversation({
    messages, busy, error, onAsk, compact = false, disabled = false,
}: {
    messages: CopilotMessage[];
    busy: boolean;
    error: string;
    onAsk: (question: string) => void;
    compact?: boolean;
    disabled?: boolean;
}) {
    const [question, setQuestion] = useState("");
    const [menuOpen, setMenuOpen] = useState(false);
    const scroller = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const node = scroller.current;
        if (!node) return;
        // Not every environment implements scrollTo; failing to autoscroll must
        // never take the conversation down with it.
        if (typeof node.scrollTo === "function") {
            node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
        } else {
            node.scrollTop = node.scrollHeight;
        }
    }, [messages.length, busy]);

    useEffect(() => {
        if (!menuOpen) return;
        const close = (event: MouseEvent) => {
            if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [menuOpen]);

    const send = (text: string) => {
        if (!text.trim() || busy || disabled) return;
        onAsk(text);
        setQuestion("");
        setMenuOpen(false);
    };

    const font = compact ? 12 : 14;
    const locked = busy || disabled;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minHeight: 0 }}>
            <div ref={scroller} style={{
                display: "flex", flexDirection: "column", gap: 10,
                flex: 1, minHeight: compact ? 220 : 380, overflowY: "auto", paddingRight: 4,
            }}>
                {messages.length === 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
                        <p style={{ color: DS.mid, fontSize: font, margin: 0 }}>
                            Ask about your sales — every answer is traced back to your synced data.
                        </p>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {COPILOT_QUICK_PROMPTS.map((prompt) => (
                                <button key={prompt.label} onClick={() => send(prompt.question)} disabled={locked} style={{
                                    background: `${DS.violet}18`, color: DS.hi, border: `1px solid ${DS.violet}44`,
                                    borderRadius: 999, padding: "6px 12px", fontSize: font - 2,
                                    cursor: locked ? "default" : "pointer", opacity: locked ? .5 : 1,
                                }}>{prompt.label}</button>
                            ))}
                        </div>
                    </div>
                )}
                {messages.map((message, index) => (
                    <div key={index} style={{
                        alignSelf: message.role === "user" ? "flex-end" : "flex-start",
                        maxWidth: "85%", padding: compact ? 9 : 12, borderRadius: 12,
                        color: DS.hi, fontSize: font, lineHeight: 1.5, whiteSpace: "pre-wrap",
                        background: message.role === "user" ? "rgba(56,189,248,.12)" : "rgba(139,92,246,.12)",
                        border: `1px solid ${message.role === "user" ? DS.sky : DS.violet}44`,
                    }}>
                        {message.content}
                        {!!message.citations?.length && (
                            <div style={{ color: DS.lo, fontSize: 9, marginTop: 8 }}>
                                Sourced from {message.citations.length} traced quer{message.citations.length === 1 ? "y" : "ies"} against your synced data.
                            </div>
                        )}
                    </div>
                ))}
                {busy && <p style={{ color: DS.mid, fontSize: font - 1 }}>Checking your data…</p>}
                {error && <p style={{ color: DS.rose, fontSize: font - 1 }}>{error}</p>}
            </div>

            <div style={{ display: "flex", gap: 6, alignItems: "center", position: "relative" }} ref={menuRef}>
                <button
                    onClick={() => setMenuOpen((open) => !open)}
                    aria-label="Suggested questions"
                    aria-expanded={menuOpen}
                    aria-haspopup="listbox"
                    disabled={disabled}
                    style={{
                        background: menuOpen ? `${DS.violet}28` : DS.panel, color: DS.hi,
                        border: `1px solid ${DS.border}`, borderRadius: 10,
                        padding: compact ? "9px 10px" : "12px 13px",
                        cursor: disabled ? "default" : "pointer", opacity: disabled ? .5 : 1,
                        fontSize: font, lineHeight: 1, flexShrink: 0,
                    }}
                >✦</button>

                {menuOpen && (
                    <div role="listbox" aria-label="Suggested questions" style={{
                        position: "absolute", bottom: "calc(100% + 8px)", left: 0, right: 0,
                        maxHeight: 300, overflowY: "auto", zIndex: 5,
                        background: DS.surface, border: `1px solid ${DS.violet}44`,
                        borderRadius: 12, padding: 8, boxShadow: "0 16px 40px rgba(0,0,0,.6)",
                    }}>
                        {COPILOT_SUGGESTIONS.map((group) => (
                            <div key={group.group} style={{ marginBottom: 6 }}>
                                <div style={{
                                    color: DS.lo, fontSize: 9, letterSpacing: 1, textTransform: "uppercase",
                                    padding: "6px 8px 4px",
                                }}>{group.group}</div>
                                {group.items.map((item) => (
                                    <button key={item.label} role="option" aria-selected={false}
                                        onClick={() => send(item.question)}
                                        style={{
                                            display: "block", width: "100%", textAlign: "left",
                                            background: "transparent", border: "none", color: DS.hi,
                                            padding: "7px 8px", borderRadius: 8, fontSize: font - 1,
                                            cursor: "pointer",
                                        }}
                                        onMouseEnter={(event) => { event.currentTarget.style.background = DS.panelHi; }}
                                        onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
                                    >{item.label}</button>
                                ))}
                            </div>
                        ))}
                    </div>
                )}

                <input
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") send(question); }}
                    placeholder={disabled ? "Copilot unavailable" : "Ask a sales question…"}
                    maxLength={2000}
                    aria-label="Ask a sales question"
                    disabled={disabled}
                    style={{
                        flex: 1, background: "#090d18", border: `1px solid ${DS.border}`,
                        borderRadius: 10, padding: compact ? 9 : 12, color: DS.hi,
                        fontSize: font, minWidth: 0, opacity: disabled ? .5 : 1,
                    }}
                />
                <button onClick={() => send(question)} disabled={locked} style={{
                    background: locked ? DS.panel : `${DS.violet}22`, color: locked ? DS.lo : DS.hi,
                    border: `1px solid ${DS.violet}55`, borderRadius: 10,
                    padding: compact ? "9px 14px" : "12px 18px", cursor: locked ? "default" : "pointer",
                    fontSize: font, flexShrink: 0,
                }}>
                    {busy ? "…" : "Ask"}
                </button>
            </div>
        </div>
    );
}
