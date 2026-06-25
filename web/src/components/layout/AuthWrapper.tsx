"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { CompanySummary, useStore, ROLE_META } from "@/lib/store";
import { DS } from "@/lib/design-system";
import api from "@/lib/api";

type AuthState = "loading" | "authenticated" | "unauthenticated" | "unavailable";

const PWD_RULES = [
    { id: "len", label: "8+ characters", test: (p: string) => p.length >= 8 },
    { id: "up", label: "Uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
    { id: "lo", label: "Lowercase letter", test: (p: string) => /[a-z]/.test(p) },
    { id: "num", label: "Number", test: (p: string) => /[0-9]/.test(p) },
    { id: "spc", label: "Special char", test: (p: string) => /[!@#$%^&*]/.test(p) },
];

const Particles = () => {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const c = ref.current; if (!c) return;
        const ctx = c.getContext("2d");
        if (!ctx) return;

        const sz = () => { c.width = c.offsetWidth; c.height = c.offsetHeight; };
        sz(); window.addEventListener("resize", sz);
        const pts = Array.from({ length: 55 }, () => ({ x: Math.random() * c.width, y: Math.random() * c.height, vx: (Math.random() - .5) * .22, vy: (Math.random() - .5) * .22, r: Math.random() * 1.4 + .4 }));
        let af: number;
        const draw = () => {
            ctx.clearRect(0, 0, c.width, c.height);
            pts.forEach(p => {
                p.x += p.vx; p.y += p.vy;
                if (p.x < 0 || p.x > c.width) p.vx *= -1;
                if (p.y < 0 || p.y > c.height) p.vy *= -1;
                ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(96,165,250,0.4)"; ctx.fill();
            });
            for (let i = 0; i < pts.length; i++)for (let j = i + 1; j < pts.length; j++) {
                const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d = Math.sqrt(dx * dx + dy * dy);
                if (d < 90) {
                    ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y);
                    ctx.strokeStyle = `rgba(96,165,250,${.07 * (1 - d / 90)})`; ctx.lineWidth = .5; ctx.stroke();
                }
            }
            af = requestAnimationFrame(draw);
        };
        draw();
        return () => { cancelAnimationFrame(af); window.removeEventListener("resize", sz); };
    }, []);
    return <canvas ref={ref} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />;
};

const Field = ({ label, type = "text", value, onChange, placeholder, error, icon, right, autoComplete, onKeyDown }: any) => {
    const [focus, setFocus] = useState(false);
    return (
        <div style={{ marginBottom: 16 }}>
            {label && <label style={{ display: "block", fontSize: 10, color: DS.lo, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 7 }}>{label}</label>}
            <div style={{ position: "relative" }}>
                {icon && <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: focus ? DS.sky : DS.lo, transition: "color .2s", pointerEvents: "none" }}>{icon}</span>}
                <input type={type} value={value} onChange={e => onChange(e.target.value)}
                    placeholder={placeholder} autoComplete={autoComplete} onKeyDown={onKeyDown}
                    onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
                    style={{
                        width: "100%", boxSizing: "border-box", background: focus ? "rgba(96,165,250,0.04)" : "rgba(255,255,255,0.03)",
                        border: `1px solid ${error ? DS.rose + "60" : focus ? DS.border : DS.border}`, borderRadius: 10,
                        padding: `11px ${right ? "40px" : "14px"} 11px ${icon ? "38px" : "14px"}`,
                        color: DS.hi, fontSize: 13, fontFamily: "inherit", outline: "none", transition: "all .2s", caretColor: DS.sky
                    }} />
                {right && <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }}>{right}</span>}
            </div>
            {error && <p style={{ margin: "5px 0 0", fontSize: 10, color: DS.rose }}>{error}</p>}
        </div>
    );
};

const PwdStrength = ({ pwd }: { pwd: string }) => {
    if (!pwd) return null;
    const pass = PWD_RULES.filter(r => r.test(pwd));
    const pct = pass.length / PWD_RULES.length * 100;
    const col = pct < 40 ? DS.rose : pct < 80 ? DS.amber : DS.emerald;
    const lbl = pct < 40 ? "Weak" : pct < 80 ? "Fair" : pct === 100 ? "Strong" : "Good";
    return (
        <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 10, color: DS.lo, textTransform: "uppercase", letterSpacing: "0.06em" }}>Strength</span>
                <span style={{ fontSize: 10, color: col, fontFamily: "inherit" }}>{lbl}</span>
            </div>
            <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg,${col}88,${col})`, borderRadius: 2, transition: "width .4s,background .4s" }} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 8 }}>
                {PWD_RULES.map(r => (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 5, height: 5, borderRadius: "50%", background: r.test(pwd) ? DS.emerald : "rgba(255,255,255,0.1)", transition: "background .3s", flexShrink: 0 }} />
                        <span style={{ fontSize: 9, color: r.test(pwd) ? DS.hi : DS.lo }}>{r.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export function AuthWrapper({ children }: { children: React.ReactNode }) {
    const store = useStore();
    const router = useRouter();
    const pathname = usePathname();
    const [mounted, setMounted] = useState(false);
    const [authState, setAuthState] = useState<AuthState>("loading");
    const [email, setEmail] = useState("");
    const [pwd, setPwd] = useState("");
    const [show, setShow] = useState(false);
    const [err, setErr] = useState("");
    const [loading, setLoading] = useState(false);
    const [shake, setShake] = useState(false);
    const [companySelection, setCompanySelection] = useState<{
        selectionToken: string;
        companies: CompanySummary[];
    } | null>(null);

    // Force Change specific state
    const [pwdN, setPwdN] = useState("");
    const [confirm, setConfirm] = useState("");
    const [done, setDone] = useState(false);
    const loginPwdRef = useRef(""); // holds plain password for force-change flow

    useEffect(() => setMounted(true), []);

    useEffect(() => {
        if (!mounted) return;
        let cancelled = false;

        const applySessionView = () => {
            const s = useStore.getState().session;
            if (!s) return false;
            useStore.getState().setView(s.mustChange ? "force-change" : "dashboard");
            return true;
        };

        const bootstrap = async () => {
            useStore.getState().setAuthReady(false);
            const existing = useStore.getState().session;
            const hasPermissions = Array.isArray(existing?.permissions) && existing.permissions.length > 0;
            if (applySessionView() && hasPermissions) {
                useStore.getState().setAuthReady(true);
                if (!cancelled) setAuthState("authenticated");
                return;
            }

            try {
                const { data: resp } = await api.get("/auth/session");
                const payload = resp?.data ?? resp;
                if (payload?.authenticated && payload?.accessToken && payload?.user) {
                    useStore.getState().setToken(payload.accessToken);
                    useStore.getState().setSessionFromProfile(payload.user);
                    useStore.getState().setCompanies(payload.companies ?? [], payload.currentCompany ?? null);
                    useStore.getState().setView(payload.user?.mustChange ? "force-change" : "dashboard");
                    useStore.getState().setAuthReady(true);
                    if (!cancelled) setAuthState("authenticated");
                    return;
                }
            } catch (e: any) {
                const status = e?.response?.status;
                if (!status || status >= 500 || e?.code === "ECONNABORTED") {
                    useStore.getState().setAuthReady(false);
                    if (!cancelled) setAuthState("unavailable");
                    return;
                }
            }

            useStore.getState().logout();
            if (!cancelled) setAuthState("unauthenticated");
        };

        void bootstrap();
        return () => {
            cancelled = true;
        };
    }, [mounted]);

    const attempt = async (em = email, pw = pwd) => {
        if (!em || !pw) { setErr("Enter your email and password."); return; }
        setLoading(true); setErr("");
        try {
            const { data: resp } = await api.post('/auth/login', { email: em, password: pw });
            const payload = resp.data ?? resp;
            const { accessToken, user, companies = [], currentCompany = null, requiresCompanySelection, selectionToken } = payload;
            loginPwdRef.current = pw;
            if (requiresCompanySelection && selectionToken) {
                store.setToken(null);
                store.setCompanies(companies, null);
                setCompanySelection({ selectionToken, companies });
                setAuthState("unauthenticated");
                return;
            }
            if (!accessToken || !user) {
                throw new Error("Login response missing access token");
            }
            store.setToken(accessToken);
            store.setCompanies(companies, currentCompany);
            store.setView(user.mustChange ? "force-change" : "dashboard");
            store.setAuthReady(true);
            setAuthState("authenticated");
            if (!user.mustChange) router.push('/dashboard/overview');
        } catch (e: any) {
            const status = e.response?.status;
            const msg = e.response?.data?.data?.message
                || e.response?.data?.message
                || "Invalid credentials";
            if (status === 423) {
                setErr("Account locked — try again in 15 min");
            } else {
                setErr(msg);
            }
            setShake(true); setTimeout(() => setShake(false), 600);
        }
        setLoading(false);
    };

    const selectCompany = async (tenantId: string) => {
        if (!companySelection) return;
        setLoading(true); setErr("");
        try {
            const { data: resp } = await api.post('/auth/switch-company', {
                tenantId,
                selectionToken: companySelection.selectionToken,
            });
            const payload = resp.data ?? resp;
            store.setToken(payload.accessToken);
            store.setCompanies(companySelection.companies, payload.currentCompany ?? null);
            setCompanySelection(null);
            store.setView("dashboard");
            store.setAuthReady(true);
            setAuthState("authenticated");
            router.push('/dashboard/overview');
        } catch (e: any) {
            setErr(e.response?.data?.data?.message || e.response?.data?.message || "Company selection failed. Please sign in again.");
        } finally {
            setLoading(false);
        }
    };

    const submitForceChange = async () => {
        const allPass = PWD_RULES.every(r => r.test(pwdN));
        if (!allPass) { setErr("Password does not meet all requirements."); return; }
        if (pwdN !== confirm) { setErr("Passwords do not match."); return; }

        try {
            const { data: resp } = await api.patch('/auth/change-password', {
                currentPassword: loginPwdRef.current,
                newPassword: pwdN,
            });
            const accessToken = resp?.data?.accessToken ?? resp?.accessToken;
            if (!accessToken) throw new Error("Password changed, but no session token was returned.");
            store.setToken(accessToken);
            setDone(true);
            setTimeout(() => {
                store.setView("dashboard");
                router.push('/dashboard/overview');
            }, 1200);
        } catch (e: any) {
            setErr(e.response?.data?.data?.message || e.response?.data?.message || "Failed to change password");
        }
    };

    // Return a minimal shell during SSR / before hydration to avoid mismatch
    // from browser extensions or client-only state (Zustand, localStorage).
    if (!mounted || authState === "loading") {
        return <div style={{ minHeight: "100vh", background: "#04060f" }} />;
    }

    if (authState === "unavailable") {
        return (
            <div style={{ minHeight: "100vh", background: "#04060f", display: "flex", alignItems: "center", justifyContent: "center", color: DS.hi, fontFamily: "inherit" }}>
                <div style={{ maxWidth: 420, margin: 16, padding: 24, borderRadius: 16, border: `1px solid ${DS.border}`, background: "rgba(8,12,28,0.88)", textAlign: "center" }}>
                    <div style={{ fontSize: 28, marginBottom: 12 }}>🛰️</div>
                    <h2 style={{ margin: "0 0 8px", fontFamily: DS.display, fontWeight: 400 }}>Backend unavailable</h2>
                    <p style={{ margin: "0 0 16px", fontSize: 12, color: DS.lo }}>Your session was not cleared. Retry when the API/database is reachable.</p>
                    <button onClick={() => window.location.reload()} style={{ border: "none", borderRadius: 9, padding: "9px 16px", background: DS.sky, color: "#001018", fontWeight: 700, cursor: "pointer" }}>
                        Retry session check
                    </button>
                </div>
            </div>
        );
    }

    if (store.view === "dashboard" && store.session) {
        return <>{children}</>;
    }

    if (store.view === "force-change" && store.session) {
        return (
            <div key="force-change" style={{ minHeight: "100vh", background: "#04060f", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>
                <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}input::placeholder{color:rgba(61,79,107,.8);}`}</style>
                <div style={{ width: "100%", maxWidth: 420, margin: "0 16px", animation: "fadeUp .5s ease" }}>
                    <div style={{ textAlign: "center", marginBottom: 28 }}>
                        <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 52, height: 52, borderRadius: 14, background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)", marginBottom: 14 }}>
                            <span style={{ fontSize: 22 }}>🔑</span>
                        </div>
                        <h1 style={{ fontFamily: DS.display, fontWeight: 400, fontSize: 24, color: DS.hi, margin: "0 0 6px" }}>Set your password</h1>
                        <p style={{ margin: 0, fontSize: 12, color: DS.lo }}>Required before you can access the dashboard</p>
                    </div>

                    <div style={{ background: "rgba(8,12,28,0.88)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 20, padding: "28px 26px", backdropFilter: "blur(20px)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.2)", borderRadius: 9, padding: "10px 13px", marginBottom: 22 }}>
                            <span style={{ color: DS.amber, fontSize: 13 }}>⚠</span>
                            <span style={{ fontSize: 11, color: DS.amber }}>Admin requires you to set a new password on first login.</span>
                        </div>

                        <Field label="New password" type={show ? "text" : "password"} value={pwdN} onChange={setPwdN}
                            placeholder="••••••••••" icon="⚷"
                            right={<button onClick={() => setShow(!show)} style={{ background: "none", border: "none", cursor: "pointer", color: DS.lo, fontSize: 11, padding: 0 }}>{show ? "Hide" : "Show"}</button>} />
                        <PwdStrength pwd={pwdN} />

                        <div style={{ marginTop: 16 }}>
                            <Field label="Confirm password" type="password" value={confirm} onChange={setConfirm}
                                placeholder="••••••••••" icon="⚷" onKeyDown={(e: any) => e.key === "Enter" && submitForceChange()} />
                        </div>

                        {err && <div style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.22)", borderRadius: 9, padding: "10px 13px", marginBottom: 14, fontSize: 12, color: DS.rose }}>{err}</div>}

                        <button onClick={submitForceChange} disabled={done}
                            style={{
                                width: "100%", padding: "12px", borderRadius: 11, cursor: done ? "default" : "pointer",
                                background: done ? "rgba(52,211,153,0.15)" : "linear-gradient(135deg,#d97706,#b45309)",
                                border: `1px solid ${done ? "rgba(52,211,153,0.3)" : "rgba(251,191,36,0.4)"}`,
                                color: done ? DS.emerald : DS.hi, fontSize: 13, fontFamily: "inherit", fontWeight: 600, transition: "all .3s"
                            }}>
                            {done ? "✓  Password saved — redirecting…" : "Set Password & Continue →"}
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    if (companySelection) {
        return (
            <div key="company-select" style={{ minHeight: "100vh", background: "#04060f", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit", position: "relative", overflow: "hidden" }}>
                <Particles />
                <div style={{ width: "100%", maxWidth: 520, margin: "0 16px", position: "relative", zIndex: 1 }}>
                    <div style={{ textAlign: "center", marginBottom: 26 }}>
                        <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 54, height: 54, borderRadius: 15, background: "linear-gradient(135deg,rgba(96,165,250,0.14),rgba(167,139,250,0.07))", border: "1px solid rgba(96,165,250,0.22)", marginBottom: 16 }}>
                            <span style={{ fontSize: 24, color: DS.sky }}>▣</span>
                        </div>
                        <h1 style={{ fontFamily: DS.display, fontWeight: 400, fontSize: 25, color: DS.hi, margin: "0 0 6px" }}>Choose company</h1>
                        <p style={{ margin: 0, fontSize: 12, color: DS.lo }}>Select the company dashboard you want to open.</p>
                    </div>
                    <div style={{ background: "rgba(8,12,28,0.88)", border: `1px solid ${DS.border}`, borderRadius: 20, padding: "22px", backdropFilter: "blur(24px)", boxShadow: "0 28px 90px rgba(0,0,0,0.55)" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {companySelection.companies.map((company) => (
                                <button
                                    key={company.tenantId}
                                    onClick={() => selectCompany(company.tenantId)}
                                    disabled={loading}
                                    style={{
                                        width: "100%",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 12,
                                        padding: "13px 14px",
                                        borderRadius: 12,
                                        border: `1px solid ${DS.border}`,
                                        background: "rgba(255,255,255,0.035)",
                                        color: DS.hi,
                                        cursor: loading ? "not-allowed" : "pointer",
                                        fontFamily: "inherit",
                                        textAlign: "left",
                                    }}
                                >
                                    <span>
                                        <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>{company.name}</span>
                                        <span style={{ display: "block", fontSize: 10, color: DS.lo, marginTop: 3 }}>{company.role}</span>
                                    </span>
                                    <span style={{ color: DS.sky, fontSize: 13 }}>Open →</span>
                                </button>
                            ))}
                        </div>
                        {err && <div style={{ marginTop: 14, fontSize: 12, color: DS.rose }}>{err}</div>}
                        <button onClick={() => { setCompanySelection(null); store.logout(); }} style={{ marginTop: 16, width: "100%", background: "transparent", border: "none", color: DS.lo, cursor: "pointer", fontSize: 11 }}>
                            Back to sign in
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div key="login" style={{ minHeight: "100vh", background: "#04060f", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit", position: "relative", overflow: "hidden" }}>
            <style>{`
            @keyframes fadeUp{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:translateY(0)}}
            @keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}
            @keyframes spin{to{transform:rotate(360deg)}}
            @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
            input::placeholder{color:rgba(61,79,107,.8);}
            *{box-sizing:border-box;}
        `}</style>
            <Particles />

            {/* Glow */}
            <div style={{ position: "absolute", top: "10%", left: "18%", width: 500, height: 500, borderRadius: "50%", background: "radial-gradient(ellipse,rgba(96,165,250,0.055) 0%,transparent 70%)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", bottom: "18%", right: "14%", width: 350, height: 350, borderRadius: "50%", background: "radial-gradient(ellipse,rgba(167,139,250,0.045) 0%,transparent 70%)", pointerEvents: "none" }} />

            <div style={{ width: "100%", maxWidth: 420, margin: "0 16px", position: "relative", zIndex: 1, animation: shake ? "shake .5s ease" : "fadeUp .55s ease" }}>

                {/* Brand header */}
                <div style={{ textAlign: "center", marginBottom: 30 }}>
                    <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 54, height: 54, borderRadius: 15, background: "linear-gradient(135deg,rgba(96,165,250,0.14),rgba(167,139,250,0.07))", border: "1px solid rgba(96,165,250,0.22)", marginBottom: 16 }}>
                        <span style={{ fontSize: 24, color: DS.sky }}>◈</span>
                    </div>
                    <h1 style={{ fontFamily: DS.display, fontWeight: 400, fontSize: 28, color: DS.hi, margin: "0 0 6px" }}>JTL Analytics</h1>
                    <p style={{ margin: 0, fontSize: 12, color: DS.lo, letterSpacing: "0.06em" }}>Enterprise Intelligence Platform</p>
                </div>

                {/* Card */}
                <div style={{ background: "rgba(8,12,28,0.85)", border: `1px solid ${DS.border}`, borderRadius: 20, padding: "30px 28px", backdropFilter: "blur(24px)", boxShadow: "0 28px 90px rgba(0,0,0,0.55),0 0 0 1px rgba(255,255,255,0.04) inset" }}>
                    <h2 style={{ fontFamily: DS.display, fontWeight: 400, fontSize: 19, color: DS.hi, margin: "0 0 24px" }}>Sign in to your account</h2>

                    <Field label="Email address" type="email" value={email} onChange={(v: any) => { setEmail(v); setErr(""); }}
                        placeholder="you@company.com" icon="✉" autoComplete="username" onKeyDown={(e: any) => e.key === "Enter" && attempt()} />

                    <Field label="Password" type={show ? "text" : "password"} value={pwd} onChange={(v: any) => { setPwd(v); setErr(""); }}
                        placeholder="••••••••••" icon="⚷" autoComplete="current-password" onKeyDown={(e: any) => e.key === "Enter" && attempt()}
                        right={<button onClick={() => setShow(!show)} style={{ background: "none", border: "none", cursor: "pointer", color: DS.lo, fontSize: 11, padding: 0 }}>{show ? "Hide" : "Show"}</button>} />

                    {err && (
                        <div style={{ display: "flex", gap: 8, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.22)", borderRadius: 9, padding: "10px 13px", marginBottom: 16 }}>
                            <span style={{ color: DS.rose, fontSize: 14, flexShrink: 0 }}>⚠</span>
                            <span style={{ fontSize: 12, color: DS.rose, lineHeight: 1.55 }}>{err}</span>
                        </div>
                    )}

                    {/* Sign In button */}
                    <button onClick={() => attempt()} disabled={loading} style={{
                        width: "100%", padding: "12px", borderRadius: 11, cursor: loading ? "not-allowed" : "pointer",
                        background: loading ? "rgba(96,165,250,0.12)" : "linear-gradient(135deg,#2563eb,#1d4ed8)",
                        border: `1px solid ${loading ? "rgba(96,165,250,0.18)" : "rgba(96,165,250,0.45)"}`,
                        color: loading ? DS.lo : DS.hi, fontSize: 13, fontFamily: "inherit", fontWeight: 600,
                        letterSpacing: "0.04em", transition: "all .2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        boxShadow: loading ? "none" : "0 4px 22px rgba(37,99,235,0.32)"
                    }}>
                        {loading ? <><span style={{ display: "inline-block", width: 13, height: 13, border: "2px solid rgba(96,165,250,0.3)", borderTopColor: DS.sky, borderRadius: "50%", animation: "spin .7s linear infinite" }} />Verifying…</> : "Sign In  →"}
                    </button>

                    {/* Security tag */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 13 }}>
                        <span style={{ fontSize: 10 }}>🔒</span>
                        <span style={{ fontSize: 9, color: DS.lo, letterSpacing: "0.04em" }}>bcrypt · JWT sessions · lockout after 5 fails · HTTPS ready</span>
                    </div>

                </div>
            </div>
        </div>
    );
}
