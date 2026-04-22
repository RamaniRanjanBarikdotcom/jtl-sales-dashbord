"use client";

/**
 * Admin — User Management
 * Plan Section 9:  GET/POST/PATCH /api/admin/users
 * Plan Section 10: /dashboard/admin/users  (admin only)
 *
 * Features per plan:
 *  • List all users in this tenant
 *  • Create user  (email, full_name, role='user', user_level, dept)
 *  • Edit user    (full_name, user_level, dept)
 *  • Deactivate / reactivate
 *  • Reset password → sets must_change_pwd = true
 */

import { useEffect, useRef, useState } from "react";
import { DS } from "@/lib/design-system";
import { Card } from "@/components/ui/Card";
import { SectionHeader as SH } from "@/components/ui/SectionHeader";
import { useStore, ROLE_META } from "@/lib/store";
import {
    useAdminUsers,
    useCreateUser,
    useUpdateUser,
    useDeactivateUser,
    useResetUserPwd,
    useRotateSyncKey,
    type AdminUser,
    type CreateUserDto,
} from "@/hooks/useAdminData";

// ── password rules (plan Section 8) ──────────────────────────────────────────
const PWD_RULES = [
    { id: "len", label: "8+ chars",     test: (p: string) => p.length >= 8 },
    { id: "up",  label: "Uppercase",    test: (p: string) => /[A-Z]/.test(p) },
    { id: "lo",  label: "Lowercase",    test: (p: string) => /[a-z]/.test(p) },
    { id: "num", label: "Number",       test: (p: string) => /[0-9]/.test(p) },
    { id: "spc", label: "Special char", test: (p: string) => /[!@#$%^&*]/.test(p) },
];

// ── helpers ────────────────────────────────────────────────────────────────────
const fmtDate = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.toLocaleDateString("de-DE")} ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
};

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

// ── field masking per role (plan Section 8) ───────────────────────────────────
const USER_LEVEL_META = {
    viewer:  { color: DS.violet, label: "Viewer" },
    analyst: { color: DS.cyan,   label: "Analyst" },
    manager: { color: DS.sky,    label: "Manager" },
};

// ── modal overlay ─────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
    return (
        <div style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(2,5,15,0.8)", backdropFilter: "blur(6px)",
            display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={e => e.target === e.currentTarget && onClose()}>
            <div style={{
                width: "100%", maxWidth: 460, margin: "0 16px",
                background: "#0a1525", border: `1px solid ${DS.border}`,
                borderRadius: 16, padding: "26px 24px",
                boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
                animation: "fadeUp .25s ease",
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
                    <h3 style={{ margin: 0, fontFamily: DS.display, fontWeight: 400, fontSize: 18, color: DS.hi }}>{title}</h3>
                    <button onClick={onClose} style={{ background: "none", border: "none", color: DS.lo, fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
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

// ── create user modal ─────────────────────────────────────────────────────────
function CreateUserModal({ onClose }: { onClose: () => void }) {
    const createUser = useCreateUser();
    const [form, setForm] = useState<CreateUserDto>({ email: "", full_name: "", role: "user", user_level: "viewer", dept: "" });
    const [err, setErr] = useState("");
    const [done, setDone] = useState(false);

    const set = (k: keyof CreateUserDto, v: string) => setForm(f => ({ ...f, [k]: v }));

    const submit = async () => {
        if (!form.email || !form.full_name) { setErr("Email and full name are required."); return; }
        setErr("");
        try {
            await createUser.mutateAsync(form);
            setDone(true);
            setTimeout(onClose, 900);
        } catch { setErr("Failed to create user. Try again."); }
    };

    return (
        <Modal title="Add User" onClose={onClose}>
            <FormRow label="Email">
                <input style={INPUT_STYLE} type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="user@company.com" />
            </FormRow>
            <FormRow label="Full Name">
                <input style={INPUT_STYLE} value={form.full_name} onChange={e => set("full_name", e.target.value)} placeholder="Anna Schmidt" />
            </FormRow>
            <FormRow label="Access Level">
                <select style={SELECT_STYLE} value={form.user_level} onChange={e => set("user_level", e.target.value as CreateUserDto["user_level"])}>
                    <option value="viewer">Viewer — read-only, sensitive fields hidden</option>
                    <option value="analyst">Analyst — all data visible</option>
                    <option value="manager">Manager — all data + export</option>
                </select>
            </FormRow>
            <FormRow label="Department">
                <input style={INPUT_STYLE} value={form.dept} onChange={e => set("dept", e.target.value)} placeholder="Sales, Marketing, …" />
            </FormRow>

            <div style={{ fontSize: 10, color: DS.amber, background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 8, padding: "8px 12px", marginBottom: 16 }}>
                ⚠ The user will be required to set a new password on first login.
            </div>

            {err && <p style={{ margin: "0 0 12px", fontSize: 11, color: DS.rose }}>{err}</p>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={onClose} style={BTN({ background: "rgba(255,255,255,0.06)", color: DS.mid })}>Cancel</button>
                <button onClick={submit} disabled={createUser.isPending || done}
                    style={BTN({ background: done ? "rgba(16,185,129,0.15)" : DS.sky, color: done ? DS.emerald : "#000" })}>
                    {done ? "✓ Created" : createUser.isPending ? "Creating…" : "Create User"}
                </button>
            </div>
        </Modal>
    );
}

// ── edit user modal ───────────────────────────────────────────────────────────
function EditUserModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
    const updateUser = useUpdateUser();
    const [form, setForm] = useState({ full_name: user.full_name, user_level: user.user_level ?? "viewer", dept: user.dept });
    const [err, setErr] = useState("");
    const [done, setDone] = useState(false);

    const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

    const submit = async () => {
        if (!form.full_name) { setErr("Full name is required."); return; }
        setErr("");
        try {
            await updateUser.mutateAsync({ id: user.id, dto: form });
            setDone(true);
            setTimeout(onClose, 700);
        } catch { setErr("Update failed. Try again."); }
    };

    return (
        <Modal title={`Edit — ${user.full_name}`} onClose={onClose}>
            <FormRow label="Full Name">
                <input style={INPUT_STYLE} value={form.full_name} onChange={e => set("full_name", e.target.value)} />
            </FormRow>
            {user.role === "user" && (
                <FormRow label="Access Level">
                    <select style={SELECT_STYLE} value={form.user_level} onChange={e => set("user_level", e.target.value)}>
                        <option value="viewer">Viewer</option>
                        <option value="analyst">Analyst</option>
                        <option value="manager">Manager</option>
                    </select>
                </FormRow>
            )}
            <FormRow label="Department">
                <input style={INPUT_STYLE} value={form.dept} onChange={e => set("dept", e.target.value)} />
            </FormRow>

            {err && <p style={{ margin: "0 0 12px", fontSize: 11, color: DS.rose }}>{err}</p>}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={onClose} style={BTN({ background: "rgba(255,255,255,0.06)", color: DS.mid })}>Cancel</button>
                <button onClick={submit} disabled={updateUser.isPending || done}
                    style={BTN({ background: done ? "rgba(16,185,129,0.15)" : DS.emerald, color: done ? DS.emerald : "#000" })}>
                    {done ? "✓ Saved" : updateUser.isPending ? "Saving…" : "Save Changes"}
                </button>
            </div>
        </Modal>
    );
}

// ── action menu (three-dot) ───────────────────────────────────────────────────
function ActionMenu({ user, onEdit }: { user: AdminUser; onEdit: () => void }) {
    const [open, setOpen] = useState(false);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
    const triggerRef = useRef<HTMLButtonElement>(null);
    const deactivate = useDeactivateUser();
    const resetPwd   = useResetUserPwd();
    const updateUser = useUpdateUser();

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

    const handleDeactivate = async () => {
        setOpen(false);
        await deactivate.mutateAsync(user.id);
    };

    const handleReactivate = async () => {
        setOpen(false);
        await updateUser.mutateAsync({ id: user.id, dto: { is_active: true } });
    };

    const handleResetPwd = async () => {
        setOpen(false);
        await resetPwd.mutateAsync(user.id);
    };

    return (
        <div style={{ position: "relative" }}>
            <button
                ref={triggerRef}
                onClick={() => {
                    if (!open) placeMenu();
                    setOpen(!open);
                }}
                style={{ background: "transparent", border: "none", color: DS.lo, cursor: "pointer", fontSize: 16, padding: "2px 6px", borderRadius: 5 }}>
                ⋮
            </button>
            {open && (
                <>
                    <div style={{ position: "fixed", inset: 0, zIndex: 1199 }} onClick={() => setOpen(false)} />
                    <div style={{
                        position: "fixed", top: menuPos.top, left: menuPos.left, zIndex: 1200,
                        background: "#0d1e35", border: `1px solid ${DS.border}`, borderRadius: 9,
                        padding: "5px", minWidth: 170, boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
                    }}>
                        {[
                            { label: "✏ Edit details",      action: () => { setOpen(false); onEdit(); }, color: DS.hi },
                            { label: "🔑 Reset password",    action: handleResetPwd, color: DS.amber },
                            user.is_active
                                ? { label: "⛔ Deactivate",  action: handleDeactivate, color: DS.rose }
                                : { label: "✓ Reactivate",   action: handleReactivate, color: DS.emerald },
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

// ── main page ─────────────────────────────────────────────────────────────────
export default function AdminPage() {
    const { session } = useStore();
    const { data: users = [] } = useAdminUsers();
    const rotateSyncKey = useRotateSyncKey();
    const [showCreate, setShowCreate] = useState(false);
    const [editUser,   setEditUser]   = useState<AdminUser | null>(null);
    const [search, setSearch] = useState("");
    const [newSyncKey, setNewSyncKey] = useState<string | null>(null);
    const [rotating, setRotating] = useState(false);

    const handleRotateKey = async () => {
        if (!session?.tenantId) return;
        setRotating(true);
        try {
            const result = await rotateSyncKey.mutateAsync(session.tenantId);
            setNewSyncKey(result.sync_api_key);
            setTimeout(() => setNewSyncKey(null), 30000); // Hide after 30s
        } catch {
            // error handled silently
        } finally {
            setRotating(false);
        }
    };

    if (session?.role !== "admin" && session?.role !== "super_admin") {
        return (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, gap: 16 }}>
                <span style={{ fontSize: 40 }}>🔒</span>
                <h3 style={{ fontFamily: DS.display, fontWeight: 400, fontSize: 20, color: DS.hi, margin: 0 }}>Access Restricted</h3>
                <p style={{ fontSize: 13, color: DS.lo, margin: 0, textAlign: "center" }}>This page is only available to administrators.</p>
            </div>
        );
    }

    const filtered = users.filter(u =>
        u.full_name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase())
    );

    const activeCount   = users.filter(u => u.is_active).length;
    const pendingCount  = users.filter(u => u.must_change_pwd).length;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}`}</style>

            {/* Summary KPI row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                {[
                    { label: "Total Users",         value: users.length,  c: DS.sky,     icon: "👤" },
                    { label: "Active",               value: activeCount,   c: DS.emerald, icon: "✓" },
                    { label: "Inactive",             value: users.length - activeCount, c: DS.lo, icon: "⛔" },
                    { label: "Pending Pwd Change",   value: pendingCount,  c: DS.amber,   icon: "🔑" },
                ].map((k, i) => (
                    <div key={i} style={{ background: DS.surface, border: `1px solid ${DS.border}`, borderRadius: 12, padding: "14px 16px", borderTop: `2px solid ${k.c}` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                            <span style={{ fontSize: 14 }}>{k.icon}</span>
                            <span style={{ fontSize: 10, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.07em" }}>{k.label}</span>
                        </div>
                        <div style={{ fontFamily: DS.display, fontSize: 28, color: k.c }}>{k.value}</div>
                    </div>
                ))}
            </div>

            {/* Users table */}
            <Card accent={DS.sky}>
                <SH title="User Management" sub={`${filtered.length} of ${users.length} users · ${session?.tenantId ?? "demo tenant"}`}
                    right={
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input
                                value={search} onChange={e => setSearch(e.target.value)}
                                placeholder="Search users…"
                                style={{ ...INPUT_STYLE, width: 180, padding: "6px 11px" }}
                            />
                            <button onClick={() => setShowCreate(true)}
                                style={BTN({ background: DS.sky, color: "#000", padding: "7px 14px" })}>
                                + Add User
                            </button>
                        </div>
                    }
                />

                <div style={{ overflowX: "auto", marginTop: 6 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
                        <thead>
                            <tr style={{ borderBottom: `1px solid ${DS.border}` }}>
                                {["User", "Email", "Level", "Dept", "Last Login", "Status", ""].map((h, i) => (
                                    <th key={i} style={{
                                        textAlign: i === 6 ? "right" : "left",
                                        fontSize: 9, color: DS.lo, letterSpacing: "0.07em",
                                        textTransform: "uppercase", padding: "0 10px 10px", fontWeight: 500,
                                    }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(u => {
                                const rm  = u.role === "admin" ? ROLE_META["admin"] : ROLE_META[u.user_level ?? "viewer"];
                                const ulm = u.user_level ? USER_LEVEL_META[u.user_level] : null;
                                return (
                                    <tr key={u.id} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                                        <td style={{ padding: "12px 10px" }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                                <div style={{
                                                    width: 30, height: 30, borderRadius: "50%",
                                                    background: `linear-gradient(135deg, ${DS.sky}, ${DS.violet})`,
                                                    display: "flex", alignItems: "center", justifyContent: "center",
                                                    fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0,
                                                }}>{u.full_name.charAt(0)}</div>
                                                <div>
                                                    <div style={{ fontSize: 12, color: DS.hi, fontWeight: 500 }}>{u.full_name}</div>
                                                    {u.must_change_pwd && (
                                                        <div style={{ fontSize: 9, color: DS.amber, marginTop: 1 }}>⚠ must change pwd</div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ padding: "12px 10px", fontSize: 11, color: DS.mid }}>{u.email}</td>
                                        <td style={{ padding: "12px 10px" }}>
                                            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, background: rm.bg, border: `1px solid ${rm.color}33`, borderRadius: 20, padding: "2px 9px" }}>
                                                <span style={{ fontSize: 9, color: rm.color }}>{rm.icon}</span>
                                                <span style={{ fontSize: 9, color: rm.color, fontWeight: 700 }}>
                                                    {u.role === "admin" ? "Admin" : ulm?.label ?? "—"}
                                                </span>
                                            </div>
                                        </td>
                                        <td style={{ padding: "12px 10px", fontSize: 11, color: DS.lo }}>{u.dept || "—"}</td>
                                        <td style={{ padding: "12px 10px", fontSize: 10, color: DS.lo, fontFamily: DS.mono, whiteSpace: "nowrap" }}>{fmtDate(u.last_login_at)}</td>
                                        <td style={{ padding: "12px 10px" }}>
                                            <span style={{
                                                fontSize: 10, padding: "2px 8px", borderRadius: 12, fontWeight: 600,
                                                color:       u.is_active ? DS.emerald : DS.lo,
                                                background:  u.is_active ? "rgba(16,185,129,0.1)" : "rgba(255,255,255,0.05)",
                                            }}>{u.is_active ? "Active" : "Inactive"}</span>
                                        </td>
                                        <td style={{ padding: "12px 10px", textAlign: "right" }}>
                                            <ActionMenu user={u} onEdit={() => setEditUser(u)} />
                                        </td>
                                    </tr>
                                );
                            })}
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan={7} style={{ padding: "32px 10px", textAlign: "center", color: DS.lo, fontSize: 12 }}>
                                        No users match "{search}"
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>

            {/* Sync key management */}
            <Card accent={DS.amber}>
                <SH title="Sync API Key" sub="Used by the JTL sync engine to authenticate ingest requests" />
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
                    <div style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: `1px solid ${DS.border}`, borderRadius: 8, padding: "10px 14px", fontFamily: DS.mono, fontSize: 12, color: newSyncKey ? DS.amber : DS.lo, letterSpacing: "0.08em", wordBreak: "break-all" }}>
                        {newSyncKey ? newSyncKey : "jtl_•••••••••••••••••••••••••• (hidden for security)"}
                    </div>
                    <button onClick={handleRotateKey} disabled={rotating}
                        style={BTN({ background: "rgba(245,158,11,0.12)", color: DS.amber, border: "1px solid rgba(245,158,11,0.25)", opacity: rotating ? 0.6 : 1 })}>
                        {rotating ? "Rotating…" : "↻ Rotate Key"}
                    </button>
                </div>
                {newSyncKey && (
                    <p style={{ margin: "8px 0 0", fontSize: 10, color: DS.amber }}>
                        ⚠ Copy this key now — it will be hidden again in 30 seconds.
                    </p>
                )}
                <p style={{ margin: "10px 0 0", fontSize: 10, color: DS.lo }}>
                    Rotating the key immediately invalidates the old one. Update your sync engine .env after rotating.
                </p>
            </Card>

            {/* Modals */}
            {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} />}
            {editUser   && <EditUserModal user={editUser} onClose={() => setEditUser(null)} />}
        </div>
    );
}
