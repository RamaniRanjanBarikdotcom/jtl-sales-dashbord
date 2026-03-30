/**
 * Config Writer — writes key=value pairs to the .env file.
 *
 * Called by the setup wizard API after the user completes the wizard.
 * Merges new values into any existing .env file (preserves unknown keys).
 * After saving, the process exits (PM2 restarts it with the new config).
 */

import * as fs   from 'fs';
import * as path from 'path';

const ENV_PATH = path.join(process.cwd(), '.env');

/** Parse an existing .env file into a key→value map. */
function parseEnv(raw: string): Record<string, string> {
    const map: Record<string, string> = {};
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        map[key] = val;
    }
    return map;
}

/** Serialize a key→value map back to .env format. */
function serializeEnv(map: Record<string, string>): string {
    return Object.entries(map)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n') + '\n';
}

/**
 * Merge `updates` into the .env file and write it back.
 * Existing unknown keys are preserved.
 */
export function writeEnvValues(updates: Record<string, string>): void {
    let existing: Record<string, string> = {};
    if (fs.existsSync(ENV_PATH)) {
        existing = parseEnv(fs.readFileSync(ENV_PATH, 'utf8'));
    }
    const merged = { ...existing, ...updates };
    fs.writeFileSync(ENV_PATH, serializeEnv(merged), 'utf8');
}

/**
 * Check whether the minimum required config is present in the .env file.
 * Returns the list of missing keys (empty = all good).
 */
export function getMissingKeys(): string[] {
    if (!fs.existsSync(ENV_PATH)) {
        return ['BACKEND_API_URL', 'SYNC_API_KEY', 'TENANT_ID', 'MSSQL_PASSWORD'];
    }
    const map = parseEnv(fs.readFileSync(ENV_PATH, 'utf8'));
    const missing: string[] = [];

    if (!map['BACKEND_API_URL'] || map['BACKEND_API_URL'] === 'https://yourdomain.com') {
        missing.push('BACKEND_API_URL');
    }
    if (!map['SYNC_API_KEY'] || map['SYNC_API_KEY'].includes('long-random')) {
        missing.push('SYNC_API_KEY');
    }
    if (!map['TENANT_ID'] || map['TENANT_ID'].includes('uuid-of')) {
        missing.push('TENANT_ID');
    }
    // For MSSQL: either password or windows auth must be set
    const hasPassword   = !!map['MSSQL_PASSWORD'] && map['MSSQL_PASSWORD'] !== 'your-readonly-password';
    const windowsAuth   = map['MSSQL_WINDOWS_AUTH'] === 'true';
    if (!hasPassword && !windowsAuth) {
        missing.push('MSSQL_PASSWORD');
    }

    return missing;
}
