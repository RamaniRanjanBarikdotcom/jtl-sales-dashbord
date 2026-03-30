import { moduleLogger } from './utils/logger';
import { getPool, pingPool } from './mssql/connection';
import { startScheduler } from './scheduler';
import { startUIServer } from './ui/server';
import { config } from './config';

const log = moduleLogger('main');

function banner(): void {
    const L = '═'.repeat(54);
    log.info(L);
    log.info('  JTL Analytics — Sync Engine  v1.0.0');
    log.info(L);
    log.info(`  Node.js       : ${process.version}`);
    log.info(`  PID           : ${process.pid}`);
    log.info(`  Environment   : ${process.env.NODE_ENV || 'development'}`);
    log.info(L);

    if (config.tunnel.enabled) {
        log.info('  ── Connection Mode: SSH TUNNEL ──');
        log.info(`  SSH Host      : ${config.tunnel.host}:${config.tunnel.port}`);
        log.info(`  SSH User      : ${config.tunnel.user}`);
        log.info(`  Auth          : ${config.tunnel.privateKey ? 'Private Key' : 'Password'}`);
        log.info(`  Tunnel        : 127.0.0.1:${config.tunnel.localPort} → ${config.tunnel.remoteHost}:${config.tunnel.remotePort}`);
    } else {
        log.info('  ── Connection Mode: DIRECT ──');
        log.info(`  MSSQL Host    : ${config.mssql.host}:${config.mssql.port}`);
        log.info(`  Auth          : ${config.mssql.windowsAuth ? 'Windows Auth' : 'SQL Auth (' + config.mssql.user + ')'}`);
    }

    log.info(`  Database      : ${config.mssql.database}`);
    log.info(L);
    log.info('  ── Backend API ──');
    log.info(`  URL           : ${config.api.backendUrl}`);
    log.info(`  Tenant ID     : ${config.api.tenantId || '(not set)'}`);
    log.info(`  API Key       : ${config.api.syncApiKey ? '***' + config.api.syncApiKey.slice(-4) : '(not set)'}`);
    log.info(L);
    log.info('  ── Cron Schedules ──');
    log.info(`  Orders        : ${config.cron.orders}`);
    log.info(`  Inventory     : ${config.cron.inventory}`);
    log.info(`  Products      : ${config.cron.products}`);
    log.info(`  Customers     : ${config.cron.customers}`);
    log.info(`  Full resync   : ${config.cron.fullResync}`);
    log.info(L);
    log.info(`  UI Dashboard  : http://localhost:${config.ui.port}`);
    log.info(L);
}

async function bootstrap(): Promise<void> {
    banner();

    // ── Step 1: SSH Tunnel (if enabled) ────────────────────────────────────
    if (config.tunnel.enabled) {
        log.info('[STARTUP 1/4] SSH tunnel enabled — connecting…');
        const { connect } = await import('./mssql/ssh-tunnel');
        try {
            await connect();
            log.info('[STARTUP 1/4] ✓ SSH tunnel established');
        } catch (err: any) {
            log.warn(`[STARTUP 1/4] ✗ Tunnel failed: ${err.message}`);
            log.warn('[STARTUP 1/4]   Will keep retrying in background — continuing startup');
        }
    } else {
        log.info('[STARTUP 1/4] SSH tunnel disabled — using direct connection');
    }

    // ── Step 2: MS SQL connection ────────────────────────────────────────────
    log.info('[STARTUP 2/4] Connecting to MS SQL…');
    try {
        await getPool();
        log.info('[STARTUP 2/4] ✓ MS SQL connected');
    } catch (err: any) {
        log.warn(`[STARTUP 2/4] ✗ MS SQL not ready: ${err.message}`);
        log.warn('[STARTUP 2/4]   Auto-reconnect running in background — continuing startup');
    }

    // ── Step 3: UI server ────────────────────────────────────────────────────
    log.info('[STARTUP 3/4] Starting UI server…');
    startUIServer();
    log.info(`[STARTUP 3/4] ✓ UI ready → http://localhost:${config.ui.port}`);

    // Auto-open browser — best-effort, never blocks startup
    try {
        const { default: open } = await import('open');
        await open(`http://localhost:${config.ui.port}`);
        log.info('[STARTUP 3/4] ✓ Browser opened');
    } catch {
        log.info(`[STARTUP 3/4] Open browser manually: http://localhost:${config.ui.port}`);
    }

    // ── Step 4: Scheduler ────────────────────────────────────────────────────
    log.info('[STARTUP 4/4] Starting cron scheduler…');
    startScheduler();
    log.info('[STARTUP 4/4] ✓ Scheduler active');

    log.info('═'.repeat(54));
    log.info('  Sync engine is RUNNING');
    log.info(`  Dashboard: http://localhost:${config.ui.port}`);
    log.info(`  Logs:      ./logs/sync.log`);
    log.info('═'.repeat(54));

    // ── Heartbeat every 5 min ───────────────────────────────────────────────
    setInterval(async () => {
        const mem   = process.memoryUsage();
        const up    = fmtUptime(Math.floor(process.uptime()));
        const dbOk  = await pingPool();
        const tunOk = config.tunnel.enabled
            ? (await import('./mssql/ssh-tunnel')).isTunnelReady()
            : null;

        let status = `uptime:${up} | heap:${Math.round(mem.heapUsed / 1024 / 1024)}MB | mssql:${dbOk ? 'OK' : 'DOWN'}`;
        if (tunOk !== null) status += ` | tunnel:${tunOk ? 'OK' : 'DOWN'}`;
        log.info(`[HEARTBEAT] ${status}`);
    }, 5 * 60 * 1000);

    // ── Connection health check every 2 min ─────────────────────────────────
    setInterval(async () => {
        const ok = await pingPool();
        if (!ok) {
            log.warn('[HEALTH] MS SQL ping failed — reconnect already in progress');
        }
    }, 2 * 60 * 1000);
}

function fmtUptime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}h${m}m${s}s`;
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────
async function shutdown(signal: string): Promise<void> {
    log.info(`[SHUTDOWN] ${signal} received — shutting down gracefully`);
    if (config.tunnel.enabled) {
        const { shutdown: tunnelShutdown } = await import('./mssql/ssh-tunnel');
        tunnelShutdown();
    }
    const { closePool } = await import('./mssql/connection');
    await closePool();
    log.info('[SHUTDOWN] Clean exit');
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('uncaughtException',  (err)    => { log.error(`[FATAL] Uncaught exception: ${err.message}\n${err.stack}`); process.exit(1); });
process.on('unhandledRejection', (reason: any) => { log.error(`[FATAL] Unhandled rejection: ${reason?.message ?? reason}`); });

bootstrap().catch(err => {
    console.error('[FATAL] Startup failed:', err.message);
    process.exit(1);
});
