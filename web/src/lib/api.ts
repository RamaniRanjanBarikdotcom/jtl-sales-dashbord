/**
 * Axios instance — Section 10 of the development plan.
 *
 * Request interceptor  : attaches the in-memory access token as Bearer header.
 * Response interceptor : on 401, silently refreshes the token via the httpOnly
 *                        refresh cookie and retries the original request once.
 *                        If refresh fails, the user is logged out.
 *
 * baseURL is set to NEXT_PUBLIC_API_URL so all calls go to the NestJS backend.
 * When NEXT_PUBLIC_API_URL is not set the frontend runs in demo/mock mode.
 */

import axios from 'axios';
import { z } from 'zod';

// ── token holder ──────────────────────────────────────────────────────────────
// A plain closure avoids circular imports between api.ts ↔ store.ts.
let _token: string | null = null;
let _onLogout: () => void = () => {};

export function setAccessToken(token: string | null) { _token = token; }
export function setLogoutCallback(fn: () => void)     { _onLogout = fn;  }

const ApiEnvelopeSchema = z.object({
    success: z.boolean().optional(),
    data: z.unknown().optional(),
    error: z.unknown().optional(),
    meta: z.unknown().optional(),
    code: z.string().optional(),
}).passthrough();

function readCookie(name: string): string | null {
    if (typeof document === 'undefined') return null;
    const needle = `${name}=`;
    const hit = document.cookie.split(';').map((v) => v.trim()).find((v) => v.startsWith(needle));
    if (!hit) return null;
    return decodeURIComponent(hit.slice(needle.length));
}

// ── axios instance ────────────────────────────────────────────────────────────
const api = axios.create({
    baseURL:          process.env.NEXT_PUBLIC_API_URL || '/api',
    withCredentials:  true,  // send the httpOnly refresh cookie automatically
    timeout:          15_000,
    xsrfCookieName:   'XSRF-TOKEN',
    xsrfHeaderName:   'X-CSRF-Token',
    headers: { 'Content-Type': 'application/json', 'x-api-version': '1' },
});

// attach access token
api.interceptors.request.use(config => {
    if (_token) config.headers.Authorization = `Bearer ${_token}`;

    const method = String(config.method || 'get').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const csrf = readCookie('XSRF-TOKEN');
        if (csrf) config.headers['X-CSRF-Token'] = csrf;
    }

    return config;
});

// ── refresh lock ──────────────────────────────────────────────────────────────
// Only ONE refresh call is in-flight at a time.
// All concurrent 401s share the same promise and retry with the same new token.
let _refreshPromise: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
    if (_refreshPromise) return _refreshPromise;
    _refreshPromise = axios.post(
        `${process.env.NEXT_PUBLIC_API_URL ?? ''}/auth/refresh`,
        {},
        { withCredentials: true, headers: { 'x-api-version': '1' } },
    )
    .then(({ data }) => {
        const newToken: string = data?.data?.accessToken;
        setAccessToken(newToken);
        return newToken;
    })
    .catch(() => {
        setAccessToken(null);
        _onLogout();
        return null;
    })
    .finally(() => { _refreshPromise = null; });
    return _refreshPromise;
}

// silent token refresh on 401
api.interceptors.response.use(
    res => {
        // Runtime response-shape validation baseline using zod.
        // We intentionally keep this permissive to avoid false negatives on CSV/blob endpoints.
        const data = res.data;
        if (data != null && typeof data === 'object' && !Array.isArray(data)) {
            const parsed = ApiEnvelopeSchema.safeParse(data);
            if (!parsed.success && process.env.NODE_ENV !== 'production') {
                console.error('[api] response schema mismatch', {
                    url: res.config?.url,
                    issues: parsed.error.issues,
                });
            }
        }
        return res;
    },
    async error => {
        const original = error.config;
        if (error.response?.status === 401 && !original._retry) {
            original._retry = true;
            const newToken = await doRefresh();
            if (newToken) {
                original.headers.Authorization = `Bearer ${newToken}`;
                return api(original);
            }
        }

        if (process.env.NODE_ENV !== 'production') {
            console.error('[api] request failed', {
                method: original?.method,
                url: original?.url,
                status: error?.response?.status,
                code: error?.code,
                message: error?.message,
                response: error?.response?.data,
            });
        }

        return Promise.reject(error);
    }
);

export default api;
