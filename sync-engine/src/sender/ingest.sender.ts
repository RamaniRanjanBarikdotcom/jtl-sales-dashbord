import * as fs from 'fs';
import * as path from 'path';
import { apiClient } from './api-client';
import { config } from '../config';
import { moduleLogger } from '../utils/logger';
import { engineState, notifyStateChange } from '../utils/state';

const log = moduleLogger('sender');
const FAILED_DIR = path.join(process.cwd(), 'logs', 'failed-batches');

export interface BatchPayload {
    module:        string;
    batchIndex:    number;
    totalBatches:  number;
    syncStartTime: string;
    watermarkTime: string;
    rows:          any[];
}

export async function sendBatch(payload: BatchPayload): Promise<void> {
    const body = {
        module:        payload.module,
        tenantId:      config.api.tenantId,
        batchIndex:    payload.batchIndex,
        totalBatches:  payload.totalBatches,
        syncStartTime: payload.syncStartTime,
        watermarkTime: payload.watermarkTime,
        rows:          payload.rows,
    };

    const url = `${config.api.backendUrl}/api/sync/ingest`;
    log.info(`[HTTP  ] POST ${url}`);
    log.info(`[HTTP  ]   module=${payload.module} | batch=${payload.batchIndex + 1}/${payload.totalBatches} | rows=${payload.rows.length} | tenantId=${config.api.tenantId}`);

    const t0 = Date.now();
    try {
        const res = await apiClient.post('/api/sync/ingest', body);
        const ms = Date.now() - t0;
        const { received, inserted, updated } = res.data?.data ?? res.data ?? {};

        engineState.apiReachable = true;
        notifyStateChange();

        log.info(`[HTTP  ] ✓ ${res.status} OK in ${ms}ms`);
        log.info(`[HTTP  ]   received=${received ?? '?'} | inserted=${inserted ?? '?'} | updated=${updated ?? '?'}`);
    } catch (err: any) {
        const ms = Date.now() - t0;
        engineState.apiReachable = false;
        notifyStateChange();

        const status = err.response?.status ?? 'NO_RESPONSE';
        const detail = err.response?.data?.message ?? err.message;

        log.error(`[HTTP  ] ✗ FAILED ${status} after ${ms}ms`);
        log.error(`[HTTP  ]   url=${url}`);
        log.error(`[HTTP  ]   error=${detail}`);

        // Persist failed batch to disk
        if (!fs.existsSync(FAILED_DIR)) fs.mkdirSync(FAILED_DIR, { recursive: true });
        const fname = `${payload.module}_b${payload.batchIndex}_${Date.now()}.json`;
        const fpath = path.join(FAILED_DIR, fname);
        fs.writeFileSync(fpath, JSON.stringify(body, null, 2), 'utf8');
        log.warn(`[HTTP  ]   Failed batch saved → logs/failed-batches/${fname}`);
        log.warn(`[HTTP  ]   Retry manually: POST the file contents to /api/sync/ingest`);

        throw err;
    }
}
