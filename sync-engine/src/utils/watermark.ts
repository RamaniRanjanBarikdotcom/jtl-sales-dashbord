import * as fs from 'fs';
import * as path from 'path';
import { moduleLogger } from './logger';

const log = moduleLogger('watermark');
const WATERMARKS_DIR = path.join(process.cwd(), 'watermarks');

if (!fs.existsSync(WATERMARKS_DIR)) {
    fs.mkdirSync(WATERMARKS_DIR, { recursive: true });
}

export type SyncModule = 'orders' | 'products' | 'customers' | 'inventory';

function filePath(mod: SyncModule): string {
    return path.join(WATERMARKS_DIR, `${mod}.json`);
}

export function readWatermark(mod: SyncModule): Date {
    try {
        const raw = fs.readFileSync(filePath(mod), 'utf8');
        const { lastSyncTime } = JSON.parse(raw);
        return new Date(lastSyncTime);
    } catch {
        // Default: 1 year ago for first run
        const d = new Date();
        d.setFullYear(d.getFullYear() - 1);
        return d;
    }
}

export function writeWatermark(mod: SyncModule, time: Date): void {
    const data = { lastSyncTime: time.toISOString(), updatedAt: new Date().toISOString() };
    fs.writeFileSync(filePath(mod), JSON.stringify(data, null, 2), 'utf8');
    log.info(`Watermark updated: ${mod} → ${time.toISOString()}`);
}

export function getAllWatermarks(): Record<SyncModule, string> {
    const modules: SyncModule[] = ['orders', 'products', 'customers', 'inventory'];
    const result = {} as Record<SyncModule, string>;
    for (const mod of modules) {
        result[mod] = readWatermark(mod).toISOString();
    }
    return result;
}
