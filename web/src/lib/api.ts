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

// silent token refresh on 401
api.interceptors.response.use(
    res => res,
    async error => {
        const original = error.config;
        if (error.response?.status === 401 && !original._retry) {
            original._retry = true;
            try {
                // The refresh token lives in the httpOnly cookie — no body needed.
                const { data } = await axios.post(
                    `${process.env.NEXT_PUBLIC_API_URL ?? ''}/auth/refresh`,
                    {},
                    { withCredentials: true }
                );
                const newToken: string = data?.data?.accessToken;
                setAccessToken(newToken);
                original.headers.Authorization = `Bearer ${newToken}`;
                return api(original);
            } catch {
                setAccessToken(null);
                _onLogout();
            }
        }
        return Promise.reject(error);
    }
);

export default api;
