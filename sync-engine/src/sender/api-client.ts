import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { moduleLogger } from '../utils/logger';

const log = moduleLogger('api-client');

export const apiClient: AxiosInstance = axios.create({
    baseURL: config.api.backendUrl,
    timeout: 60_000,
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.api.syncApiKey}`,
    },
});

// Retry interceptor — 3 attempts with exponential backoff (5s, 15s, 45s)
const RETRY_DELAYS = [5_000, 15_000, 45_000];

apiClient.interceptors.response.use(
    res => res,
    async (err) => {
        const cfg = err.config as any;
        cfg._retryCount = (cfg._retryCount ?? 0);

        if (cfg._retryCount >= RETRY_DELAYS.length) {
            log.error(`Request failed after ${RETRY_DELAYS.length} retries: ${err.message}`);
            return Promise.reject(err);
        }

        const delay = RETRY_DELAYS[cfg._retryCount];
        cfg._retryCount += 1;
        log.warn(`Retry ${cfg._retryCount}/${RETRY_DELAYS.length} in ${delay / 1000}s — ${err.message}`);

        await new Promise(r => setTimeout(r, delay));
        return apiClient(cfg);
    }
);
