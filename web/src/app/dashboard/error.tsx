"use client";

import { DS } from "@/lib/design-system";

export default function DashboardError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <div style={{
            display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", minHeight: "60vh", gap: 20, padding: 40,
        }}>
            <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: "rgba(244,63,94,0.1)", border: `2px solid rgba(244,63,94,0.3)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 24,
            }}>
                !
            </div>
            <h2 style={{
                fontSize: 18, fontWeight: 700, color: DS.hi,
                fontFamily: DS.body, margin: 0,
            }}>
                Something went wrong
            </h2>
            <p style={{
                fontSize: 13, color: DS.mid, textAlign: "center",
                maxWidth: 420, lineHeight: 1.6, margin: 0,
            }}>
                {error.message || "An unexpected error occurred while loading this page."}
            </p>
            {error.digest && (
                <code style={{
                    fontSize: 10, color: DS.lo, fontFamily: DS.mono,
                    background: "rgba(255,255,255,0.03)", padding: "4px 10px",
                    borderRadius: 6, border: `1px solid ${DS.border}`,
                }}>
                    Error ID: {error.digest}
                </code>
            )}
            <button
                onClick={reset}
                style={{
                    fontSize: 13, fontWeight: 600, color: DS.hi,
                    background: `${DS.sky}22`, border: `1px solid ${DS.sky}44`,
                    borderRadius: 10, padding: "10px 28px", cursor: "pointer",
                    fontFamily: DS.body, transition: "all 0.2s",
                }}
            >
                Try again
            </button>
        </div>
    );
}
