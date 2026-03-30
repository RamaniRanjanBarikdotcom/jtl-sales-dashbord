"use client";

import { useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { StatusFooter } from "@/components/layout/StatusFooter";
import { usePathname } from "next/navigation";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const [collapsed, setCollapsed] = useState(false);
    const pathname = usePathname();

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
