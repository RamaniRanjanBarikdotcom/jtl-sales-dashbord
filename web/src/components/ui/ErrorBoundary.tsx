"use client";

import { Component, type ReactNode } from "react";
import { DS } from "@/lib/design-system";

interface Props {
    children: ReactNode;
    fallbackMessage?: string;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    justifyContent: "center", padding: "24px 16px", gap: 10,
                    background: "rgba(244,63,94,0.04)", borderRadius: 12,
                    border: `1px solid rgba(244,63,94,0.15)`, minHeight: 100,
                }}>
                    <span style={{ fontSize: 12, color: DS.rose, fontWeight: 600 }}>
                        {this.props.fallbackMessage || "Failed to load this section"}
                    </span>
                    <span style={{ fontSize: 10, color: DS.lo, fontFamily: DS.mono, maxWidth: 300, textAlign: "center" }}>
                        {this.state.error?.message}
                    </span>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        style={{
                            fontSize: 10, color: DS.mid, background: "rgba(255,255,255,0.04)",
                            border: `1px solid ${DS.border}`, borderRadius: 6,
                            padding: "4px 14px", cursor: "pointer",
                        }}
                    >
                        Retry
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
