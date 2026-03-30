/**
 * Health check script — run anytime to verify the sync engine is alive.
 *
 * Usage:
 *   npx ts-node src/check.ts
 *   node dist/check.js
 */
import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import * as sql from 'mssql';
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';

const OK  = '\x1b[32m✓\x1b[0m';
const ERR = '\x1b[31m✗\x1b[0m';
const WRN = '\x1b[33m!\x1b[0m';
const HDR = '\x1b[36m';
const RST = '\x1b[0m';

function line(char = '─', n = 52) { return char.repeat(n); }

async function main(): Promise<void> {
    console.log(`\n${HDR}${line('═')}${RST}`);
    console.log(`${HDR}  JTL Sync Engine — Health Check${RST}`);
    console.log(`${HDR}  ${new Date().toLocaleString()}${RST}`);
    console.log(`${HDR}${line('═')}${RST}\n`);

    let allOk = true;

    // ── 1. Config ─────────────────────────────────────────────────────────────
    console.log(`${HDR}[1] Configuration${RST}`);
    const configChecks = [
        { key: 'MSSQL_HOST',      val: config.mssql.host,         ok: !!config.mssql.host },
        { key: 'MSSQL_USER',      val: config.mssql.user,         ok: !!config.mssql.user },
        { key: 'MSSQL_PASSWORD',  val: config.mssql.password ? '***' : '(empty)', ok: !!config.mssql.password },
        { key: 'BACKEND_API_URL', val: config.api.backendUrl,     ok: !!config.api.backendUrl },
        { key: 'SYNC_API_KEY',    val: config.api.syncApiKey ? '***' + config.api.syncApiKey.slice(-4) : '(not set)', ok: !!config.api.syncApiKey },
        { key: 'TENANT_ID',       val: config.api.tenantId || '(not set)', ok: !!config.api.tenantId },
    ];
    for (const c of configChecks) {
        const icon = c.ok ? OK : ERR;
        if (!c.ok) allOk = false;
        console.log(`  ${icon} ${c.key.padEnd(18)} ${c.val}`);
    }

    // ── 1b. Tunnel config check ───────────────────────────────────────────────
    if (config.tunnel.enabled) {
        console.log(`\n${HDR}[1b] SSH Tunnel Configuration${RST}`);
        const tunnelChecks = [
            { key: 'TUNNEL_HOST',  val: config.tunnel.host,  ok: !!config.tunnel.host },
            { key: 'TUNNEL_USER',  val: config.tunnel.user,  ok: !!config.tunnel.user },
            { key: 'TUNNEL_AUTH',  val: config.tunnel.privateKey ? 'Private Key (' + config.tunnel.privateKey + ')' : (config.tunnel.password ? 'Password (set)' : '(MISSING)'), ok: !!(config.tunnel.privateKey || config.tunnel.password) },
            { key: 'LOCAL_PORT',   val: String(config.tunnel.localPort),  ok: true },
            { key: 'REMOTE_SQL',   val: `${config.tunnel.remoteHost}:${config.tunnel.remotePort}`, ok: true },
        ];
        for (const c of tunnelChecks) {
            const icon = c.ok ? OK : ERR;
            if (!c.ok) allOk = false;
            console.log(`  ${icon} ${c.key.padEnd(18)} ${c.val}`);
        }
    } else {
        console.log(`\n  ${WRN} TUNNEL_ENABLED=false — using direct connection`);
    }

    // ── 2. MS SQL connection ──────────────────────────────────────────────────
    console.log(`\n${HDR}[2] MS SQL Connection${RST}`);
    console.log(`  Connecting to ${config.mssql.host}:${config.mssql.port}/${config.mssql.database}…`);
    try {
        const t0 = Date.now();
        const pool = await sql.connect({
            server: config.mssql.host, port: config.mssql.port,
            database: config.mssql.database,
            user: config.mssql.user, password: config.mssql.password,
            options: { encrypt: false, trustServerCertificate: true },
            connectionTimeout: 8000, requestTimeout: 8000,
        });
        const ms = Date.now() - t0;
        const res = await pool.request().query('SELECT @@VERSION AS version, GETDATE() AS now');
        const ver = String(res.recordset[0].version).split('\n')[0].trim();
        await pool.close();
        console.log(`  ${OK} Connected in ${ms}ms`);
        console.log(`  ${OK} Server: ${ver}`);
    } catch (err: any) {
        allOk = false;
        console.log(`  ${ERR} FAILED: ${err.message}`);
        console.log(`  ${WRN} Check: firewall on port ${config.mssql.port}, SQL Server Browser running, credentials`);
    }

    // ── 3. Backend API ────────────────────────────────────────────────────────
    console.log(`\n${HDR}[3] Backend API${RST}`);
    console.log(`  Calling ${config.api.backendUrl}/api/health…`);
    try {
        const t0 = Date.now();
        const res = await axios.get(`${config.api.backendUrl}/api/health`, { timeout: 8000 });
        const ms = Date.now() - t0;
        console.log(`  ${OK} Reachable — ${res.status} in ${ms}ms`);
    } catch (err: any) {
        const status = err.response?.status;
        if (status) {
            // Got a response, just not 2xx — backend is up
            console.log(`  ${WRN} Reachable but returned HTTP ${status} (backend may need auth on /health)`);
        } else {
            allOk = false;
            console.log(`  ${ERR} UNREACHABLE: ${err.message}`);
            console.log(`  ${WRN} Check: backend running, URL correct, internet/VPN`);
        }
    }

    // ── 4. Ingest endpoint auth ───────────────────────────────────────────────
    console.log(`\n${HDR}[4] Ingest Auth (dry-run — 0 rows)${RST}`);
    if (!config.api.syncApiKey || !config.api.tenantId) {
        console.log(`  ${WRN} Skipped — SYNC_API_KEY or TENANT_ID not set`);
    } else {
        try {
            const t0 = Date.now();
            const res = await axios.post(
                `${config.api.backendUrl}/api/sync/ingest`,
                { module: 'orders', tenantId: config.api.tenantId, batchIndex: 0, totalBatches: 1, syncStartTime: new Date().toISOString(), watermarkTime: new Date().toISOString(), rows: [] },
                { headers: { Authorization: `Bearer ${config.api.syncApiKey}` }, timeout: 8000 }
            );
            console.log(`  ${OK} Auth OK — ${res.status} in ${Date.now() - t0}ms`);
        } catch (err: any) {
            const status = err.response?.status;
            if (status === 401) {
                allOk = false;
                console.log(`  ${ERR} Auth FAILED (401) — SYNC_API_KEY is wrong or expired`);
            } else if (status === 400) {
                console.log(`  ${OK} Auth OK (400 expected for empty payload — API is rejecting, not refusing)`);
            } else if (status) {
                console.log(`  ${WRN} Got HTTP ${status} — ${err.response?.data?.message ?? ''}`);
            } else {
                allOk = false;
                console.log(`  ${ERR} UNREACHABLE: ${err.message}`);
            }
        }
    }

    // ── 5. Watermarks ────────────────────────────────────────────────────────
    console.log(`\n${HDR}[5] Watermarks${RST}`);
    const wmDir = path.join(process.cwd(), 'watermarks');
    const modules = ['orders', 'products', 'customers', 'inventory'];
    for (const mod of modules) {
        const fp = path.join(wmDir, `${mod}.json`);
        if (fs.existsSync(fp)) {
            const { lastSyncTime } = JSON.parse(fs.readFileSync(fp, 'utf8'));
            const ageMs = Date.now() - new Date(lastSyncTime).getTime();
            const ageMin = Math.round(ageMs / 60000);
            const icon = ageMin > 120 ? WRN : OK;
            console.log(`  ${icon} ${mod.padEnd(10)} last=${lastSyncTime}  (${ageMin} min ago)`);
        } else {
            console.log(`  ${WRN} ${mod.padEnd(10)} watermark file missing — will use default (1 year ago) on first run`);
        }
    }

    // ── 6. Log files ─────────────────────────────────────────────────────────
    console.log(`\n${HDR}[6] Log Files${RST}`);
    const logsDir = path.join(process.cwd(), 'logs');
    if (fs.existsSync(logsDir)) {
        const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.log'));
        if (files.length === 0) {
            console.log(`  ${WRN} No log files yet (engine hasn't run)`);
        }
        for (const f of files) {
            const st = fs.statSync(path.join(logsDir, f));
            const kb = Math.round(st.size / 1024);
            console.log(`  ${OK} ${f.padEnd(22)} ${kb} KB  modified: ${st.mtime.toLocaleString()}`);
        }
    } else {
        console.log(`  ${WRN} logs/ directory not found — will be created on first run`);
    }

    // ── 7. UI server ──────────────────────────────────────────────────────────
    console.log(`\n${HDR}[7] UI Server${RST}`);
    try {
        const res = await axios.get(`http://localhost:${config.ui.port}/api/status`, {
            timeout: 3000,
            auth: { username: config.ui.username, password: config.ui.password },
        });
        const state = res.data;
        console.log(`  ${OK} UI server is RUNNING at http://localhost:${config.ui.port}`);
        console.log(`  ${OK} Uptime: ${state.uptime}s | MSSQL: ${state.mssqlConnected ? 'connected' : 'disconnected'} | API: ${state.apiReachable ? 'reachable' : 'unreachable'}`);
    } catch {
        console.log(`  ${WRN} UI server not reachable on port ${config.ui.port} — is the engine running?`);
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log(`\n${line()}`);
    if (allOk) {
        console.log(`\x1b[32m  ALL CHECKS PASSED — sync engine is healthy\x1b[0m`);
    } else {
        console.log(`\x1b[31m  SOME CHECKS FAILED — review the errors above\x1b[0m`);
    }
    console.log(`${line()}\n`);

    process.exit(allOk ? 0 : 1);
}

main().catch(err => {
    console.error('Check script error:', err.message);
    process.exit(1);
});
