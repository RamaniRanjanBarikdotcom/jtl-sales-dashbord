import * as sql from 'mssql';
import { config } from '../config';
import { moduleLogger } from '../utils/logger';
import { engineState, notifyStateChange } from '../utils/state';
import { isTunnelReady } from './ssh-tunnel';

const log = moduleLogger('mssql');

let pool: sql.ConnectionPool | null = null;

// ── Build mssql config ────────────────────────────────────────────────────────
// When tunnel is active, connect to localhost:TUNNEL_LOCAL_PORT instead.
function buildPoolConfig(): sql.config {
    const useTunnel = config.tunnel.enabled;
    const host = useTunnel ? '127.0.0.1'          : config.mssql.host;
    const port = useTunnel ? config.tunnel.localPort : config.mssql.port;

    if (useTunnel) {
        log.info(`[POOL  ] Using SSH tunnel: 127.0.0.1:${port} → ${config.tunnel.remoteHost}:${config.tunnel.remotePort}`);
    }

    const cfg: sql.config = {
        server:   host,
        port:     port,
        database: config.mssql.database,
        options: {
            encrypt:                config.mssql.encrypt,
            trustServerCertificate: true,
            enableArithAbort:       true,
        },
        pool: {
            max:               config.mssql.poolMax,
            min:               0,
            idleTimeoutMillis: 30_000,
        },
        requestTimeout:    config.mssql.timeoutMs,
        connectionTimeout: config.mssql.timeoutMs,
    };

    if (config.mssql.windowsAuth) {
        // Windows Authentication — no user/password needed
        log.info('[POOL  ] Using Windows Authentication');
        cfg.options!.trustedConnection = true;
    } else {
        cfg.user     = config.mssql.user;
        cfg.password = config.mssql.password;
    }

    return cfg;
}

// ── Auto-reconnect loop ───────────────────────────────────────────────────────
const RECONNECT_DELAYS = [5_000, 10_000, 20_000, 30_000, 60_000]; // escalating backoff
let reconnectAttempt = 0;

async function reconnect(): Promise<void> {
    pool = null;
    engineState.mssqlConnected = false;
    notifyStateChange();

    const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    reconnectAttempt++;
    log.warn(`[POOL  ] Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempt})…`);
    await new Promise(r => setTimeout(r, delay));

    try {
        await getPool();
    } catch {
        // getPool() will schedule another reconnect on failure
    }
}

// ── Get or create the pool ────────────────────────────────────────────────────
export async function getPool(): Promise<sql.ConnectionPool> {
    // If tunnel is required, wait for it before connecting
    if (config.tunnel.enabled && !isTunnelReady()) {
        log.warn('[POOL  ] Waiting for SSH tunnel to be ready…');
        const { waitUntilReady } = await import('./ssh-tunnel');
        await waitUntilReady(60_000);
    }

    if (pool && pool.connected) return pool;

    const poolConfig = buildPoolConfig();
    log.info(`[POOL  ] Connecting to MS SQL — ${poolConfig.server}:${poolConfig.port}/${config.mssql.database}`);
    if (!config.mssql.windowsAuth) {
        log.info(`[POOL  ]   user=${config.mssql.user} | pool-max=${config.mssql.poolMax} | timeout=${config.mssql.timeoutMs}ms`);
    }

    const t0 = Date.now();
    try {
        pool = await sql.connect(poolConfig);
        const ms = Date.now() - t0;

        // Verify with a simple query
        await pool.request().query('SELECT 1 AS ok');

        engineState.mssqlConnected = true;
        reconnectAttempt = 0; // reset backoff on success
        notifyStateChange();
        log.info(`[POOL  ] ✓ Connected & verified in ${ms}ms`);

        pool.on('error', (err) => {
            log.error(`[POOL  ] Pool error: ${err.message} — will reconnect`);
            engineState.mssqlConnected = false;
            notifyStateChange();
            reconnect().catch(() => {});
        });

        return pool;
    } catch (err: any) {
        engineState.mssqlConnected = false;
        notifyStateChange();
        const ms = Date.now() - t0;
        log.error(`[POOL  ] ✗ Connection FAILED after ${ms}ms: ${err.message}`);

        if (config.tunnel.enabled) {
            log.error(`[POOL  ]   Tunnel is ${isTunnelReady() ? 'ready' : 'NOT ready'} on port ${config.tunnel.localPort}`);
        } else {
            log.error(`[POOL  ]   Direct: ${config.mssql.host}:${config.mssql.port}`);
            log.error(`[POOL  ]   Check: firewall, SQL Server Browser service, credentials`);
        }

        // Schedule auto-reconnect — engine keeps running even if DB is temporarily down
        reconnect().catch(() => {});
        throw err;
    }
}

// ── Ping — called by health check loop ───────────────────────────────────────
export async function pingPool(): Promise<boolean> {
    try {
        if (!pool || !pool.connected) return false;
        await pool.request().query('SELECT 1');
        return true;
    } catch {
        return false;
    }
}

export async function closePool(): Promise<void> {
    if (pool) {
        log.info('[POOL  ] Closing MS SQL pool…');
        await pool.close();
        pool = null;
        engineState.mssqlConnected = false;
        notifyStateChange();
        log.info('[POOL  ] Pool closed');
    }
}

export { sql };
