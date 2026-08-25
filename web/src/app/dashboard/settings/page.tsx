"use client";

import { useEffect, useState } from "react";
import { DS } from "@/lib/design-system";
import { useStore } from "@/lib/store";
import {
    useCompanySettings,
    useCompanySyncConfig,
    useGetPreferences,
    usePlatformSettings,
    useSignOutAllSessions,
    useUpdateCompanySettings,
    useUpdateCompanySyncConfig,
    useUpdatePlatformSettings,
    useUpdatePreferences,
    useUpdateProfile,
    useChangePassword,
} from "@/hooks/useSettingsData";
import { useEmailInventoryAlerts } from "@/hooks/useInventoryData";
import { MarketplaceConnectionsPanel } from "@/components/settings/MarketplaceConnectionsPanel";

// ── Shared primitives ──────────────────────────────────────────────────────────
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <label style={{ display: "block", fontSize: 11, color: DS.mid, marginBottom: 6, fontWeight: 500, letterSpacing: "0.04em" }}>{label}</label>
            {children}
            {hint && <p style={{ margin: "5px 0 0", fontSize: 10, color: DS.lo }}>{hint}</p>}
        </div>
    );
}

function Input({ value, onChange, type = "text", placeholder = "", disabled = false }: {
    value: string; onChange?: (v: string) => void; type?: string; placeholder?: string; disabled?: boolean;
}) {
    const [focused, setFocused] = useState(false);
    return (
        <input
            type={type} value={value} placeholder={placeholder} disabled={disabled}
            onChange={e => onChange?.(e.target.value)}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            style={{
                width: "100%", padding: "9px 13px", borderRadius: 9, boxSizing: "border-box",
                background: disabled ? DS.surface : DS.panel,
                border: `1px solid ${focused && !disabled ? DS.borderHi : DS.border}`,
                boxShadow: focused && !disabled ? `0 0 0 3px rgba(56,189,248,0.1)` : "none",
                color: disabled ? DS.lo : DS.hi,
                fontSize: 13, fontFamily: "inherit", outline: "none",
                cursor: disabled ? "not-allowed" : "text",
                transition: "border-color 0.15s, box-shadow 0.15s",
            }}
        />
    );
}

function Select({ value, onChange, options, disabled = false }: {
    value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; disabled?: boolean;
}) {
    const [focused, setFocused] = useState(false);
    return (
        <div style={{ position: "relative" }}>
            <select
                value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
                onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                style={{
                    width: "100%", padding: "9px 36px 9px 13px", borderRadius: 9,
                    background: disabled ? DS.surface : DS.panel,
                    border: `1px solid ${focused && !disabled ? DS.borderHi : DS.border}`,
                    boxShadow: focused && !disabled ? `0 0 0 3px rgba(56,189,248,0.1)` : "none",
                    color: disabled ? DS.lo : DS.hi, fontSize: 13, fontFamily: "inherit", outline: "none",
                    appearance: "none", cursor: disabled ? "not-allowed" : "pointer", boxSizing: "border-box",
                    transition: "border-color 0.15s, box-shadow 0.15s",
                }}
            >
                {options.map(o => <option key={o.value} value={o.value} style={{ background: DS.surface }}>{o.label}</option>)}
            </select>
            <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: DS.lo, pointerEvents: "none" }}>▾</span>
        </div>
    );
}

function Toggle({ value, onChange, label, desc }: { value: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
    const [hover, setHover] = useState(false);
    return (
        <button
            type="button"
            onClick={() => onChange(!value)}
            onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
            aria-pressed={value}
            style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "12px 16px", borderRadius: 10, width: "100%", textAlign: "left",
                background: hover ? DS.panelHi : DS.panel,
                border: `1px solid ${value ? DS.sky + "44" : DS.border}`,
                cursor: "pointer", transition: "border-color 0.2s, background 0.2s", gap: 16,
                fontFamily: "inherit",
            }}
        >
            <div>
                <p style={{ margin: 0, fontSize: 13, color: DS.hi }}>{label}</p>
                {desc && <p style={{ margin: "2px 0 0", fontSize: 10, color: DS.lo }}>{desc}</p>}
            </div>
            <div style={{
                width: 40, height: 22, borderRadius: 11, flexShrink: 0,
                background: value ? DS.sky : "rgba(255,255,255,0.08)",
                position: "relative", transition: "background 0.2s",
            }}>
                <span style={{
                    position: "absolute", top: 3, left: value ? 21 : 3,
                    width: 16, height: 16, borderRadius: "50%", background: "#fff",
                    transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                }} />
            </div>
        </button>
    );
}

function SaveRow({ saved, dirty, pending, error, onClick }: {
    saved?: boolean; dirty?: boolean; pending?: boolean; error?: string; onClick: () => void;
}) {
    const disabled = pending || dirty === false;
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "flex-end", paddingTop: 4, flexWrap: "wrap" }}>
            {error && <span style={{ fontSize: 11, color: DS.rose, marginRight: "auto" }}>{error}</span>}
            {!error && dirty && <span style={{ fontSize: 11, color: DS.amber, marginRight: "auto" }}>Unsaved changes</span>}
            {saved && <span style={{ fontSize: 11, color: DS.emerald, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 14 }}>✓</span> Saved
            </span>}
            <button onClick={onClick} disabled={disabled} style={{
                padding: "9px 22px", borderRadius: 9, border: "none",
                cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit",
                background: disabled ? "rgba(255,255,255,0.06)" : `linear-gradient(135deg, ${DS.sky}, ${DS.violet})`,
                color: disabled ? DS.lo : "#fff",
                fontSize: 13, fontWeight: 600, transition: "opacity 0.15s",
            }}>
                {pending ? "Saving…" : "Save changes"}
            </button>
        </div>
    );
}

function PanelHeader({ title, desc }: { title: string; desc: string }) {
    return (
        <>
            <div>
                <p style={{ margin: "0 0 2px", fontSize: 15, fontWeight: 600, color: DS.hi }}>{title}</p>
                <p style={{ margin: 0, fontSize: 12, color: DS.lo }}>{desc}</p>
            </div>
            <hr style={{ border: "none", borderTop: `1px solid ${DS.border}`, margin: 0 }} />
        </>
    );
}

// ── Tab definitions ────────────────────────────────────────────────────────────
const TABS = [
    { id: "profile",    label: "Profile",     icon: "◆", group: "Account" },
    { id: "password",   label: "Password",    icon: "🔑", group: "Account" },
    { id: "appearance", label: "Appearance",  icon: "◉", group: "Preferences" },
    { id: "alerts",     label: "Alerts",      icon: "🔔", group: "Preferences" },
    { id: "company",    label: "Company",     icon: "▣", group: "Administration" },
    { id: "sync",       label: "Sync Config", icon: "⚙", group: "Administration" },
    { id: "marketplace",label: "Marketplace", icon: "🛒", group: "Administration" },
    { id: "platform",   label: "Platform",    icon: "★", group: "Administration" },
    { id: "danger",     label: "Danger Zone", icon: "⚠", group: "Danger Zone" },
] as const;
type TabId = typeof TABS[number]["id"];
const GROUP_ORDER = ["Account", "Preferences", "Administration", "Danger Zone"] as const;

// ── Page ───────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
    const { session, setToken } = useStore();
    const [tab, setTab] = useState<TabId>("profile");
    const canManageCompany = session?.role === "admin" || session?.role === "super_admin";
    const canManagePlatform = session?.role === "super_admin";
    const visibleTabs = TABS.filter((t) =>
        (t.id !== "company" && t.id !== "sync" && t.id !== "marketplace" && t.id !== "platform")
        || ((t.id === "company" || t.id === "sync" || t.id === "marketplace") && canManageCompany)
        || (t.id === "platform" && canManagePlatform)
    );

    // API hooks
    const updateProfile    = useUpdateProfile();
    const changePassword   = useChangePassword();
    const updatePrefs      = useUpdatePreferences();
    const signOutAll       = useSignOutAllSessions();
    const { data: savedPrefs } = useGetPreferences();
    const companyQ = useCompanySettings(session?.tenantId);
    const syncQ = useCompanySyncConfig(session?.tenantId);
    const platformQ = usePlatformSettings(canManagePlatform);
    const updateCompany = useUpdateCompanySettings(session?.tenantId);
    const updateSyncConfig = useUpdateCompanySyncConfig(session?.tenantId);
    const updatePlatform = useUpdatePlatformSettings();
    const emailInventoryAlerts = useEmailInventoryAlerts();

    // Profile
    const [name,  setName]  = useState(session?.name  || "");
    const [email, setEmail] = useState((session as any)?.email || "user@jtl.com");
    const [profileSaved, setProfileSaved] = useState(false);
    const [profileErr,   setProfileErr]   = useState("");

    // Password
    const [curPwd,  setCurPwd]  = useState("");
    const [newPwd,  setNewPwd]  = useState("");
    const [confPwd, setConfPwd] = useState("");
    const [pwdErr,  setPwdErr]  = useState("");
    const [pwdSaved, setPwdSaved] = useState(false);

    // Appearance
    const [defaultRange, setDefaultRange] = useState("30d");
    const [currency,     setCurrency]     = useState("EUR");
    const [timezone,     setTimezone]     = useState("Europe/Berlin");
    const [appSaved,     setAppSaved]     = useState(false);
    const [appErr,       setAppErr]       = useState("");

    // Alerts
    const [threshold,    setThreshold]    = useState(30);
    const [emailAlerts,  setEmailAlerts]  = useState(true);
    const [criticalOnly, setCriticalOnly] = useState(false);
    const [alertSaved,   setAlertSaved]   = useState(false);
    const [alertErr,     setAlertErr]     = useState("");
    const [alertEmailMsg, setAlertEmailMsg] = useState("");

    // Company settings
    const [companyName, setCompanyName] = useState("");
    const [companyTimezone, setCompanyTimezone] = useState("Europe/Berlin");
    const [companyCurrency, setCompanyCurrency] = useState("EUR");
    const [companyVatRate, setCompanyVatRate] = useState("0.19");
    const [freshnessThreshold, setFreshnessThreshold] = useState("60");
    const [companyDefaultRange, setCompanyDefaultRange] = useState("30D");
    const [alertRecipients, setAlertRecipients] = useState("");
    const [companySaved, setCompanySaved] = useState(false);
    const [companyErr, setCompanyErr] = useState("");

    // Sync settings
    const [syncSchedule, setSyncSchedule] = useState("manual");
    const [syncModules, setSyncModules] = useState<Record<string, boolean>>({ orders: true, products: true, customers: true, inventory: true });
    const [syncSaved, setSyncSaved] = useState(false);
    const [syncErr, setSyncErr] = useState("");

    // Platform settings
    const [maintenanceMode, setMaintenanceMode] = useState(false);
    const [auditRetentionDays, setAuditRetentionDays] = useState("365");
    const [syncFreshnessDefault, setSyncFreshnessDefault] = useState("60");
    const [marketingFlag, setMarketingFlag] = useState(false);
    const [salesExportFlag, setSalesExportFlag] = useState(false);
    const [platformSaved, setPlatformSaved] = useState(false);
    const [platformErr, setPlatformErr] = useState("");

    // useGetPreferences has placeholderData: {}, so the first render always sees
    // the fallbacks. Without this the user's saved values never reach the form.
    useEffect(() => {
        if (!savedPrefs || Object.keys(savedPrefs).length === 0) return;
        setDefaultRange(savedPrefs.default_range ?? "30d");
        setCurrency(savedPrefs.currency ?? "EUR");
        setTimezone(savedPrefs.timezone ?? "Europe/Berlin");
        setThreshold(savedPrefs.alert_threshold ?? 30);
        setEmailAlerts(savedPrefs.email_alerts ?? true);
        setCriticalOnly(savedPrefs.critical_only ?? false);
    }, [savedPrefs]);

    useEffect(() => {
        if (!companyQ.data) return;
        setCompanyName(companyQ.data.name ?? "");
        setCompanyTimezone(companyQ.data.timezone ?? "Europe/Berlin");
        setCompanyCurrency(companyQ.data.currency ?? "EUR");
        setCompanyVatRate(String(companyQ.data.vat_rate ?? 0.19));
        setFreshnessThreshold(String(companyQ.data.data_freshness_threshold_minutes ?? 60));
        setCompanyDefaultRange(companyQ.data.default_dashboard_range ?? "30D");
        setAlertRecipients((companyQ.data.alert_recipients ?? []).join(", "));
    }, [companyQ.data]);

    useEffect(() => {
        const config = syncQ.data?.sync_config;
        if (!config) return;
        setSyncSchedule(config.sync_schedule ?? "manual");
        setSyncModules({ orders: true, products: true, customers: true, inventory: true, ...(config.modules ?? {}) });
    }, [syncQ.data]);

    useEffect(() => {
        if (!platformQ.data) return;
        setMaintenanceMode(Boolean(platformQ.data.maintenance_mode));
        setAuditRetentionDays(String(platformQ.data.audit_retention_days ?? 365));
        setSyncFreshnessDefault(String(platformQ.data.sync_freshness_default_minutes ?? 60));
        setMarketingFlag(Boolean(platformQ.data.feature_flags?.marketing));
        setSalesExportFlag(Boolean(platformQ.data.feature_flags?.sales_export));
    }, [platformQ.data]);

    const flash = (set: (v: boolean) => void) => { set(true); setTimeout(() => set(false), 2500); };
    const msgOf = (e: any, fallback: string) =>
        e?.response?.data?.data?.message || e?.response?.data?.message || fallback;

    const saveProfile = async () => {
        setProfileErr("");
        try {
            await updateProfile.mutateAsync({ full_name: name, email });
            flash(setProfileSaved);
        } catch (e: any) {
            setProfileErr(msgOf(e, "Failed to save profile."));
        }
    };

    const savePwd = async () => {
        if (newPwd.length < 8) { setPwdErr("Minimum 8 characters."); return; }
        if (newPwd !== confPwd) { setPwdErr("Passwords do not match."); return; }
        setPwdErr("");
        try {
            const resp = await changePassword.mutateAsync({ currentPassword: curPwd, newPassword: newPwd });
            const accessToken = resp?.data?.accessToken ?? resp?.accessToken;
            if (accessToken) setToken(accessToken);
            setCurPwd(""); setNewPwd(""); setConfPwd("");
            flash(setPwdSaved);
        } catch (e: any) {
            setPwdErr(msgOf(e, "Failed to change password."));
        }
    };

    const saveAppearance = async () => {
        setAppErr("");
        try {
            await updatePrefs.mutateAsync({ default_range: defaultRange, currency, timezone });
            flash(setAppSaved);
        } catch (e: any) {
            setAppErr(msgOf(e, "Failed to save preferences."));
        }
    };

    const saveAlerts = async () => {
        setAlertErr("");
        try {
            await updatePrefs.mutateAsync({ alert_threshold: threshold, email_alerts: emailAlerts, critical_only: criticalOnly });
            flash(setAlertSaved);
        } catch (e: any) {
            setAlertErr(msgOf(e, "Failed to save alert settings."));
        }
    };

    const sendInventoryAlertEmail = async () => {
        setAlertEmailMsg("");
        try {
            const result = await emailInventoryAlerts.mutateAsync();
            if (result.skipped) {
                const reason = result.reason === "no_alert_recipients"
                    ? "No company alert recipients configured."
                    : result.reason === "no_alerts"
                        ? "No active inventory alerts to email."
                        : result.reason === "mail_disabled"
                            ? "Email is not enabled on the backend."
                            : "Email was skipped.";
                setAlertEmailMsg(reason);
                return;
            }
            setAlertEmailMsg(`Sent ${result.alerts ?? 0} alerts to ${result.recipients ?? 0} recipient(s).`);
        } catch (e: any) {
            setAlertEmailMsg(msgOf(e, "Failed to send alert email."));
        }
    };

    const saveCompany = async () => {
        setCompanyErr("");
        try {
            await updateCompany.mutateAsync({
                name: companyName,
                timezone: companyTimezone,
                currency: companyCurrency,
                vat_rate: Number(companyVatRate),
                data_freshness_threshold_minutes: Number(freshnessThreshold),
                default_dashboard_range: companyDefaultRange,
                alert_recipients: alertRecipients.split(",").map((v) => v.trim()).filter(Boolean),
            } as any);
            flash(setCompanySaved);
        } catch (e: any) {
            setCompanyErr(msgOf(e, "Failed to save company settings."));
        }
    };

    const saveSync = async () => {
        setSyncErr("");
        try {
            await updateSyncConfig.mutateAsync({
                sync_schedule: syncSchedule,
                modules: syncModules,
            });
            flash(setSyncSaved);
        } catch (e: any) {
            setSyncErr(msgOf(e, "Failed to save sync configuration."));
        }
    };

    const savePlatform = async () => {
        setPlatformErr("");
        try {
            await updatePlatform.mutateAsync({
                maintenance_mode: maintenanceMode,
                audit_retention_days: Number(auditRetentionDays),
                sync_freshness_default_minutes: Number(syncFreshnessDefault),
                feature_flags: {
                    marketing: marketingFlag,
                    sales_export: salesExportFlag,
                },
            } as any);
            flash(setPlatformSaved);
        } catch (e: any) {
            setPlatformErr(msgOf(e, "Failed to save platform settings."));
        }
    };

    const handleSignOutAll = async () => {
        if (!window.confirm("Sign out all sessions on every device? You will need to log in again.")) return;
        await signOutAll.mutateAsync();
        window.location.href = "/";
    };

    const handleResetPreferences = async () => {
        if (!window.confirm("Reset all personal preferences to defaults?")) return;
        await updatePrefs.mutateAsync({
            default_range: "30d",
            currency: "EUR",
            timezone: "Europe/Berlin",
            alert_threshold: 30,
            email_alerts: true,
            critical_only: false,
        });
    };

    // Dirty tracking — compares live form state against what the server returned.
    const appDirty = Boolean(savedPrefs) && (
        defaultRange !== (savedPrefs?.default_range ?? "30d")
        || currency !== (savedPrefs?.currency ?? "EUR")
        || timezone !== (savedPrefs?.timezone ?? "Europe/Berlin"));
    const alertsDirty = Boolean(savedPrefs) && (
        threshold !== (savedPrefs?.alert_threshold ?? 30)
        || emailAlerts !== (savedPrefs?.email_alerts ?? true)
        || criticalOnly !== (savedPrefs?.critical_only ?? false));
    const profileDirty = name !== (session?.name ?? "") || email !== ((session as any)?.email ?? "user@jtl.com");

    const activeTab = visibleTabs.find(t => t.id === tab) ?? visibleTabs[0];
    const groups = GROUP_ORDER
        .map(group => ({ group, items: visibleTabs.filter(t => t.group === group) }))
        .filter(g => g.items.length > 0);

    const navButton = (t: typeof TABS[number]) => {
        const active = tab === t.id;
        const isDanger = t.id === "danger";
        const color = isDanger ? DS.rose : DS.sky;
        return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                padding: "9px 12px", borderRadius: 9, border: "none", textAlign: "left",
                background: active ? `${color}1a` : "transparent",
                color: active ? color : DS.mid,
                boxShadow: active ? `inset 3px 0 0 ${color}` : "none",
                fontSize: 12.5, fontWeight: active ? 600 : 400,
                cursor: "pointer", fontFamily: "inherit", transition: "background 0.15s",
            }}>
                <span style={{ fontSize: 12, width: 16, textAlign: "center", opacity: active ? 1 : 0.65 }}>{t.icon}</span>
                {t.label}
            </button>
        );
    };

    return (
        <div style={{ maxWidth: 1080, margin: "0 auto" }}>

            {/* Page header */}
            <div style={{ marginBottom: 24 }}>
                <h1 style={{ margin: "0 0 4px", fontFamily: DS.display, fontSize: 26, color: DS.hi, fontWeight: 400 }}>Settings</h1>
                <p style={{ margin: 0, fontSize: 12, color: DS.lo }}>Manage your profile, preferences and notification rules.</p>
            </div>

            <div className="settings-shell" style={{ display: "flex", gap: 22, alignItems: "flex-start" }}>

                {/* Vertical grouped nav */}
                <nav className="settings-nav" style={{
                    width: 208, flexShrink: 0, position: "sticky", top: 20,
                    background: DS.surface, border: `1px solid ${DS.border}`,
                    borderRadius: 14, padding: 10,
                }}>
                    {groups.map(({ group, items }) => (
                        <div key={group} style={{ marginBottom: 10 }}>
                            <p style={{
                                margin: "6px 0 6px 12px", fontSize: 9, color: DS.lo,
                                letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 600,
                            }}>{group}</p>
                            {items.map(navButton)}
                        </div>
                    ))}
                </nav>

                {/* Panel */}
                <div style={{
                    flex: 1, minWidth: 0,
                    background: DS.surface, border: `1px solid ${DS.border}`,
                    borderRadius: 14, padding: "28px 32px",
                }}>

                {/* ── Profile ── */}
                {tab === "profile" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                        <PanelHeader title="Profile" desc="Your display name and email shown across the dashboard." />

                        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                            <div style={{
                                width: 56, height: 56, borderRadius: 14, flexShrink: 0,
                                background: `linear-gradient(135deg, ${DS.sky}, ${DS.violet})`,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 22, fontWeight: 700, color: "#fff",
                            }}>
                                {(name || session?.name || "?")[0].toUpperCase()}
                            </div>
                            <div>
                                <p style={{ margin: "0 0 2px", fontSize: 13, color: DS.hi, fontWeight: 600 }}>{name || session?.name}</p>
                                <p style={{ margin: 0, fontSize: 11, color: DS.lo }}>{email}</p>
                            </div>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
                            <Field label="Full Name">
                                <Input value={name} onChange={setName} placeholder="Your full name" />
                            </Field>
                            <Field label="Email Address">
                                <Input value={email} onChange={setEmail} type="email" placeholder="you@company.com" />
                            </Field>
                        </div>
                        <Field label="Role" hint="Role is assigned by your admin and cannot be changed here.">
                            <Input value={`${session?.role || "viewer"}`} disabled />
                        </Field>
                        <SaveRow saved={profileSaved} dirty={profileDirty} error={profileErr}
                            pending={updateProfile.isPending} onClick={saveProfile} />
                    </div>
                )}

                {/* ── Password ── */}
                {tab === "password" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                        <PanelHeader title="Change Password" desc="Use at least 8 characters with numbers and symbols." />
                        <Field label="Current Password">
                            <Input value={curPwd} onChange={setCurPwd} type="password" placeholder="••••••••" />
                        </Field>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
                            <Field label="New Password">
                                <Input value={newPwd} onChange={setNewPwd} type="password" placeholder="••••••••" />
                            </Field>
                            <Field label="Confirm New Password">
                                <Input value={confPwd} onChange={setConfPwd} type="password" placeholder="••••••••" />
                            </Field>
                        </div>

                        {newPwd.length > 0 && (() => {
                            const s = newPwd.length >= 12 && /[^a-zA-Z0-9]/.test(newPwd) ? 3
                                    : newPwd.length >= 8 ? 2 : 1;
                            const labels = ["", "Weak", "Fair", "Strong"];
                            const colors = ["", DS.rose, DS.amber, DS.emerald];
                            return (
                                <div>
                                    <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                                        {[1,2,3].map(i => (
                                            <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= s ? colors[s] : DS.border, transition: "background 0.2s" }} />
                                        ))}
                                    </div>
                                    <span style={{ fontSize: 10, color: colors[s] }}>{labels[s]}</span>
                                </div>
                            );
                        })()}

                        <SaveRow saved={pwdSaved} error={pwdErr} pending={changePassword.isPending}
                            dirty={Boolean(curPwd || newPwd || confPwd)} onClick={() => savePwd()} />
                    </div>
                )}

                {/* ── Appearance ── */}
                {tab === "appearance" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                        <PanelHeader title="Appearance & Defaults" desc="Control how data is displayed by default across all views." />
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
                            <Field label="Default Date Range">
                                <Select value={defaultRange} onChange={setDefaultRange} options={[
                                    { value: "7d",  label: "Last 7 Days" },
                                    { value: "30d", label: "Last 30 Days" },
                                    { value: "3m",  label: "Last 3 Months" },
                                    { value: "6m",  label: "Last 6 Months" },
                                    { value: "12m", label: "Last 12 Months" },
                                    { value: "ytd", label: "Year to Date" },
                                ]} />
                            </Field>
                            <Field label="Currency Display">
                                <Select value={currency} onChange={setCurrency} options={[
                                    { value: "EUR", label: "€  Euro (EUR)" },
                                    { value: "USD", label: "$  US Dollar (USD)" },
                                    { value: "GBP", label: "£  British Pound (GBP)" },
                                    { value: "CHF", label: "₣  Swiss Franc (CHF)" },
                                ]} />
                            </Field>
                        </div>
                        <Field label="Timezone">
                            <Select value={timezone} onChange={setTimezone} options={[
                                { value: "Europe/Berlin",    label: "Europe / Berlin (CET)" },
                                { value: "Europe/London",    label: "Europe / London (GMT)" },
                                { value: "America/New_York", label: "America / New York (EST)" },
                                { value: "America/Chicago",  label: "America / Chicago (CST)" },
                                { value: "Asia/Dubai",       label: "Asia / Dubai (GST)" },
                                { value: "Asia/Kolkata",     label: "Asia / Kolkata (IST)" },
                            ]} />
                        </Field>
                        <SaveRow saved={appSaved} dirty={appDirty} error={appErr}
                            pending={updatePrefs.isPending} onClick={saveAppearance} />
                    </div>
                )}

                {/* ── Alerts ── */}
                {tab === "alerts" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                        <PanelHeader title="Alert Thresholds" desc="Configure when the topbar alert bell fires and how you get notified." />

                        <Field label="Trigger alert when a metric changes beyond">
                            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 4 }}>
                                <input
                                    type="range" min={5} max={100} step={5}
                                    value={threshold} onChange={e => setThreshold(+e.target.value)}
                                    style={{ flex: 1, accentColor: DS.sky, height: 4 }}
                                />
                                <div style={{
                                    minWidth: 64, padding: "7px 12px", borderRadius: 9,
                                    background: DS.panel, border: `1px solid ${DS.sky}55`,
                                    fontSize: 15, color: DS.sky, fontWeight: 700, textAlign: "center",
                                }}>
                                    ±{threshold}%
                                </div>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                                <span style={{ fontSize: 10, color: DS.lo }}>5%</span>
                                <span style={{ fontSize: 10, color: DS.lo }}>100%</span>
                            </div>
                        </Field>

                        <Toggle
                            value={emailAlerts} onChange={setEmailAlerts}
                            label="Email alerts"
                            desc="Send a notification email when a threshold is crossed"
                        />
                        <Toggle
                            value={criticalOnly} onChange={setCriticalOnly}
                            label="Critical alerts only"
                            desc="Suppress warnings — only fire for critical severity events"
                        />
                        <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${DS.border}`, background: DS.panel }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                                <div>
                                    <p style={{ margin: "0 0 3px", color: DS.hi, fontSize: 13, fontWeight: 700 }}>Send inventory alert email now</p>
                                    <p style={{ margin: 0, color: DS.lo, fontSize: 11 }}>Uses Company → Alert Recipients and current low/out-of-stock alerts.</p>
                                </div>
                                <button
                                    onClick={sendInventoryAlertEmail}
                                    disabled={emailInventoryAlerts.isPending}
                                    style={{
                                        border: "1px solid rgba(56,189,248,0.3)",
                                        background: "rgba(56,189,248,0.12)",
                                        color: DS.sky, borderRadius: 10, padding: "8px 12px",
                                        cursor: emailInventoryAlerts.isPending ? "not-allowed" : "pointer",
                                        opacity: emailInventoryAlerts.isPending ? 0.65 : 1,
                                        fontSize: 12, fontWeight: 700, fontFamily: "inherit", whiteSpace: "nowrap",
                                    }}
                                >
                                    {emailInventoryAlerts.isPending ? "Sending…" : "Send test email"}
                                </button>
                            </div>
                            {alertEmailMsg && <p style={{ margin: "10px 0 0", fontSize: 11, color: alertEmailMsg.startsWith("Sent") ? DS.emerald : DS.amber }}>{alertEmailMsg}</p>}
                        </div>
                        <SaveRow saved={alertSaved} dirty={alertsDirty} error={alertErr}
                            pending={updatePrefs.isPending} onClick={saveAlerts} />
                    </div>
                )}

                {/* ── Company ── */}
                {tab === "company" && canManageCompany && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                        <PanelHeader title="Company Settings" desc="Company profile, dashboard defaults, freshness and alert routing." />
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
                            <Field label="Company Name"><Input value={companyName} onChange={setCompanyName} /></Field>
                            <Field label="Currency"><Input value={companyCurrency} onChange={setCompanyCurrency} /></Field>
                            <Field label="Timezone"><Input value={companyTimezone} onChange={setCompanyTimezone} /></Field>
                            <Field label="VAT Rate"><Input value={companyVatRate} onChange={setCompanyVatRate} /></Field>
                            <Field label="Freshness Threshold Minutes"><Input value={freshnessThreshold} onChange={setFreshnessThreshold} /></Field>
                            <Field label="Default Dashboard Range"><Input value={companyDefaultRange} onChange={setCompanyDefaultRange} /></Field>
                        </div>
                        <Field label="Alert Recipients" hint="Comma-separated email list for future alert delivery.">
                            <Input value={alertRecipients} onChange={setAlertRecipients} placeholder="ops@company.com, admin@company.com" />
                        </Field>
                        <SaveRow saved={companySaved} error={companyErr}
                            pending={updateCompany.isPending} onClick={saveCompany} />
                    </div>
                )}

                {/* ── Sync Config ── */}
                {tab === "sync" && canManageCompany && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                        <PanelHeader title="Company Sync Configuration" desc="Sync schedule, enabled modules, key prefix and engine installation status." />
                        <Field label="Sync Schedule">
                            <Select value={syncSchedule} onChange={setSyncSchedule} options={[
                                { value: "manual", label: "Manual only" },
                                { value: "every_15m", label: "Every 15 minutes" },
                                { value: "hourly", label: "Hourly" },
                                { value: "nightly", label: "Nightly" },
                            ]} />
                        </Field>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 10 }}>
                            {["orders", "products", "customers", "inventory"].map((module) => (
                                <Toggle
                                    key={module}
                                    value={Boolean(syncModules[module])}
                                    onChange={(value) => setSyncModules((current) => ({ ...current, [module]: value }))}
                                    label={`${module[0].toUpperCase()}${module.slice(1)} sync`}
                                    desc={syncModules[module] ? "Enabled" : "Disabled"}
                                />
                            ))}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
                            <div style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${DS.border}`, background: DS.panel }}>
                                <div style={{ fontSize: 10, color: DS.lo, textTransform: "uppercase", marginBottom: 5 }}>Sync key prefix</div>
                                <div style={{ fontSize: 13, color: DS.amber, fontFamily: DS.mono }}>{syncQ.data?.sync_key_prefix ? `${syncQ.data.sync_key_prefix}…` : "—"}</div>
                            </div>
                            <div style={{ padding: "12px 14px", borderRadius: 10, border: `1px solid ${DS.border}`, background: DS.panel }}>
                                <div style={{ fontSize: 10, color: DS.lo, textTransform: "uppercase", marginBottom: 5 }}>Engine installations</div>
                                <div style={{ fontSize: 13, color: DS.hi }}>{syncQ.data?.engine_installations?.length ?? 0}</div>
                            </div>
                        </div>
                        <SaveRow saved={syncSaved} error={syncErr}
                            pending={updateSyncConfig.isPending} onClick={saveSync} />
                    </div>
                )}

                {/* ── Marketplace connections ── */}
                {tab === "marketplace" && canManageCompany && <MarketplaceConnectionsPanel />}

                {/* ── Platform ── */}
                {tab === "platform" && canManagePlatform && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                        <PanelHeader title="Platform Settings" desc="Global feature flags, retention, freshness defaults and maintenance controls." />
                        <Toggle value={maintenanceMode} onChange={setMaintenanceMode} label="Maintenance mode" desc="Marks platform health as maintenance." />
                        <Toggle value={marketingFlag} onChange={setMarketingFlag} label="Marketing feature flag" desc="Keeps marketing hidden until production-ready." />
                        <Toggle value={salesExportFlag} onChange={setSalesExportFlag} label="Sales export feature flag" desc="Controls planned sales export rollout." />
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
                            <Field label="Audit Retention Days"><Input value={auditRetentionDays} onChange={setAuditRetentionDays} /></Field>
                            <Field label="Default Freshness Minutes"><Input value={syncFreshnessDefault} onChange={setSyncFreshnessDefault} /></Field>
                        </div>
                        <SaveRow saved={platformSaved} error={platformErr}
                            pending={updatePlatform.isPending} onClick={savePlatform} />
                    </div>
                )}

                {/* ── Danger Zone ── */}
                {tab === "danger" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                        <div>
                            <p style={{ margin: "0 0 2px", fontSize: 15, fontWeight: 600, color: DS.rose }}>Danger Zone</p>
                            <p style={{ margin: 0, fontSize: 12, color: DS.lo }}>These actions are permanent and cannot be undone.</p>
                        </div>
                        <hr style={{ border: "none", borderTop: `1px solid ${DS.rose}33`, margin: 0 }} />

                        {[
                            { label: "Sign out all sessions",  desc: "Revoke all active sessions on every device.",          btn: "Sign out all",   color: DS.amber, onClick: handleSignOutAll },
                            { label: "Reset all preferences",  desc: "Restore default appearance and notification settings.", btn: "Reset defaults", color: DS.amber, onClick: handleResetPreferences },
                        ].map(item => (
                            <div key={item.label} style={{
                                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
                                padding: "16px 18px", borderRadius: 10, flexWrap: "wrap",
                                border: `1px solid ${item.color}33`, background: `${item.color}08`,
                            }}>
                                <div>
                                    <p style={{ margin: "0 0 3px", fontSize: 13, fontWeight: 600, color: DS.hi }}>{item.label}</p>
                                    <p style={{ margin: 0, fontSize: 11, color: DS.lo }}>{item.desc}</p>
                                </div>
                                <button onClick={item.onClick} style={{
                                    flexShrink: 0, padding: "7px 16px", borderRadius: 8,
                                    border: `1px solid ${item.color}55`, background: "transparent",
                                    color: item.color, fontSize: 12, fontWeight: 600,
                                    cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                                }}>
                                    {item.btn}
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                </div>
            </div>

            <style>{`
                @media (max-width: 900px) {
                    .settings-shell { flex-direction: column; }
                    .settings-nav {
                        width: 100% !important;
                        position: static !important;
                        display: flex; flex-wrap: wrap; gap: 4px;
                    }
                    .settings-nav > div { margin-bottom: 0 !important; display: flex; align-items: center; gap: 4px; }
                    .settings-nav p { display: none; }
                }
            `}</style>
        </div>
    );
}
