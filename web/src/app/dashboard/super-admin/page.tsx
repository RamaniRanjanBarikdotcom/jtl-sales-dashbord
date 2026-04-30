"use client";

/**
 * Super Admin — Platform Management
 * Plan Section 9:
 *   GET  /api/admin/tenants
 *   POST /api/admin/tenants          → creates tenant + first admin + SYNC_API_KEY
 *   PATCH /api/admin/tenants/:id/deactivate
 *   GET  /api/admin/platform/overview
 * Plan Section 10: /dashboard/super-admin  (super_admin only)
 */

import { useEffect, useRef, useState } from "react";
import { DS } from "@/lib/design-system";
import { Card } from "@/components/ui/Card";
import { SectionHeader as SH } from "@/components/ui/SectionHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { useStore } from "@/lib/store";
import {
    useAdminTenants,
    usePlatformOverview,
    useCreateTenant,
    useDeactivateTenant,
    useAuditLogs,
    type AdminTenant,
    type CreateTenantDto,
    type AuditLogEvent,
} from "@/hooks/useAdminData";

// ── styles ────────────────────────────────────────────────────────────────────
const INPUT_STYLE: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${DS.border}`, borderRadius: 8,
    padding: "9px 12px", color: DS.hi, fontSize: 12,
    fontFamily: "inherit", outline: "none",
};
const SELECT_STYLE: React.CSSProperties = { ...INPUT_STYLE, cursor: "pointer" };
const BTN = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    border: "none", borderRadius: 7, padding: "6px 13px",
    fontSize: 11, fontFamily: "inherit", fontWeight: 600,
    cursor: "pointer", transition: "opacity .15s", ...extra,
});

// ── helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (iso: string | null) => {
    if (!iso) return "Never";
    const d = new Date(iso);
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / 1000;
    if (diff < 60)     return "Just now";
    if (diff < 3600)   return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400)  return `${Math.floor(diff / 3600)} hr ago`;
    return d.toLocaleDateString("de-DE");
};

// ── modal ─────────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
    return (
        <div style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(2,5,15,0.82)", backdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={e => e.target === e.currentTarget && onClose()}>
            <div style={{
                width: "100%", maxWidth: 480, margin: "0 16px",
                background: "#0a1525", border: `1px solid ${DS.border}`,
                borderRadius: 16, padding: "26px 24px",
                boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
                animation: "fadeUp .25s ease",
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
                    <h3 style={{ margin: 0, fontFamily: DS.display, fontWeight: 400, fontSize: 18, color: DS.hi }}>{title}</h3>
                    <button onClick={onClose} style={{ background: "none", border: "none", color: DS.lo, fontSize: 18, cursor: "pointer" }}>×</button>
                </div>
                {children}
            </div>
        </div>
    );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 10, color: DS.lo, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 }}>{label}</label>
            {children}
        </div>
    );
}

// ── create tenant modal ───────────────────────────────────────────────────────
function CreateTenantModal({ onClose }: { onClose: () => void }) {
    const createTenant = useCreateTenant();
    const [form, setForm] = useState<CreateTenantDto>({ name: "", slug: "", timezone: "Europe/Berlin", currency: "EUR", vat_rate: 0.19 });
    const [adminEmail, setAdminEmail] = useState("");
    const [adminName,  setAdminName]  = useState("");
    const [err, setErr] = useState("");
    const [done, setDone] = useState(false);

    const set = (k: keyof CreateTenantDto, v: string | number) => setForm(f => ({ ...f, [k]: v }));

    const autoSlug = (name: string) => name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

    const submit = async () => {
        if (!form.name || !form.slug || !adminEmail || !adminName) { setErr("All fields are required."); return; }
        setErr("");
        try {
            await createTenant.mutateAsync({
                ...form,
                admin_email: adminEmail.trim(),
                admin_name: adminName.trim(),
            });
            setDone(true);
            setTimeout(onClose, 1000);
        } catch { setErr("Failed to create tenant. Try again."); }
    };

    return (
        <Modal title="Create New Tenant" onClose={onClose}>
            <div style={{ fontSize: 10, color: DS.sky, marginBottom: 16 }}>
                This will create the tenant, first admin user, and a SYNC_API_KEY in one step.
            </div>

            <FormRow label="Company Name">
                <input style={INPUT_STYLE} value={form.name}
                    onChange={e => { set("name", e.target.value); set("slug", autoSlug(e.target.value)); }}
                    placeholder="Acme GmbH" />
            </FormRow>
            <FormRow label="Slug (URL-safe identifier)">
                <input style={INPUT_STYLE} value={form.slug}
                    onChange={e => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    placeholder="acme-gmbh" />
            </FormRow>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <FormRow label="Timezone">
                    <select style={SELECT_STYLE} value={form.timezone} onChange={e => set("timezone", e.target.value)}>
                        <option>Europe/Berlin</option>
                        <option>Europe/Vienna</option>
                        <option>Europe/Zurich</option>
                        <option>UTC</option>
                    </select>
                </FormRow>
                <FormRow label="Currency">
                    <select style={SELECT_STYLE} value={form.currency} onChange={e => set("currency", e.target.value)}>
                        <option>EUR</option>
                        <option>CHF</option>
                        <option>USD</option>
                    </select>
                </FormRow>
                <FormRow label="VAT Rate">
                    <select style={SELECT_STYLE} value={form.vat_rate} onChange={e => set("vat_rate", parseFloat(e.target.value))}>
                        <option value={0.19}>19% (DE)</option>
                        <option value={0.20}>20% (AT)</option>
                        <option value={0.077}>7.7% (CH)</option>
                        <option value={0}>0% (Custom)</option>
                    </select>
                </FormRow>
            </div>

            <div style={{ height: 1, background: DS.border, margin: "4px 0 16px" }} />
            <p style={{ margin: "0 0 12px", fontSize: 10, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.07em" }}>First Admin User</p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <FormRow label="Admin Name">
                    <input style={INPUT_STYLE} value={adminName} onChange={e => setAdminName(e.target.value)} placeholder="Max Müller" />
                </FormRow>
                <FormRow label="Admin Email">
                    <input style={INPUT_STYLE} type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} placeholder="admin@company.com" />
                </FormRow>
            </div>

            {err && <p style={{ margin: "0 0 12px", fontSize: 11, color: DS.rose }}>{err}</p>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={onClose} style={BTN({ background: "rgba(255,255,255,0.06)", color: DS.mid })}>Cancel</button>
                <button onClick={submit} disabled={createTenant.isPending || done}
                    style={BTN({ background: done ? "rgba(16,185,129,0.15)" : DS.orange, color: done ? DS.emerald : "#fff" })}>
                    {done ? "✓ Created" : createTenant.isPending ? "Creating…" : "Create Tenant"}
                </button>
            </div>
        </Modal>
    );
}

// ── tenant row action menu ─────────────────────────────────────────────────────
function TenantMenu({ tenant }: { tenant: AdminTenant }) {
    const [open, setOpen] = useState(false);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
    const triggerRef = useRef<HTMLButtonElement>(null);
    const deactivate = useDeactivateTenant();

    const placeMenu = () => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const menuWidth = 190;
        const menuHeight = 150;
        const gap = 6;
        const viewportPad = 8;
        const top = (rect.bottom + gap + menuHeight <= window.innerHeight)
            ? rect.bottom + gap
            : Math.max(viewportPad, rect.top - menuHeight - gap);
        const left = Math.max(
            viewportPad,
            Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - viewportPad),
        );

        setMenuPos({ top, left });
    };

    useEffect(() => {
        if (!open) return;
        placeMenu();

        const onWindowChange = () => placeMenu();
        window.addEventListener("resize", onWindowChange);
        window.addEventListener("scroll", onWindowChange, true);
        return () => {
            window.removeEventListener("resize", onWindowChange);
            window.removeEventListener("scroll", onWindowChange, true);
        };
    }, [open]);

    return (
        <div style={{ position: "relative" }}>
            <button
                ref={triggerRef}
                onClick={() => {
                    if (!open) placeMenu();
                    setOpen(!open);
                }}
                style={{ background: "transparent", border: "none", color: DS.lo, cursor: "pointer", fontSize: 16, padding: "2px 6px" }}>
                ⋮
            </button>
            {open && (
                <>
                    <div style={{ position: "fixed", inset: 0, zIndex: 1199 }} onClick={() => setOpen(false)} />
                    <div style={{
                        position: "fixed", top: menuPos.top, left: menuPos.left, zIndex: 1200,
                        background: "#0d1e35", border: `1px solid ${DS.border}`, borderRadius: 9,
                        padding: 5, minWidth: 170, boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
                    }}>
                        {[
                            { label: "🔑 View Sync Key",  action: () => setOpen(false), color: DS.sky },
                            { label: "↻ Rotate Sync Key", action: () => setOpen(false), color: DS.amber },
                            tenant.is_active
                                ? { label: "⛔ Deactivate", action: () => { setOpen(false); deactivate.mutate(tenant.id); }, color: DS.rose }
                                : { label: "✓ Reactivate",  action: () => setOpen(false), color: DS.emerald },
                        ].map((item, i) => (
                            <button key={i} onClick={item.action}
                                style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "8px 11px", borderRadius: 6, fontSize: 12, color: item.color, fontFamily: "inherit" }}>
                                {item.label}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

// ── audit log table ───────────────────────────────────────────────────────────
function AuditLogTable() {
    const { data: logs = [], isLoading } = useAuditLogs(200);
    const [filter, setFilter] = useState("");

    const ACTION_COLORS: Record<string, string> = {
        "admin.user.create": DS.emerald,
        "admin.user.deactivate": DS.rose,
        "admin.user.reset_password": DS.amber,
        "admin.permissions.set": DS.violet,
        "admin.tenant.create": DS.orange,
        "admin.tenant.deactivate": DS.rose,
        "admin.sync.rotate_key": DS.amber,
        "admin.sync.trigger": DS.sky,
    };

    const filtered = logs.filter(l =>
        !filter ||
        l.action.includes(filter) ||
        (l.actorId ?? "").includes(filter) ||
        (l.tenantId ?? "").includes(filter)
    );

    return (
        <Card accent={DS.violet}>
            <SH
                title="Audit Log"
                sub={`${filtered.length} of ${logs.length} recent events · refreshes every 30s`}
                right={
                    <input
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                        placeholder="Filter by action, actor…"
                        style={{ ...INPUT_STYLE, width: 200, padding: "6px 11px" }}
                    />
                }
            />
            <div style={{ overflowX: "auto", marginTop: 6 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                    <thead>
                        <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                            {["Time", "Action", "Actor", "Target", "Tenant"].map((h, i) => (
                                <th key={i} style={{
                                    textAlign: "left", fontSize: 9, color: DS.lo,
                                    letterSpacing: "0.07em", textTransform: "uppercase",
                                    padding: "0 10px 10px", fontWeight: 500,
                                }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading && (
                            <tr><td colSpan={5} style={{ padding: "24px 10px", textAlign: "center", color: DS.lo, fontSize: 12 }}>Loading…</td></tr>
                        )}
                        {!isLoading && filtered.length === 0 && (
                            <tr><td colSpan={5} style={{ padding: "24px 10px", textAlign: "center", color: DS.lo, fontSize: 12 }}>No audit events found.</td></tr>
                        )}
                        {filtered.map((e: AuditLogEvent, i: number) => {
                            const color = ACTION_COLORS[e.action] || DS.mid;
                            const d = new Date(e.at);
                            const time = `${d.toLocaleDateString("de-DE")} ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
                            return (
                                <tr key={i} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                                    <td style={{ padding: "9px 10px", fontSize: 10, color: DS.lo, fontFamily: DS.mono, whiteSpace: "nowrap" }}>{time}</td>
                                    <td style={{ padding: "9px 10px" }}>
                                        <span style={{ fontSize: 10, fontFamily: DS.mono, color }}>{e.action}</span>
                                    </td>
                                    <td style={{ padding: "9px 10px", fontSize: 10, color: DS.mid, fontFamily: DS.mono }}>
                                        {e.actorId ? e.actorId.slice(0, 8) + "…" : "—"}
                                    </td>
                                    <td style={{ padding: "9px 10px", fontSize: 10, color: DS.mid, fontFamily: DS.mono }}>
                                        {e.targetId ? e.targetId.slice(0, 8) + "…" : "—"}
                                    </td>
                                    <td style={{ padding: "9px 10px", fontSize: 10, color: DS.lo, fontFamily: DS.mono }}>
                                        {e.tenantId ? e.tenantId.slice(0, 8) + "…" : "—"}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}

// ── main page ─────────────────────────────────────────────────────────────────
export default function SuperAdminPage() {
    const { session } = useStore();
    const { data: tenants = [] }  = useAdminTenants();
    const { data: overview }      = usePlatformOverview();
    const [showCreate, setShowCreate] = useState(false);
    const [search, setSearch] = useState("");
    const [activeTab, setActiveTab] = useState<"tenants" | "audit">("tenants");

    if (session?.role !== "super_admin") {
        return (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, gap: 16 }}>
                <span style={{ fontSize: 40 }}>🔒</span>
                <h3 style={{ fontFamily: DS.display, fontWeight: 400, fontSize: 20, color: DS.hi, margin: 0 }}>Super Admin Only</h3>
                <p style={{ fontSize: 13, color: DS.lo, margin: 0 }}>This page is restricted to super administrators.</p>
            </div>
        );
    }

    const filtered = tenants.filter(t =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.slug.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}`}</style>

            {/* Platform KPI row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                <KpiCard label="Total Tenants"   value={String(overview?.totalTenants  ?? "—")} delta={0}    note="registered" c={DS.orange} icon="🏢" data={[]} k="rev" />
                <KpiCard label="Active Tenants"  value={String(overview?.activeTenants ?? "—")} delta={0}    note="active now"  c={DS.emerald} icon="✓"  data={[]} k="rev" />
                <KpiCard label="Total Users"     value={String(overview?.totalUsers    ?? "—")} delta={0}    note="across all"  c={DS.sky}    icon="👤" data={[]} k="rev" />
                <KpiCard label="Syncs Today"     value={String(overview?.syncsToday    ?? "—")} delta={14.2} note="vs yesterday" c={DS.violet} icon="⚡" data={[]} k="rev" />
            </div>

            {/* Tab switcher */}
            <div style={{ display: "flex", gap: 8 }}>
                {(["tenants", "audit"] as const).map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)}
                        style={BTN({
                            background: activeTab === tab ? (tab === "audit" ? "rgba(167,139,250,0.15)" : "rgba(249,115,22,0.15)") : "rgba(255,255,255,0.04)",
                            color: activeTab === tab ? (tab === "audit" ? DS.violet : DS.orange) : DS.lo,
                            border: `1px solid ${activeTab === tab ? (tab === "audit" ? DS.violet : DS.orange) : DS.border}`,
                            padding: "8px 18px",
                        })}>
                        {tab === "tenants" ? "🏢 Tenants" : "📋 Audit Log"}
                    </button>
                ))}
            </div>

            {/* Tenant table */}
            {activeTab === "tenants" && <Card accent={DS.orange}>
                <SH title="Tenant Management" sub={`${filtered.length} of ${tenants.length} tenants`}
                    right={
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input
                                value={search} onChange={e => setSearch(e.target.value)}
                                placeholder="Search tenants…"
                                style={{ ...INPUT_STYLE, width: 180, padding: "6px 11px" }}
                            />
                            <button onClick={() => setShowCreate(true)}
                                style={BTN({ background: DS.orange, color: "#fff", padding: "7px 14px" })}>
                                + New Tenant
                            </button>
                        </div>
                    }
                />

                <div style={{ overflowX: "auto", marginTop: 6 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                        <thead>
                            <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                                {["Tenant", "Slug", "Users", "Currency / VAT", "Last Sync", "Status", ""].map((h, i) => (
                                    <th key={i} style={{
                                        textAlign: i === 6 ? "right" : "left",
                                        fontSize: 9, color: DS.lo, letterSpacing: "0.07em",
                                        textTransform: "uppercase", padding: "0 10px 10px", fontWeight: 500,
                                    }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(t => (
                                <tr key={t.id} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                                    <td style={{ padding: "12px 10px" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                            <div style={{
                                                width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                                                background: `linear-gradient(135deg, ${DS.orange}, ${DS.amber})`,
                                                display: "flex", alignItems: "center", justifyContent: "center",
                                                fontSize: 14, fontWeight: 700, color: "#fff",
                                            }}>{t.name.charAt(0)}</div>
                                            <span style={{ fontSize: 12, color: DS.hi, fontWeight: 500 }}>{t.name}</span>
                                        </div>
                                    </td>
                                    <td style={{ padding: "12px 10px", fontFamily: DS.mono, fontSize: 11, color: DS.mid }}>{t.slug}</td>
                                    <td style={{ padding: "12px 10px", fontSize: 12, color: DS.hi }}>{t.user_count}</td>
                                    <td style={{ padding: "12px 10px", fontSize: 11, color: DS.lo, fontFamily: DS.mono }}>
                                        {t.currency} · {(t.vat_rate * 100).toFixed(0)}%
                                    </td>
                                    <td style={{ padding: "12px 10px", fontSize: 10, color: DS.lo, whiteSpace: "nowrap" }}>{fmtDate(t.last_sync)}</td>
                                    <td style={{ padding: "12px 10px" }}>
                                        <span style={{
                                            fontSize: 10, padding: "2px 8px", borderRadius: 12, fontWeight: 600,
                                            color:      t.is_active ? DS.emerald : DS.lo,
                                            background: t.is_active ? "rgba(16,185,129,0.1)" : "rgba(255,255,255,0.05)",
                                        }}>{t.is_active ? "Active" : "Inactive"}</span>
                                    </td>
                                    <td style={{ padding: "12px 10px", textAlign: "right" }}>
                                        <TenantMenu tenant={t} />
                                    </td>
                                </tr>
                            ))}
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan={7} style={{ padding: "32px 10px", textAlign: "center", color: DS.lo, fontSize: 12 }}>
                                        No tenants match "{search}"
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>}

            {/* Platform notes (tenants tab only) */}
            {activeTab === "tenants" && (
                <Card accent={DS.sky}>
                    <SH title="Platform Notes" sub="Super admin guidance" />
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                        {[
                            { icon: "🔑", text: "After creating a tenant, share the SYNC_API_KEY with the client's JTL office server via a secure channel." },
                            { icon: "⚠",  text: "Deactivating a tenant blocks all logins and stops ingest immediately. Watermarks are preserved for re-activation." },
                            { icon: "💊", text: "Monitor per-tenant sync health from the Sync Status tab. Idle detection triggers a full sync after 30 min of no dashboard activity." },
                        ].map((n, i) => (
                            <div key={i} style={{ display: "flex", gap: 10, background: "rgba(255,255,255,0.02)", border: `1px solid ${DS.border}`, borderRadius: 9, padding: "10px 14px" }}>
                                <span style={{ fontSize: 14, flexShrink: 0 }}>{n.icon}</span>
                                <span style={{ fontSize: 11, color: DS.mid, lineHeight: 1.6 }}>{n.text}</span>
                            </div>
                        ))}
                    </div>
                </Card>
            )}

            {/* Audit log tab */}
            {activeTab === "audit" && <AuditLogTable />}

            {showCreate && <CreateTenantModal onClose={() => setShowCreate(false)} />}
        </div>
    );
}
