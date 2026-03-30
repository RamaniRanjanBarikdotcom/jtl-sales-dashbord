"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DS } from "@/lib/design-system";
import { useStore, ROLE_META } from "@/lib/store";

const NAV_ITEMS = [
    { id: "overview",  path: "/dashboard/overview",  label: "Overview",  icon: "❖",  desc: "Executive summary" },
    { id: "sales",     path: "/dashboard/sales",     label: "Sales",     icon: "◈",  desc: "KPIs & trends" },
    { id: "products",  path: "/dashboard/products",  label: "Products",  icon: "◉",  desc: "SKU performance" },
    { id: "customers", path: "/dashboard/customers", label: "Customers", icon: "◆",  desc: "Segments & LTV" },
    { id: "regional",  path: "/dashboard/regional",  label: "Regional",  icon: "◇",  desc: "Geo breakdown" },
    { id: "inventory", path: "/dashboard/inventory", label: "Inventory", icon: "📦", desc: "Stock & alerts" },
    { id: "marketing", path: "/dashboard/marketing", label: "Marketing", icon: "🎯", desc: "Ads & campaigns" },
];

// settings = all roles; sync = manager+; admin/super-admin = role-gated
const SETTINGS_ITEMS = [
    { id: "settings",    path: "/dashboard/settings",    label: "Settings",        icon: "◎",  desc: "Preferences & profile", roles: [] as string[], syncDot: false },
    { id: "sync",        path: "/dashboard/sync",        label: "Sync Status",     icon: "⚙️", desc: "System health",         roles: [] as string[], syncDot: true },
    { id: "admin",       path: "/dashboard/admin",       label: "User Management", icon: "👤", desc: "Accounts & roles",      roles: ["admin"],       syncDot: false },
    { id: "super-admin", path: "/dashboard/super-admin", label: "Platform",        icon: "★",  desc: "Tenants & overview",    roles: ["super_admin"], syncDot: false },
];

export function Sidebar({ collapsed, setCollapsed }: { collapsed: boolean; setCollapsed: (c: boolean) => void }) {
    const pathname = usePathname();
    const { session, can } = useStore();
    const role = session?.role || "viewer";
    const rm = ROLE_META[role] || ROLE_META["viewer"];
    const sideW = collapsed ? 64 : 224;

    const filteredNav      = NAV_ITEMS.filter(n => can(n.id));
    // sync is always shown; admin/super-admin items are role-gated
    const filteredSettings = SETTINGS_ITEMS.filter(s => s.roles.length === 0 || can(s.id));
    const hasSettings      = filteredSettings.length > 0;

    const navLink = (path: string, icon: string, label: string, desc: string, activeColor: string) => {
        const isActive = pathname === path;
        return (
            <Link key={path} href={path} style={{
                display: "flex", alignItems: "center",
                gap: collapsed ? 0 : 12,
                justifyContent: collapsed ? "center" : "flex-start",
                padding: collapsed ? "11px 0" : "10px 14px",
                borderRadius: 10, marginBottom: 2,
                textDecoration: "none",
                background: isActive ? `rgba(${hexToRgb(activeColor)},0.11)` : "transparent",
                boxShadow: isActive ? `inset 3px 0 0 ${activeColor}` : "none",
                transition: "background 0.15s",
            }}>
                <span style={{ fontSize: 15, flexShrink: 0, width: 22, textAlign: "center", opacity: isActive ? 1 : 0.65 }}>{icon}</span>
                {!collapsed && (
                    <div style={{ textAlign: "left", flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: isActive ? 600 : 400, color: isActive ? activeColor : DS.hi, lineHeight: 1.2 }}>
                            {label}
                        </div>
                        <div style={{ fontSize: 10, color: DS.lo, marginTop: 2 }}>{desc}</div>
                    </div>
                )}
            </Link>
        );
    };

    return (
        <aside style={{
            width: sideW, flexShrink: 0,
            background: "#070a18",
            borderRight: `1px solid ${DS.border}`,
            display: "flex", flexDirection: "column",
            position: "sticky", top: 0, height: "100vh",
            transition: "width 0.25s ease",
            overflow: "hidden",
        }}>
            {/* Logo */}
            <div style={{
                padding: "20px 12px", borderBottom: `1px solid ${DS.border}`,
                display: "flex", alignItems: "center", gap: 12, minHeight: 72,
                justifyContent: collapsed ? "center" : "flex-start",
            }}>
                <div style={{
                    width: 42, height: 42, flexShrink: 0, borderRadius: 12,
                    background: `linear-gradient(135deg, ${DS.sky}, ${DS.violet})`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 20, fontWeight: 800, color: "#fff",
                    boxShadow: "0 4px 14px rgba(96,165,250,0.22)",
                }}>J</div>
                {!collapsed && (
                    <div style={{ overflow: "hidden", whiteSpace: "nowrap" }}>
                        <div style={{ fontFamily: DS.display, fontSize: 17, color: DS.hi, lineHeight: 1.1, letterSpacing: "0.02em" }}>
                            JTL Analytics
                        </div>
                        <div style={{ fontSize: 9, color: DS.sky, letterSpacing: "0.15em", textTransform: "uppercase", marginTop: 3, fontWeight: 600 }}>
                            Intelligence
                        </div>
                    </div>
                )}
            </div>

            {/* Scrollable nav */}
            <nav style={{ padding: collapsed ? "14px 6px" : "14px 10px", flex: 1, overflowY: "auto" }}>

                {/* ── Analytics section ── */}
                {!collapsed && (
                    <p style={{ fontSize: 10, color: DS.lo, letterSpacing: "0.1em", textTransform: "uppercase", padding: "0 6px", marginBottom: 10, fontWeight: 600 }}>
                        Navigation
                    </p>
                )}
                {filteredNav.map(n => navLink(n.path, n.icon, n.label, n.desc, DS.sky))}

                {/* ── Settings section ── */}
                {hasSettings && (
                    <div style={{ borderTop: `1px solid ${DS.border}`, marginTop: 14, paddingTop: 14 }}>
                        {!collapsed && (
                            <p style={{ fontSize: 10, color: DS.lo, letterSpacing: "0.1em", textTransform: "uppercase", padding: "0 6px", marginBottom: 10, fontWeight: 600 }}>
                                Settings
                            </p>
                        )}
                        {filteredSettings.map(s => {
                            const color = s.id === "super-admin" ? "#f97316" : DS.emerald;
                            const isActive = pathname === s.path;
                            return (
                                <Link key={s.path} href={s.path} style={{
                                    display: "flex", alignItems: "center",
                                    gap: collapsed ? 0 : 12,
                                    justifyContent: collapsed ? "center" : "flex-start",
                                    padding: collapsed ? "11px 0" : "10px 14px",
                                    borderRadius: 10, marginBottom: 2,
                                    textDecoration: "none", position: "relative",
                                    background: isActive ? `rgba(${hexToRgb(color)},0.11)` : "transparent",
                                    boxShadow: isActive ? `inset 3px 0 0 ${color}` : "none",
                                    transition: "background 0.15s",
                                }}>
                                    <span style={{ fontSize: 15, flexShrink: 0, width: 22, textAlign: "center", opacity: isActive ? 1 : 0.65 }}>{s.icon}</span>
                                    {!collapsed && (
                                        <div style={{ textAlign: "left", flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 13, fontWeight: isActive ? 600 : 400, color: isActive ? color : DS.hi, lineHeight: 1.2 }}>
                                                {s.label}
                                            </div>
                                            <div style={{ fontSize: 10, color: DS.lo, marginTop: 2, display: "flex", alignItems: "center", gap: 5 }}>
                                                {s.syncDot && (
                                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                                        <span style={{ width: 5, height: 5, borderRadius: "50%", background: DS.emerald, display: "inline-block", boxShadow: `0 0 4px ${DS.emerald}88`, animation: "blink 2.4s infinite" }} />
                                                        <span style={{ color: DS.emerald, fontWeight: 600 }}>OK</span>
                                                        <span style={{ color: DS.lo }}>·</span>
                                                    </span>
                                                )}
                                                {s.desc}
                                            </div>
                                        </div>
                                    )}
                                    {collapsed && s.syncDot && (
                                        <span style={{ position: "absolute", top: 6, right: 6, width: 5, height: 5, borderRadius: "50%", background: DS.emerald, boxShadow: `0 0 4px ${DS.emerald}88` }} />
                                    )}
                                </Link>
                            );
                        })}
                    </div>
                )}
            </nav>

            {/* User chip + collapse */}
            <div style={{ padding: "12px", borderTop: `1px solid ${DS.border}` }}>
                {!collapsed && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, background: rm.bg, border: `1px solid ${rm.color}28`, marginBottom: 10 }}>
                        <span style={{ fontSize: 16, color: rm.color, flexShrink: 0 }}>{rm.icon}</span>
                        <div style={{ minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: 12, color: rm.color, fontWeight: 700 }}>{rm.label}</p>
                            <p style={{ margin: 0, fontSize: 10, color: DS.lo, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session?.name}</p>
                        </div>
                    </div>
                )}
                <button onClick={() => setCollapsed(!collapsed)} style={{
                    width: "100%", padding: "8px", borderRadius: 8,
                    border: `1px solid ${DS.border}`, background: "transparent",
                    color: DS.lo, fontSize: 13, cursor: "pointer", transition: "all 0.15s",
                }}>
                    {collapsed ? "›" : "‹"}
                </button>
            </div>
        </aside>
    );
}

// tiny helper — converts #rrggbb to "r,g,b" for rgba()
function hexToRgb(hex: string): string {
    const h = hex.replace("#", "");
    if (h.length !== 6) return "56,189,248";
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `${r},${g},${b}`;
}
