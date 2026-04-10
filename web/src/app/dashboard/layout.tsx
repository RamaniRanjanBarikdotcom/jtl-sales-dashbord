"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { StatusFooter } from "@/components/layout/StatusFooter";
import { usePathname } from "next/navigation";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const [collapsed, setCollapsed] = useState(false);
    const [mounted, setMounted] = useState(false);
    const pathname = usePathname();

    useEffect(() => setMounted(true), []);

    // Prevent SSR hydration mismatch: the dashboard is fully client-side
    // (behind auth), so render a minimal shell on server, full layout on client.
    if (!mounted) {
        return <div style={{ minHeight: "100vh", background: "#04060f" }} />;
    }

    return (
        <div style={{ display: "flex", minHeight: "100vh" }}>
            <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />

            <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                <Topbar />

                <main className="tab-in" key={pathname} style={{
                    flex: 1, padding: "20px 24px 40px", overflowY: "auto",
                }}>
                    {children}
                </main>

                <StatusFooter />
            </div>
        </div>
    );
}
