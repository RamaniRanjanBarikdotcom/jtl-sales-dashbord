"use client";

import { useEffect } from "react";
import { DS } from "@/lib/design-system";

interface Props {
    open: boolean;
    title: string;
    subtitle?: string;
    onClose: () => void;
    children: React.ReactNode;
}

export function DetailPanel({ open, title, subtitle, onClose, children }: Props) {
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [onClose]);

    return (
        <>
            {/* Backdrop */}
            <div
                onClick={onClose}
                style={{
                    position: "fixed", inset: 0, zIndex: 40,
                    background: "rgba(0,0,0,0.55)",
                    opacity: open ? 1 : 0,
                    pointerEvents: open ? "auto" : "none",
                    transition: "opacity 0.25s",
                    backdropFilter: "blur(3px)",
                }}
            />

            {/* Slide-in panel */}
            <div style={{
                position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 50,
                width: 500, maxWidth: "92vw",
                background: DS.surface,
                borderLeft: `1px solid ${DS.borderHi}`,
                transform: open ? "translateX(0)" : "translateX(100%)",
                transition: "transform 0.3s cubic-bezier(0.4,0,0.2,1)",
                display: "flex", flexDirection: "column",
                overflowY: "auto",
                boxShadow: "-24px 0 60px rgba(0,0,0,0.5)",
            }}>
                {/* Header */}
                <div style={{
                    padding: "18px 24px 14px",
                    borderBottom: `1px solid ${DS.border}`,
                    display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                    position: "sticky", top: 0,
                    background: DS.surface, zIndex: 1,
                }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: 15, color: DS.hi, fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</h2>
                        {subtitle && (
                            <p style={{ margin: "3px 0 0", fontSize: 11, color: DS.lo }}>{subtitle}</p>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: "rgba(255,255,255,0.05)",
                            border: `1px solid ${DS.border}`,
                            borderRadius: 8, padding: "5px 10px",
                            color: DS.mid, cursor: "pointer",
                            fontSize: 14, lineHeight: 1,
                            transition: "background 0.15s",
                        }}
                    >✕</button>
                </div>

                {/* Body */}
                <div style={{ padding: "20px 24px", flex: 1 }}>
                    {children}
                </div>
            </div>
        </>
    );
}

/* ── Reusable child primitives ─────────────────────────────────────────── */

export function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
    return (
        <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "9px 0", borderBottom: `1px solid ${DS.border}`,
        }}>
            <span style={{ fontSize: 11, color: DS.lo }}>{label}</span>
            <span style={{ fontSize: 13, color: color || DS.hi, fontFamily: DS.mono, fontWeight: 600 }}>{value}</span>
        </div>
    );
}

export function SectionLabel({ text }: { text: string }) {
    return (
        <p style={{
            margin: "18px 0 8px", fontSize: 9, color: DS.lo,
            letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 500,
        }}>{text}</p>
    );
}

export function Badge({ text, color }: { text: string; color: string }) {
    return (
        <span style={{
            display: "inline-block",
            fontSize: 10, padding: "3px 9px", borderRadius: 20, fontWeight: 600,
            background: `${color}20`, color,
        }}>{text}</span>
    );
}

export function MiniBar({ value, max, color, label }: { value: number; max: number; color: string; label?: string }) {
    const pct = Math.min(100, Math.max(0, (value / max) * 100));
    return (
        <div>
            {label && <div style={{ fontSize: 9, color: DS.lo, marginBottom: 4 }}>{label}</div>}
            <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)" }}>
                <div style={{ height: "100%", width: `${pct}%`, borderRadius: 3, background: color, transition: "width 0.4s" }} />
            </div>
        </div>
    );
}
