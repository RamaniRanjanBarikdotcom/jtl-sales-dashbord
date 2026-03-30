import * as winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';

const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// ── In-memory ring buffer for UI SSE ─────────────────────────────────────────
export interface LogEntry {
    ts:      string;
    level:   string;
    module:  string;
    message: string;
}

const LOG_BUFFER_SIZE = 500;
const logBuffer: LogEntry[] = [];
const sseClients: Set<(entry: LogEntry) => void> = new Set();

export function getLogBuffer(): LogEntry[] {
    return [...logBuffer];
}

export function subscribeToLogs(cb: (entry: LogEntry) => void): () => void {
    sseClients.add(cb);
    return () => sseClients.delete(cb);
}

// ── Custom transport that feeds the buffer + SSE clients ──────────────────────
class UITransport extends winston.transports.Console {
    log(info: any, callback: () => void) {
        const entry: LogEntry = {
            ts:      new Date().toISOString(),
            level:   info.level,
            module:  info.module || 'system',
            message: info.message,
        };
        logBuffer.push(entry);
        if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
        sseClients.forEach(cb => cb(entry));
        callback();
    }
}

const fmt = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, module, message }) =>
        `[${timestamp}] [${String(level).toUpperCase().padEnd(5)}] [${module || 'system'}] ${message}`
    )
);

export const logger = winston.createLogger({
    level: 'info',
    format: fmt,
    defaultMeta: { module: 'system' },
    transports: [
        new winston.transports.File({ filename: path.join(logsDir, 'sync.log'), maxsize: 5_000_000, maxFiles: 5 }),
        new winston.transports.File({ filename: path.join(logsDir, 'error.log'), level: 'error', maxsize: 2_000_000, maxFiles: 3 }),
        new winston.transports.Console({ format: fmt }),
        new UITransport({ silent: true }), // feeds buffer only — no double console
    ],
});

// Convenience: create a child logger scoped to a module
export function moduleLogger(mod: string) {
    return logger.child({ module: mod });
}
