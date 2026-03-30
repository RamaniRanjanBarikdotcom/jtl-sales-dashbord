import express, { Request, Response, NextFunction } from 'express';
import * as path from 'path';
import * as sql  from 'mssql';
import { Client as SshClient } from 'ssh2';
import * as fs   from 'fs';
import axios     from 'axios';
import { config } from '../config';
import { moduleLogger } from '../utils/logger';
import { getLogBuffer, subscribeToLogs, LogEntry } from '../utils/logger';
import { engineState, subscribeToState } from '../utils/state';
import { getAllWatermarks } from '../utils/watermark';
import { triggerModule, runFullSync } from '../scheduler';
import { writeEnvValues, getMissingKeys } from '../utils/config-writer';
import { getAllPreviews, getPreview } from '../utils/sync-preview';

const log = moduleLogger('ui');

// ── Basic Auth middleware ──────────────────────────────────────────────────────
function basicAuth(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers['authorization'];
    if (!header) {
        res.setHeader('WWW-Authenticate', 'Basic realm="JTL Sync Engine"');
        res.status(401).send('Authentication required');
        return;
    }
    const b64 = header.replace('Basic ', '');
    const [user, pass] = Buffer.from(b64, 'base64').toString().split(':');
    if (user === config.ui.username && pass === config.ui.password) {
        next();
    } else {
        res.status(401).send('Invalid credentials');
    }
}

// ── Setup: test MS SQL connection with provided credentials ───────────────────
async function testMssqlConnection(body: any): Promise<{ ok: boolean; message: string }> {
    const useTunnel = body.tunnelEnabled === true || body.tunnelEnabled === 'true';
    const host = useTunnel ? '127.0.0.1' : (body.host || '127.0.0.1');
    const port = useTunnel ? parseInt(body.localPort || '14330') : parseInt(body.port || '1433');

    const cfg: sql.config = {
        server:   host,
        port:     port,
        database: body.database || 'eazybusiness',
        options:  { encrypt: body.encrypt !== false && body.encrypt !== 'false', trustServerCertificate: true },
        connectionTimeout: 8000,
        requestTimeout:    8000,
    };

    if (body.windowsAuth === true || body.windowsAuth === 'true') {
        cfg.options!.trustedConnection = true;
    } else {
        cfg.user     = body.user     || '';
        cfg.password = body.password || '';
    }

    try {
        const pool = await sql.connect(cfg);
        const res  = await pool.request().query('SELECT @@VERSION AS version');
        const ver  = String(res.recordset[0].version).split('\n')[0].trim();
        await pool.close();
        return { ok: true, message: `Connected — ${ver}` };
    } catch (err: any) {
        return { ok: false, message: err.message };
    }
}

// ── Setup: test SSH tunnel ────────────────────────────────────────────────────
async function testSshTunnel(body: any): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
        const ssh = new SshClient();
        const timeout = setTimeout(() => {
            ssh.destroy();
            resolve({ ok: false, message: 'SSH connection timed out (20s)' });
        }, 20_000);

        ssh.on('ready', () => {
            clearTimeout(timeout);
            ssh.destroy();
            resolve({ ok: true, message: `SSH connected to ${body.host}` });
        });

        ssh.on('error', (err) => {
            clearTimeout(timeout);
            resolve({ ok: false, message: err.message });
        });

        const sshCfg: any = {
            host:         body.host || '',
            port:         parseInt(body.port || '22'),
            username:     body.user || '',
            readyTimeout: 18_000,
        };

        if (body.privateKey && fs.existsSync(body.privateKey)) {
            sshCfg.privateKey = fs.readFileSync(body.privateKey);
        } else {
            sshCfg.password = body.password || '';
        }

        try {
            ssh.connect(sshCfg);
        } catch (err: any) {
            clearTimeout(timeout);
            resolve({ ok: false, message: err.message });
        }
    });
}

// ── Setup: test backend API ───────────────────────────────────────────────────
async function testBackendApi(body: any): Promise<{ ok: boolean; message: string }> {
    const url    = (body.backendUrl || '').replace(/\/$/, '');
    const apiKey = body.syncApiKey || '';

    try {
        // Test 1: health endpoint
        await axios.get(`${url}/api/health`, { timeout: 8000 });
    } catch (err: any) {
        if (!err.response) {
            return { ok: false, message: `Cannot reach backend: ${err.message}` };
        }
        // non-2xx still means backend is reachable
    }

    // Test 2: auth with a dry-run empty ingest
    if (apiKey) {
        try {
            await axios.post(`${url}/api/sync/ingest`,
                { module: 'orders', tenantId: body.tenantId || '', batchIndex: 0, totalBatches: 1,
                  syncStartTime: new Date().toISOString(), watermarkTime: new Date().toISOString(), rows: [] },
                { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 8000 }
            );
            return { ok: true, message: 'Backend reachable & API key valid' };
        } catch (err: any) {
            const status = err.response?.status;
            if (status === 401) return { ok: false, message: 'API key rejected (401)' };
            if (status === 400) return { ok: true, message: 'Backend reachable & API key valid' };
            if (status)         return { ok: true, message: `Backend reachable (HTTP ${status})` };
            return { ok: false, message: `Cannot reach backend: ${err.message}` };
        }
    }

    return { ok: true, message: 'Backend reachable (API key not tested yet)' };
}

export function startUIServer(): void {
    const app = express();
    app.use(express.json());

    // ── Setup routes (no auth required) ──────────────────────────────────────

    // Serve setup wizard
    app.get('/setup', (_req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'setup.html'));
    });

    // Check setup status
    app.get('/api/setup/status', (_req, res) => {
        const missing = getMissingKeys();
        res.json({ configured: missing.length === 0, missing });
    });

    // Test MS SQL connection
    app.post('/api/setup/test-mssql', async (req, res) => {
        const result = await testMssqlConnection(req.body);
        res.json(result);
    });

    // Test SSH tunnel
    app.post('/api/setup/test-tunnel', async (req, res) => {
        const result = await testSshTunnel(req.body);
        res.json(result);
    });

    // Test backend API
    app.post('/api/setup/test-backend', async (req, res) => {
        const result = await testBackendApi(req.body);
        res.json(result);
    });

    // Save config to .env and restart (PM2 will auto-restart)
    app.post('/api/setup/save', (req, res) => {
        try {
            const b = req.body;
            const values: Record<string, string> = {
                MSSQL_HOST:        b.mssqlHost        || '127.0.0.1',
                MSSQL_PORT:        b.mssqlPort        || '1433',
                MSSQL_DATABASE:    b.mssqlDatabase    || 'eazybusiness',
                MSSQL_USER:        b.mssqlUser        || '',
                MSSQL_PASSWORD:    b.mssqlPassword    || '',
                MSSQL_WINDOWS_AUTH: b.mssqlWindowsAuth ? 'true' : 'false',
                MSSQL_ENCRYPT:     b.mssqlEncrypt ? 'true' : 'false',
                MSSQL_POOL_MAX:    '3',
                MSSQL_TIMEOUT_MS:  '30000',

                TUNNEL_ENABLED:    b.tunnelEnabled ? 'true' : 'false',
                TUNNEL_HOST:       b.tunnelHost       || '',
                TUNNEL_PORT:       b.tunnelPort       || '22',
                TUNNEL_USER:       b.tunnelUser       || '',
                TUNNEL_PASSWORD:   b.tunnelPassword   || '',
                TUNNEL_PRIVATE_KEY_PATH: b.tunnelPrivateKey || '',
                TUNNEL_REMOTE_SQL_HOST:  b.tunnelRemoteHost || '127.0.0.1',
                TUNNEL_REMOTE_SQL_PORT:  b.tunnelRemotePort || '1433',
                TUNNEL_LOCAL_PORT:       b.tunnelLocalPort  || '14330',
                TUNNEL_RETRY_DELAY_SEC:  '15',
                TUNNEL_KEEPALIVE_SEC:    '30',

                BACKEND_API_URL:   b.backendUrl       || '',
                SYNC_API_KEY:      b.syncApiKey       || '',
                TENANT_ID:         b.tenantId         || '',
                API_RETRY_COUNT:   '3',
                API_TIMEOUT_MS:    '60000',

                SYNC_ORDERS_CRON:    '*/15 * * * *',
                SYNC_INVENTORY_CRON: '*/30 * * * *',
                SYNC_PRODUCTS_CRON:  '5 * * * *',
                SYNC_CUSTOMERS_CRON: '0 * * * *',
                FULL_RESYNC_CRON:    '0 3 * * 0',

                IDLE_THRESHOLD_MINUTES:     '30',
                IDLE_CHECK_INTERVAL_MINUTES: '5',
                BATCH_SIZE: '500',

                UI_PORT:     String(config.ui.port),
                UI_USERNAME: config.ui.username,
                UI_PASSWORD: config.ui.password,
            };

            writeEnvValues(values);
            log.info('[SETUP] .env written — restarting engine with new config…');
            res.json({ ok: true, message: '.env saved — engine is restarting, refresh in 5 seconds' });

            // Exit after response is sent; PM2 auto-restarts with new .env
            setTimeout(() => process.exit(0), 500);
        } catch (err: any) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });

    // ── Main dashboard — redirect to setup if not configured ─────────────────
    app.get('/', (req, res, next) => {
        const missing = getMissingKeys();
        if (missing.length > 0) {
            res.redirect('/setup');
            return;
        }
        next();
    });

    // Protected static + API routes
    app.use(basicAuth);
    app.use(express.static(path.join(__dirname, 'public')));

    // ── GET /api/status — full engine state + watermarks ─────────────────
    app.get('/api/status', (_req, res) => {
        res.json({
            ...engineState,
            watermarks: getAllWatermarks(),
            uptime: Math.floor((Date.now() - new Date(engineState.startedAt).getTime()) / 1000),
        });
    });

    // ── GET /api/logs — last N log entries ───────────────────────────────
    app.get('/api/logs', (req, res) => {
        const n     = parseInt(String(req.query.n ?? '200'));
        const level = String(req.query.level ?? '');
        let entries = getLogBuffer();
        if (level && level !== 'all') entries = entries.filter(e => e.level === level);
        res.json(entries.slice(-n));
    });

    // ── GET /api/logs/stream — SSE live log stream ───────────────────────
    app.get('/api/logs/stream', (req, res) => {
        res.setHeader('Content-Type',  'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection',    'keep-alive');
        res.flushHeaders();

        const buf = getLogBuffer().slice(-100);
        res.write(`data: ${JSON.stringify({ type: 'history', entries: buf })}\n\n`);

        const unsubLog = subscribeToLogs((entry: LogEntry) => {
            res.write(`data: ${JSON.stringify({ type: 'log', entry })}\n\n`);
        });

        const unsubState = subscribeToState(() => {
            res.write(`data: ${JSON.stringify({ type: 'state', state: engineState, watermarks: getAllWatermarks() })}\n\n`);
        });

        const hb = setInterval(() => res.write(': heartbeat\n\n'), 15_000);

        req.on('close', () => {
            unsubLog();
            unsubState();
            clearInterval(hb);
        });
    });

    // ── POST /api/query/run — run custom SQL, return preview rows ────────
    app.post('/api/query/run', async (req, res) => {
        const { query, limit = 200 } = req.body as { query: string; limit?: number };
        if (!query || typeof query !== 'string') {
            res.status(400).json({ ok: false, message: 'Missing query' });
            return;
        }
        // Safety: only allow SELECT statements
        const trimmed = query.trim().toUpperCase();
        if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
            res.status(400).json({ ok: false, message: 'Only SELECT / WITH queries are allowed' });
            return;
        }
        try {
            const { getPool } = await import('../mssql/connection');
            const pool = await getPool();
            // Wrap in TOP N to cap rows returned
            const safeQuery = `SELECT TOP ${Math.min(Number(limit) || 200, 1000)} * FROM (${query}) AS __q`;
            const result = await pool.request().query(safeQuery);
            const columns = result.recordset.length > 0
                ? Object.keys(result.recordset[0])
                : (result.recordset as any).columns
                    ? Object.keys((result.recordset as any).columns)
                    : [];
            res.json({ ok: true, columns, rows: result.recordset, total: result.recordset.length });
        } catch (err: any) {
            res.status(500).json({ ok: false, message: err.message });
        }
    });

    // ── POST /api/query/send — run SQL and POST all rows to backend ───────
    app.post('/api/query/send', async (req, res) => {
        const { query, queryName = 'custom_query' } = req.body as { query: string; queryName?: string };
        if (!query || typeof query !== 'string') {
            res.status(400).json({ ok: false, message: 'Missing query' });
            return;
        }
        const trimmed = query.trim().toUpperCase();
        if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
            res.status(400).json({ ok: false, message: 'Only SELECT / WITH queries are allowed' });
            return;
        }
        try {
            const { getPool } = await import('../mssql/connection');
            const pool = await getPool();
            const result = await pool.request().query(query);
            const rows = result.recordset;

            // Send to backend ingest endpoint
            const payload = {
                module: queryName.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase(),
                tenantId: config.api.tenantId,
                batchIndex: 0,
                totalBatches: 1,
                syncStartTime: new Date().toISOString(),
                watermarkTime: new Date().toISOString(),
                rows,
            };
            const resp = await axios.post(
                `${config.api.backendUrl}/api/sync/ingest`,
                payload,
                { headers: { Authorization: `Bearer ${config.api.syncApiKey}` }, timeout: 60_000 },
            );
            log.info(`[CUSTOM-QUERY] "${queryName}" — ${rows.length} rows sent to backend`);
            res.json({ ok: true, rowsSent: rows.length, backendStatus: resp.status });
        } catch (err: any) {
            const msg = err.response?.data?.message || err.message;
            res.status(500).json({ ok: false, message: msg });
        }
    });

    // ── GET /api/data/preview — last synced rows per module ──────────────
    app.get('/api/data/preview', (_req, res) => {
        res.json(getAllPreviews());
    });

    app.get('/api/data/preview/:module', (req, res) => {
        const preview = getPreview(req.params.module);
        if (!preview) {
            res.status(404).json({ ok: false, message: 'No data yet — run a sync first' });
            return;
        }
        res.json(preview);
    });

    // ── POST /api/trigger/:module — manually run a module ────────────────
    app.post('/api/trigger/:module', async (req, res) => {
        const mod = req.params.module;
        if (mod === 'all') {
            runFullSync().catch(() => {});
            res.json({ ok: true, message: 'Full sync triggered' });
            return;
        }
        try {
            triggerModule(mod).catch(() => {});
            res.json({ ok: true, message: `${mod} sync triggered` });
        } catch (err: any) {
            res.status(400).json({ ok: false, message: err.message });
        }
    });

    app.listen(config.ui.port, () => {
        log.info(`UI server listening on http://localhost:${config.ui.port}`);
        const missing = getMissingKeys();
        if (missing.length > 0) {
            log.warn(`[SETUP] Config incomplete (missing: ${missing.join(', ')}) — open http://localhost:${config.ui.port}/setup`);
        }
    });
}
