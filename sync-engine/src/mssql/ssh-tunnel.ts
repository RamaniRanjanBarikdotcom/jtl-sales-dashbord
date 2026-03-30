/**
 * SSH Tunnel module
 *
 * When TUNNEL_ENABLED=true the sync engine:
 *  1. Opens an SSH connection to the JTL Windows server
 *  2. Forwards  localhost:TUNNEL_LOCAL_PORT  →  remote:TUNNEL_REMOTE_SQL_PORT
 *  3. The mssql pool connects to localhost:TUNNEL_LOCAL_PORT
 *
 * If the tunnel drops it automatically reconnects with a delay.
 */

import * as net from 'net';
import * as fs  from 'fs';
import { Client as SshClient, ConnectConfig } from 'ssh2';
import { config } from '../config';
import { moduleLogger } from '../utils/logger';
import { engineState, notifyStateChange } from '../utils/state';

const log = moduleLogger('tunnel');

// ── Shared tunnel state ───────────────────────────────────────────────────────
let sshClient:   SshClient   | null = null;
let localServer: net.Server  | null = null;
let tunnelReady  = false;
let shuttingDown = false;
let reconnectTimer: NodeJS.Timeout | null = null;

export function isTunnelReady(): boolean { return tunnelReady; }

// ── Build SSH connect config ──────────────────────────────────────────────────
function buildSshConfig(): ConnectConfig {
    const cfg = config.tunnel;
    const sshCfg: ConnectConfig = {
        host:           cfg.host,
        port:           cfg.port,
        username:       cfg.user,
        keepaliveInterval: cfg.keepAliveSec * 1000,
        keepaliveCountMax: 3,
        readyTimeout:   20_000,
    };

    if (cfg.privateKey && fs.existsSync(cfg.privateKey)) {
        sshCfg.privateKey = fs.readFileSync(cfg.privateKey);
        log.info(`[TUNNEL] Using private key: ${cfg.privateKey}`);
    } else if (cfg.password) {
        sshCfg.password = cfg.password;
    } else {
        throw new Error('Tunnel: provide either TUNNEL_PASSWORD or TUNNEL_PRIVATE_KEY_PATH');
    }

    return sshCfg;
}

// ── Start the local TCP server that accepts mssql connections ─────────────────
function startLocalServer(ssh: SshClient): Promise<void> {
    return new Promise((resolve, reject) => {
        const localPort  = config.tunnel.localPort;
        const remoteHost = config.tunnel.remoteHost;
        const remotePort = config.tunnel.remotePort;

        localServer = net.createServer((localSocket) => {
            ssh.forwardOut(
                '127.0.0.1', localPort,
                remoteHost,  remotePort,
                (err, stream) => {
                    if (err) {
                        log.error(`[TUNNEL] forwardOut error: ${err.message}`);
                        localSocket.destroy();
                        return;
                    }
                    // Pipe local socket ↔ SSH stream
                    localSocket.pipe(stream).pipe(localSocket);
                    stream.on('close', () => localSocket.destroy());
                    localSocket.on('close', () => stream.destroy());
                    stream.on('error', (e: Error) => log.error(`[TUNNEL] Stream error: ${e.message}`));
                    localSocket.on('error', (e: Error) => log.error(`[TUNNEL] Socket error: ${e.message}`));
                }
            );
        });

        localServer.on('error', (err) => {
            log.error(`[TUNNEL] Local server error: ${err.message}`);
            reject(err);
        });

        localServer.listen(localPort, '127.0.0.1', () => {
            log.info(`[TUNNEL] Local forwarder listening on 127.0.0.1:${localPort} → ${remoteHost}:${remotePort}`);
            resolve();
        });
    });
}

// ── Close everything cleanly ──────────────────────────────────────────────────
function closeTunnel(): void {
    tunnelReady = false;
    (engineState as any).tunnelConnected = false;
    notifyStateChange();

    if (localServer) { localServer.close(); localServer = null; }
    if (sshClient)   { sshClient.destroy(); sshClient   = null; }
}

// ── Schedule a reconnect ──────────────────────────────────────────────────────
function scheduleReconnect(): void {
    if (shuttingDown) return;
    if (reconnectTimer) return;  // already scheduled
    const delay = config.tunnel.retryDelaySec * 1000;
    log.info(`[TUNNEL] Reconnecting in ${config.tunnel.retryDelaySec}s…`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect().catch(() => {});
    }, delay);
}

// ── Main connect function ─────────────────────────────────────────────────────
export function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
        closeTunnel();

        const cfg = config.tunnel;
        log.info(`[TUNNEL] Connecting SSH → ${cfg.user}@${cfg.host}:${cfg.port}`);

        let sshConfig: ConnectConfig;
        try {
            sshConfig = buildSshConfig();
        } catch (err: any) {
            log.error(`[TUNNEL] Config error: ${err.message}`);
            return reject(err);
        }

        const ssh = new SshClient();
        sshClient = ssh;

        ssh.on('ready', async () => {
            log.info(`[TUNNEL] ✓ SSH connection established to ${cfg.host}`);
            try {
                await startLocalServer(ssh);
                tunnelReady = true;
                (engineState as any).tunnelConnected = true;
                notifyStateChange();
                log.info(`[TUNNEL] ✓ Tunnel ready — mssql → 127.0.0.1:${cfg.localPort} → ${cfg.remoteHost}:${cfg.remotePort}`);
                resolve();
            } catch (err: any) {
                log.error(`[TUNNEL] Failed to start local forwarder: ${err.message}`);
                closeTunnel();
                scheduleReconnect();
                reject(err);
            }
        });

        ssh.on('error', (err) => {
            log.error(`[TUNNEL] SSH error: ${err.message}`);
            if (!tunnelReady) {
                closeTunnel();
                scheduleReconnect();
                reject(err);
            } else {
                closeTunnel();
                scheduleReconnect();
            }
        });

        ssh.on('close', () => {
            if (shuttingDown) return;
            log.warn(`[TUNNEL] SSH connection closed`);
            closeTunnel();
            scheduleReconnect();
        });

        ssh.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
            // Handle keyboard-interactive auth (some Windows SSH servers need this)
            finish(prompts.map(() => cfg.password));
        });

        try {
            ssh.connect(sshConfig);
        } catch (err: any) {
            log.error(`[TUNNEL] ssh.connect threw: ${err.message}`);
            reject(err);
        }
    });
}

// ── Gracefully close on shutdown ──────────────────────────────────────────────
export function shutdown(): void {
    shuttingDown = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    closeTunnel();
    log.info('[TUNNEL] Tunnel shut down');
}

// ── Wait until tunnel is ready (used by pool at startup) ─────────────────────
export async function waitUntilReady(maxWaitMs = 60_000): Promise<void> {
    const start = Date.now();
    while (!tunnelReady) {
        if (Date.now() - start > maxWaitMs) {
            throw new Error(`Tunnel not ready after ${maxWaitMs / 1000}s`);
        }
        await new Promise(r => setTimeout(r, 500));
    }
}
