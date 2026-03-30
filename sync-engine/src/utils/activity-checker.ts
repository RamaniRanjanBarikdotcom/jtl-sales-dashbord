import axios from 'axios';
import { config } from '../config';
import { moduleLogger } from './logger';
import { engineState, notifyStateChange } from './state';
import { readWatermark } from './watermark';

const log = moduleLogger('activity');

let lastIdleSyncAt: Date | null = null;

// Called by scheduler on an interval
export async function checkIdleAndSync(triggerFullSync: () => Promise<void>): Promise<void> {
    engineState.lastIdleCheck = new Date().toISOString();
    notifyStateChange();

    try {
        const url = `${config.api.backendUrl}/api/health`;
        const res = await axios.get(url, { timeout: 5000 });
        engineState.apiReachable = true;
        notifyStateChange();

        // If backend returns tenant activity timestamp, check it
        const lastActivity: string | undefined = res.data?.tenants?.[0]?.last_dashboard_activity;
        if (!lastActivity) return;

        const idleMs = config.idle.thresholdMinutes * 60 * 1000;
        const sinceActivity = Date.now() - new Date(lastActivity).getTime();

        if (sinceActivity > idleMs) {
            // Check if we synced recently
            const orderWatermark = readWatermark('orders');
            const sinceSyncMs = Date.now() - orderWatermark.getTime();
            const minSyncInterval = 15 * 60 * 1000;

            if (sinceSyncMs > minSyncInterval) {
                const lastIdleOk = !lastIdleSyncAt || (Date.now() - lastIdleSyncAt.getTime() > minSyncInterval);
                if (lastIdleOk) {
                    log.info(`Dashboard idle for ${Math.round(sinceActivity / 60000)}m — triggering idle sync`);
                    lastIdleSyncAt = new Date();
                    await triggerFullSync();
                }
            }
        }
    } catch (err: any) {
        engineState.apiReachable = false;
        notifyStateChange();
        log.warn(`Health check failed: ${err.message}`);
    }
}
