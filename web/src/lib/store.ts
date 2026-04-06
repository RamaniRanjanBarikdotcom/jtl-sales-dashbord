/**
 * Zustand stores — Section 10 of the development plan.
 *
 *  useStore      (authStore)   – access token (in-memory only), JWT payload, login/logout
 *  useFilterStore               – date range filter + toParams() helper
 *
 * JWT payload shape (plan Section 8):
 *   sub, tenantId, role, userLevel, name, jti, isSuperAdmin, mustChange, exp
 *
 * Mock users are retained so the demo works without a live backend.
 * When NEXT_PUBLIC_API_URL is set, AuthWrapper calls the real API instead.
 */

import { create } from 'zustand';
import { setAccessToken, setLogoutCallback } from './api';

// ── demo users ────────────────────────────────────────────────────────────────
// planRole / userLevel follow Section 8 of the plan.
// The legacy `role` field keeps existing tab-access / UI logic unchanged.
export const USERS = [
    {
        id:         "u0",
        email:      "superadmin@jtl.com",
        pass:       "Super@Admin1!",
        role:       "super_admin",    // UI role key
        planRole:   "super_admin",
        name:       "Super Admin",
        tenantId:   null,
        userLevel:  null,
        isSuperAdmin: true,
        must_change: false,
    },
    {
        id:         "u1",
        email:      "admin@jtl.com",
        pass:       "Admin@2025!",
        role:       "admin",
        planRole:   "admin",
        name:       "Max Müller",
        tenantId:   "tenant-demo-001",
        userLevel:  null,
        isSuperAdmin: false,
        must_change: false,
    },
    {
        id:         "u2",
        email:      "manager@jtl.com",
        pass:       "Manager@123",
        role:       "manager",
        planRole:   "user",
        name:       "Anna Schmidt",
        tenantId:   "tenant-demo-001",
        userLevel:  "manager" as const,
        isSuperAdmin: false,
        must_change: false,
    },
    {
        id:         "u3",
        email:      "analyst@jtl.com",
        pass:       "Analyst@123",
        role:       "analyst",
        planRole:   "user",
        name:       "Felix Wagner",
        tenantId:   "tenant-demo-001",
        userLevel:  "analyst" as const,
        isSuperAdmin: false,
        must_change: false,
    },
    {
        id:         "u4",
        email:      "viewer@jtl.com",
        pass:       "Viewer@123",
        role:       "viewer",
        planRole:   "user",
        name:       "Laura Becker",
        tenantId:   "tenant-demo-001",
        userLevel:  "viewer" as const,
        isSuperAdmin: false,
        must_change: true,
    },
];

export const ROLE_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
    super_admin: { label: "Super Admin", color: "#f97316", bg: "rgba(249,115,22,0.12)", icon: "★" },
    admin:       { label: "Admin",       color: "#f87171", bg: "rgba(248,113,113,0.12)", icon: "⬡" },
    manager:     { label: "Manager",     color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  icon: "◈" },
    analyst:     { label: "Analyst",     color: "#2dd4bf", bg: "rgba(45,212,191,0.12)",  icon: "◉" },
    viewer:      { label: "Viewer",      color: "#a78bfa", bg: "rgba(167,139,250,0.12)", icon: "◇" },
};

export const TAB_ACCESS: Record<string, string[]> = {
    overview:    ["super_admin", "admin", "manager", "analyst", "viewer"],
    sales:       ["super_admin", "admin", "manager", "analyst", "viewer"],
    products:    ["super_admin", "admin", "manager", "analyst", "viewer"],
    customers:   ["super_admin", "admin", "manager", "analyst", "viewer"],
    regional:    ["super_admin", "admin", "manager", "analyst", "viewer"],
    inventory:   ["super_admin", "admin", "manager", "analyst", "viewer"],
    marketing:   ["super_admin", "admin", "manager", "analyst"],
    sync:        ["super_admin", "admin", "manager"],
    settings:    ["super_admin", "admin", "manager", "analyst", "viewer"],
    admin:       ["admin"],
    "super-admin": ["super_admin"],
};

// ── JWT helpers ───────────────────────────────────────────────────────────────
export interface JwtPayload {
    sub:          string;
    tenantId:     string | null;
    role:         string;          // UI role (admin | manager | analyst | viewer | super_admin)
    planRole:     string;          // plan role (super_admin | admin | user)
    userLevel:    "viewer" | "analyst" | "manager" | null;
    name:         string;
    jti:          string;
    isSuperAdmin: boolean;
    mustChange:   boolean;
    exp:          number;
}

const mintToken = (u: typeof USERS[0]): string =>
    btoa(JSON.stringify({
        sub:          u.id,
        tenantId:     u.tenantId,
        role:         u.role,
        planRole:     u.planRole,
        userLevel:    u.userLevel,
        name:         u.name,
        jti:          Math.random().toString(36).slice(2),
        isSuperAdmin: u.isSuperAdmin,
        mustChange:   u.must_change,
        exp:          Date.now() + 900_000,   // 15 min
    } satisfies JwtPayload));

const readToken = (t: string): JwtPayload | null => {
    try {
        let raw: any;
        if (t.includes('.')) {
            // Real JWT: header.payload.signature — decode the middle part
            const b64url = t.split('.')[1];
            const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
            raw = JSON.parse(atob(b64));
            // Backend role is super_admin|admin|user; derive UI role for tab access
            const planRole: string = raw.role;
            const uiRole = planRole === 'user' ? (raw.userLevel || 'viewer') : planRole;
            raw = { ...raw, planRole, role: uiRole };
        } else {
            // Mock token: plain base64 JSON
            raw = JSON.parse(atob(t));
        }
        return raw as JwtPayload;
    }
    catch { return null; }
};

// ── auth store ────────────────────────────────────────────────────────────────
interface AuthState {
    token:   string | null;        // access token — in memory ONLY, never localStorage
    session: JwtPayload | null;
    fails:   Record<string, number>;
    lockout: Record<string, number>;
    view:    "login" | "force-change" | "dashboard";

    setToken:  (token: string | null) => void;
    setView:   (v: "login" | "force-change" | "dashboard") => void;
    login:     (email: string, pass: string) => { ok: boolean; msg?: string; locked?: boolean };
    logout:    () => void;
    can:       (tabId: string) => boolean;
}

export const useStore = create<AuthState>((set, get) => ({
    token:   null,
    session: null,
    fails:   {},
    lockout: {},
    view:    "login",

    setToken: (token) => {
        const session = token ? readToken(token) : null;
        set({ token, session });
        setAccessToken(token);          // keep api.ts interceptor in sync
    },

    setView: (view) => set({ view }),

    login: (email, pass) => {
        const { fails, lockout } = get();
        const now = Date.now();

        if (lockout[email] && lockout[email] > now) {
            const m = Math.ceil((lockout[email] - now) / 60_000);
            return { ok: false, msg: `Locked — try again in ${m} min`, locked: true };
        }

        const u = USERS.find(u => u.email === email);
        if (!u || u.pass !== pass) {
            const f = (fails[email] || 0) + 1;
            set({ fails: { ...fails, [email]: f } });
            if (f >= 5) {
                set({ lockout: { ...lockout, [email]: now + 900_000 } });
                return { ok: false, msg: "5 fails — locked 15 min", locked: true };
            }
            return { ok: false, msg: `Wrong credentials · ${5 - f} attempt${5 - f !== 1 ? "s" : ""} left` };
        }

        set({ fails: { ...fails, [email]: 0 } });
        const tok  = mintToken(u);
        const sess = readToken(tok)!;
        setAccessToken(tok);
        set({ token: tok, session: sess, view: u.must_change ? "force-change" : "dashboard" });
        return { ok: true };
    },

    logout: () => {
        setAccessToken(null);
        set({ token: null, session: null, view: "login" });
    },

    can: (tabId) => {
        const s = get().session;
        return !!s && (TAB_ACCESS[tabId] || []).includes(s.role);
    },
}));

// Wire the logout callback into the api interceptor (no circular import).
setLogoutCallback(() => useStore.getState().logout());

// ── filter store ──────────────────────────────────────────────────────────────
// Plan Section 10, step 4.
type RangeKey = '7D' | '30D' | '3M' | '6M' | '12M' | '2Y' | '5Y' | 'YTD' | 'ALL' | 'custom';

interface FilterState {
    range:     RangeKey;
    from?:     string;
    to?:       string;
    setRange:  (r: RangeKey) => void;
    setCustom: (from: string, to: string) => void;
    toParams:  () => URLSearchParams;
}

export const useFilterStore = create<FilterState>((set, get) => ({
    range: 'ALL',

    setRange: (range) => set({ range, from: undefined, to: undefined }),

    setCustom: (from, to) => set({ range: 'custom', from, to }),

    toParams: () => {
        const { range, from, to } = get();
        const p = new URLSearchParams({ range });
        if (from) p.set('from', from);
        if (to)   p.set('to', to);
        return p;
    },
}));
