import { moduleLogger } from '../utils/logger';
import { readWatermark, writeWatermark, SyncModule } from '../utils/watermark';
import { setModuleStatus } from '../utils/state';
import { sendBatch } from '../sender/ingest.sender';
import { config } from '../config';
import { recordFetched, recordSent } from '../utils/sync-preview';

export interface ExtractResult {
    module:     SyncModule;
    rows:       number;
    batches:    number;
    durationMs: number;
}

export abstract class BaseExtractor {
    protected log = moduleLogger(this.module);

    constructor(protected readonly module: SyncModule) {}

    protected abstract fetchRows(lastSyncTime: Date, syncEndTime: Date): Promise<any[]>;

    async run(): Promise<ExtractResult> {
        const startedAt    = Date.now();
        const syncEndTime  = new Date();
        const lastSyncTime = readWatermark(this.module);

        // ── STEP 1: Start ────────────────────────────────────────────────────
        this.log.info(`${'─'.repeat(48)}`);
        this.log.info(`[START] module=${this.module} | watermark=${lastSyncTime.toISOString()} | window-end=${syncEndTime.toISOString()}`);
        this.log.info(`[START] batch-size=${config.batchSize}`);

        setModuleStatus(this.module, 'running', { lastRun: new Date().toISOString() });

        try {
            // ── STEP 2: Fetch from MS SQL ────────────────────────────────────
            this.log.info(`[MSSQL ] Querying JTL MS SQL for changes since ${lastSyncTime.toISOString()}…`);
            const fetchStart = Date.now();
            const rows = await this.fetchRows(lastSyncTime, syncEndTime);
            const fetchMs = Date.now() - fetchStart;
            this.log.info(`[MSSQL ] Query complete — ${rows.length} rows fetched in ${fetchMs}ms`);
            recordFetched(this.module, rows);

            // ── STEP 3: No data ──────────────────────────────────────────────
            if (rows.length === 0) {
                this.log.info(`[SKIP  ] No new/changed rows since last sync — nothing to send`);
                writeWatermark(this.module, syncEndTime);
                this.log.info(`[WM    ] Watermark advanced to ${syncEndTime.toISOString()}`);
                const durationMs = Date.now() - startedAt;
                this._incrementRuns(0);
                setModuleStatus(this.module, 'success', { lastRows: 0, lastDuration: durationMs, lastError: null });
                this.log.info(`[DONE  ] ${this.module} — 0 rows | ${durationMs}ms total`);
                this.log.info(`${'─'.repeat(48)}`);
                return { module: this.module, rows: 0, batches: 0, durationMs };
            }

            // ── STEP 4: Split into batches ───────────────────────────────────
            const batchSize = config.batchSize;
            const batches: any[][] = [];
            for (let i = 0; i < rows.length; i += batchSize) {
                batches.push(rows.slice(i, i + batchSize));
            }
            this.log.info(`[BATCH ] ${rows.length} rows → ${batches.length} batch(es) of up to ${batchSize}`);

            // ── STEP 5: Send each batch ──────────────────────────────────────
            let sentRows = 0;
            for (let i = 0; i < batches.length; i++) {
                const batchRows = batches[i].length;
                const pct = Math.round(((i + 1) / batches.length) * 100);
                this.log.info(`[SEND  ] Sending batch ${i + 1}/${batches.length} (${batchRows} rows) [${pct}%]…`);

                const sendStart = Date.now();
                await sendBatch({
                    module:        this.module,
                    batchIndex:    i,
                    totalBatches:  batches.length,
                    syncStartTime: new Date(startedAt).toISOString(),
                    watermarkTime: lastSyncTime.toISOString(),
                    rows:          batches[i],
                });
                const sendMs = Date.now() - sendStart;
                sentRows += batchRows;
                this.log.info(`[SEND  ] Batch ${i + 1}/${batches.length} ✓ — ${batchRows} rows in ${sendMs}ms (total sent: ${sentRows}/${rows.length})`);

                if (i < batches.length - 1 && config.batchDelayMs > 0) {
                    await new Promise(r => setTimeout(r, config.batchDelayMs));
                }
            }

            // ── STEP 6: Update watermark ─────────────────────────────────────
            writeWatermark(this.module, syncEndTime);
            this.log.info(`[WM    ] Watermark advanced to ${syncEndTime.toISOString()}`);

            recordSent(this.module, rows.length);

            // ── STEP 7: Summary ──────────────────────────────────────────────
            const durationMs = Date.now() - startedAt;
            this._incrementRuns(rows.length);
            setModuleStatus(this.module, 'success', { lastRows: rows.length, lastDuration: durationMs, lastError: null });

            this.log.info(`[DONE  ] ✓ ${this.module} complete`);
            this.log.info(`[DONE  ]   rows=${rows.length} | batches=${batches.length} | duration=${durationMs}ms | avg=${Math.round(durationMs / batches.length)}ms/batch`);
            this.log.info(`${'─'.repeat(48)}`);
            return { module: this.module, rows: rows.length, batches: batches.length, durationMs };

        } catch (err: any) {
            const durationMs = Date.now() - startedAt;
            this._incrementRuns(0);
            setModuleStatus(this.module, 'error', { lastError: err.message, lastDuration: durationMs });
            this.log.error(`[ERROR ] ✗ ${this.module} sync FAILED after ${durationMs}ms`);
            this.log.error(`[ERROR ]   message: ${err.message}`);
            this.log.error(`[ERROR ]   stack:   ${err.stack?.split('\n')[1]?.trim() ?? 'n/a'}`);
            this.log.info(`${'─'.repeat(48)}`);
            throw err;
        }
    }

    private _incrementRuns(rows: number): void {
        const m = require('../utils/state').engineState.modules[this.module];
        if (m) { m.totalRuns += 1; m.totalRows += rows; }
    }
}
