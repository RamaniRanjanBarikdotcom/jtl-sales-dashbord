"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { StatusFooter } from "@/components/layout/StatusFooter";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { CopilotWidget } from "@/components/copilot/CopilotWidget";
import { ExportStatusToast } from "@/components/analytics/ExportStatusToast";
import { usePathname } from "next/navigation";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const [collapsed, setCollapsed] = useState(false);
    const [mounted, setMounted] = useState(false);
    const pathname = usePathname();

    useEffect(() => setMounted(true), []);

    // Prevent SSR hydration mismatch: the dashboard is fully client-side
    // (behind auth), so render a minimal shell on server, full layout on client.
    if (!mounted) {
        return <div style={{ minHeight: "100vh", background: "var(--ds-bg)" }} />;
    }

    return (
        <div style={{ display: "flex", minHeight: "100vh", background: "var(--ds-bg)" }}>
            <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />

            <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                <Topbar />

                <main className="tab-in" key={pathname} style={{
                    flex: 1, padding: "20px 24px 40px", overflowY: "auto",
                }}>
                    <ErrorBoundary fallbackMessage="Something failed while rendering this dashboard page.">
                        {children}
                    </ErrorBoundary>
                </main>

                <StatusFooter />
            </div>

            {/* Fixed and isolated: a Copilot crash must never disturb the dashboard. */}
            <div style={{ position: "fixed", inset: "auto 0 0 auto", zIndex: 60 }}>
                <ErrorBoundary fallbackMessage="Copilot is unavailable.">
                    <CopilotWidget />
                </ErrorBoundary>
            </div>
            <ExportStatusToast />
        </div>
    );
}
