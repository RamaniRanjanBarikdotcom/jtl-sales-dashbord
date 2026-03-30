import * as dotenv from 'dotenv';
dotenv.config();

function optional(key: string, fallback: string): string {
    return process.env[key] ?? fallback;
}

function optionalBool(key: string, fallback: boolean): boolean {
    const v = process.env[key];
    if (v === undefined) return fallback;
    return v === 'true' || v === '1';
}

export const config = {
    mssql: {
        host:      optional('MSSQL_HOST', '127.0.0.1'),
        port:      parseInt(optional('MSSQL_PORT', '1433')),
        database:  optional('MSSQL_DATABASE', 'eazybusiness'),
        user:      optional('MSSQL_USER', 'sa'),
        password:  optional('MSSQL_PASSWORD', ''),
        poolMax:   parseInt(optional('MSSQL_POOL_MAX', '3')),
        timeoutMs: parseInt(optional('MSSQL_TIMEOUT_MS', '30000')),
        // Windows Authentication (uses current OS user, no user/password needed)
        windowsAuth: optionalBool('MSSQL_WINDOWS_AUTH', false),
        // Encryption enabled by default — most SQL Servers require it
        encrypt:     optionalBool('MSSQL_ENCRYPT', true),
    },

    // ── SSH Tunnel ────────────────────────────────────────────────────────────
    // Used when the JTL server is remote (accessed via RDP / not on local LAN).
    // The sync engine opens an SSH tunnel to the JTL Windows server and
    // forwards a local port → remote MS SQL port 1433.
    // Requires: OpenSSH Server enabled on the Windows machine.
    tunnel: {
        enabled:     optionalBool('TUNNEL_ENABLED', false),
        host:        optional('TUNNEL_HOST', ''),          // public IP/hostname of JTL server
        port:        parseInt(optional('TUNNEL_PORT', '22')),
        user:        optional('TUNNEL_USER', ''),          // Windows username
        password:    optional('TUNNEL_PASSWORD', ''),      // Windows password (or leave blank if using key)
        privateKey:  optional('TUNNEL_PRIVATE_KEY_PATH', ''), // path to private key file (optional)
        // Remote SQL Server address as seen from inside the JTL server
        remoteHost:  optional('TUNNEL_REMOTE_SQL_HOST', '127.0.0.1'),
        remotePort:  parseInt(optional('TUNNEL_REMOTE_SQL_PORT', '1433')),
        // Local port the tunnel will bind to — mssql will connect here
        localPort:   parseInt(optional('TUNNEL_LOCAL_PORT', '14330')),
        // Retry settings
        retryDelaySec:   parseInt(optional('TUNNEL_RETRY_DELAY_SEC', '15')),
        keepAliveSec:    parseInt(optional('TUNNEL_KEEPALIVE_SEC', '30')),
    },

    api: {
        backendUrl: optional('BACKEND_API_URL', 'http://localhost:3001'),
        syncApiKey: optional('SYNC_API_KEY', ''),
        tenantId:   optional('TENANT_ID', ''),
        // Retry settings for sending batches
        retryCount:  parseInt(optional('API_RETRY_COUNT', '3')),
        timeoutMs:   parseInt(optional('API_TIMEOUT_MS', '60000')),
    },

    cron: {
        orders:     optional('SYNC_ORDERS_CRON',    '*/15 * * * *'),
        inventory:  optional('SYNC_INVENTORY_CRON', '*/30 * * * *'),
        products:   optional('SYNC_PRODUCTS_CRON',  '5 * * * *'),
        customers:  optional('SYNC_CUSTOMERS_CRON', '0 * * * *'),
        fullResync: optional('FULL_RESYNC_CRON',    '0 3 * * 0'),
    },

    idle: {
        thresholdMinutes:     parseInt(optional('IDLE_THRESHOLD_MINUTES', '30')),
        checkIntervalMinutes: parseInt(optional('IDLE_CHECK_INTERVAL_MINUTES', '5')),
    },

    batchSize:    parseInt(optional('BATCH_SIZE',     '100')),
    batchDelayMs: parseInt(optional('BATCH_DELAY_MS', '500')),

    ui: {
        port:     parseInt(optional('UI_PORT', '3333')),
        username: optional('UI_USERNAME', 'admin'),
        password: optional('UI_PASSWORD', 'changeme'),
    },
};
