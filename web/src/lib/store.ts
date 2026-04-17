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

// Demo users removed — all authentication goes through the real backend API.

export const ROLE_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
    super_admin: { label: "Super Admin", color: "#f97316", bg: "rgba(249,115,22,0.12)", icon: "★" },
    admin:       { label: "Admin",       color: "#f87171", bg: "rgba(248,113,113,0.12)", icon: "⬡" },
    manager:     { label: "Manager",     color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  icon: "◈" },
    analyst:     { label: "Analyst",     color: "#2dd4bf", bg: "rgba(45,212,191,0.12)",  icon: "◉" },
    viewer:      { label: "Viewer",      color: "#a78bfa", bg: "rgba(167,139,250,0.12)", icon: "◇" },
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

const ACCESS_BY_TAB: Record<string, string[]> = {
    overview: ["viewer", "analyst", "manager", "admin", "super_admin"],
    sales: ["viewer", "analyst", "manager", "admin", "super_admin"],
    products: ["viewer", "analyst", "manager", "admin", "super_admin"],
    customers: ["viewer", "analyst", "manager", "admin", "super_admin"],
    regional: ["viewer", "analyst", "manager", "admin", "super_admin"],
    inventory: ["viewer", "analyst", "manager", "admin", "super_admin"],
    marketing: ["analyst", "manager", "admin", "super_admin"],
    settings: ["viewer", "analyst", "manager", "admin", "super_admin"],
    sync: ["manager", "admin", "super_admin"],
    admin: ["admin", "super_admin"],
    "super-admin": ["super_admin"],
};

// mintToken removed — authentication always uses real backend JWT.

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
    can:       (tabId: string) => boolean;
    login:     (email: string, pass: string) => { ok: boolean; msg?: string; locked?: boolean };
    logout:    () => void;
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

    can: (tabId: string) => {
        const role = get().session?.role || "viewer";
        const allowed = ACCESS_BY_TAB[tabId];
        if (!allowed) return true;
        return allowed.includes(role);
    },

    login: (_email: string, _pass: string) => {
        // Demo login removed — all auth goes through real backend API
        return { ok: false, msg: "Backend API required for login" };
    },

    logout: () => {
        setAccessToken(null);
        set({ token: null, session: null, view: "login" });
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
