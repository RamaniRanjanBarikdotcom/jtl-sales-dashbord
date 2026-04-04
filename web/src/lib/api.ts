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

// ── token holder ──────────────────────────────────────────────────────────────
// A plain closure avoids circular imports between api.ts ↔ store.ts.
let _token: string | null = null;
let _onLogout: () => void = () => {};

export function setAccessToken(token: string | null) { _token = token; }
export function setLogoutCallback(fn: () => void)     { _onLogout = fn;  }

// ── axios instance ────────────────────────────────────────────────────────────
const api = axios.create({
    baseURL:          process.env.NEXT_PUBLIC_API_URL ?? '',
    withCredentials:  true,  // send the httpOnly refresh cookie automatically
    headers: { 'Content-Type': 'application/json' },
});

// attach access token
api.interceptors.request.use(config => {
    if (_token) config.headers.Authorization = `Bearer ${_token}`;
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
        { withCredentials: true },
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
    res => res,
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
        return Promise.reject(error);
    }
);

export default api;
