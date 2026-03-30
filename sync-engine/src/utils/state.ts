// Shared in-memory state — read by UI, written by extractors/scheduler

export type ModuleStatus = 'idle' | 'running' | 'success' | 'error';

export interface ModuleState {
    status:        ModuleStatus;
    lastRun:       string | null;   // ISO timestamp
    nextRun:       string | null;   // ISO timestamp
    lastDuration:  number | null;   // ms
    lastRows:      number | null;   // rows synced in last run
    lastError:     string | null;
    totalRuns:     number;
    totalRows:     number;
}

export interface SyncEngineState {
    startedAt:      string;
    mssqlConnected: boolean;
    apiReachable:   boolean;
    lastIdleCheck:  string | null;
    modules: Record<string, ModuleState>;
}

function defaultModule(): ModuleState {
    return {
        status: 'idle', lastRun: null, nextRun: null,
        lastDuration: null, lastRows: null, lastError: null,
        totalRuns: 0, totalRows: 0,
    };
}

export const engineState: SyncEngineState = {
    startedAt:      new Date().toISOString(),
    mssqlConnected: false,
    apiReachable:   false,
    lastIdleCheck:  null,
    modules: {
        orders:    defaultModule(),
        products:  defaultModule(),
        customers: defaultModule(),
        inventory: defaultModule(),
    },
};

// Callbacks to notify UI SSE clients of state changes
const stateListeners: Set<() => void> = new Set();

export function subscribeToState(cb: () => void): () => void {
    stateListeners.add(cb);
    return () => stateListeners.delete(cb);
}

export function notifyStateChange(): void {
    stateListeners.forEach(cb => cb());
}

export function setModuleStatus(mod: string, status: ModuleStatus, extra?: Partial<ModuleState>): void {
    const m = engineState.modules[mod];
    if (!m) return;
    Object.assign(m, { status, ...extra });
    notifyStateChange();
}
