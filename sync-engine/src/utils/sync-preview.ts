// In-memory store: keeps last 100 rows per module for the UI preview

export interface ModulePreview {
    module:       string;
    lastFetched:  string | null;   // ISO timestamp
    totalFetched: number;
    totalSent:    number;
    columns:      string[];
    rows:         any[];
}

const MAX_ROWS = 100;

const store: Record<string, ModulePreview> = {};

export function initPreview(module: string): void {
    if (!store[module]) {
        store[module] = {
            module,
            lastFetched:  null,
            totalFetched: 0,
            totalSent:    0,
            columns:      [],
            rows:         [],
        };
    }
}

export function recordFetched(module: string, rows: any[]): void {
    initPreview(module);
    const p = store[module];
    p.lastFetched  = new Date().toISOString();
    p.totalFetched = rows.length;
    if (rows.length > 0) {
        p.columns = Object.keys(rows[0]);
        p.rows    = rows.slice(0, MAX_ROWS);
    }
}

export function recordSent(module: string, count: number): void {
    initPreview(module);
    store[module].totalSent = count;
}

export function getAllPreviews(): Record<string, ModulePreview> {
    return store;
}

export function getPreview(module: string): ModulePreview | null {
    return store[module] ?? null;
}
