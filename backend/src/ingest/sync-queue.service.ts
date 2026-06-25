import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import { TenantConnection } from '../entities/tenant-connection.entity';
import { IngestDto } from './dto/ingest.dto';
import { IngestService } from './ingest.service';
import { REDIS_CLIENT } from '../cache/cache.constants';

type QueueStatus = 'queued' | 'processing' | 'ok' | 'failed';

interface SyncJob {
  id: string;
  body: IngestDto;
  connectionId: string;
  tenantId: string;
  enqueuedAt: number;
  raw?: string;
}

@Injectable()
export class SyncQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncQueueService.name);
  private readonly queueKey = process.env.SYNC_QUEUE_REDIS_KEY || 'sync:ingest:queue';
  private readonly processingKey = `${this.queueKey}:processing`;
  private readonly statusKey = `${this.queueKey}:status`;
  private readonly maxDepth = Math.max(
    1,
    Number.parseInt(process.env.SYNC_QUEUE_MAX_DEPTH || '200', 10) || 200,
  );
  private readonly retryAfterSeconds = Math.max(
    5,
    Number.parseInt(process.env.SYNC_QUEUE_RETRY_AFTER_SECONDS || '30', 10) || 30,
  );
  private readonly activeTenants = new Set<string>();
  private draining = false;
  private stopped = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly ingestService: IngestService,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
    @InjectRepository(TenantConnection)
    private readonly connRepo: Repository<TenantConnection>,
  ) {}

  async onModuleInit() {
    await this.recoverProcessingJobs();
    this.drainSoon();
  }

  onModuleDestroy() {
    this.stopped = true;
  }

  async getStatus() {
    return {
      waiting: await this.redis.llen(this.queueKey),
      processing: await this.redis.llen(this.processingKey),
      active: this.activeTenants.size,
      maxDepth: this.maxDepth,
    };
  }

  getRetryAfterSeconds() {
    return this.retryAfterSeconds;
  }

  private jobId(body: IngestDto, tenantId: string) {
    return `${tenantId}:${body.module}:${body.syncRunId || 'run'}:${body.batchIndex ?? 0}`;
  }

  private serializeJob(job: SyncJob) {
    return JSON.stringify({
      id: job.id,
      body: job.body,
      connectionId: job.connectionId,
      tenantId: job.tenantId,
      enqueuedAt: job.enqueuedAt,
    });
  }

  private parseJob(raw: string): SyncJob | null {
    try {
      const parsed = JSON.parse(raw) as SyncJob;
      if (!parsed?.id || !parsed?.tenantId || !parsed?.body?.module) return null;
      return { ...parsed, raw };
    } catch {
      return null;
    }
  }

  private async removeQueuedIndex(index: number) {
    const marker = `__sync_queue_remove__:${randomUUID()}`;
    await this.redis
      .multi()
      .lset(this.queueKey, index, marker)
      .lrem(this.queueKey, 1, marker)
      .exec();
  }

  private async recoverProcessingJobs() {
    const processingJobs = await this.redis.lrange(this.processingKey, 0, -1);
    if (processingJobs.length === 0) return;

    const pipeline = this.redis.pipeline();
    for (const raw of processingJobs) {
      pipeline.rpush(this.queueKey, raw);
    }
    pipeline.del(this.processingKey);
    await pipeline.exec();
    this.logger.warn(`Recovered ${processingJobs.length} persisted sync queue job(s) after restart`);
  }

  private async takeNextJob(): Promise<SyncJob | null> {
    const length = await this.redis.llen(this.queueKey);
    if (length === 0) return null;

    const candidates = await this.redis.lrange(this.queueKey, 0, Math.min(length - 1, 100));
    for (let index = 0; index < candidates.length; index++) {
      const raw = candidates[index];
      const job = this.parseJob(raw);
      if (!job) {
        await this.removeQueuedIndex(index);
        continue;
      }
      if (this.activeTenants.has(job.tenantId)) continue;

      await this.removeQueuedIndex(index);
      await this.redis.rpush(this.processingKey, raw);
      return job;
    }

    return null;
  }

  private async recordBatch(body: IngestDto, tenantId: string, status: QueueStatus, errorMessage?: string) {
    const syncRunId = body.syncRunId;
    if (!syncRunId) return;
    try {
      await this.dataSource.query(
        `INSERT INTO sync_runs (id, tenant_id, module, sync_mode, status, started_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, 'queued', COALESCE($5::timestamptz, now()))
         ON CONFLICT (id) DO UPDATE SET status = CASE
           WHEN sync_runs.status IN ('ok','failed','cancelled') THEN sync_runs.status
           ELSE EXCLUDED.status
         END`,
        [
          syncRunId,
          tenantId,
          body.module,
          body.syncMode || 'incremental',
          body.syncStartTime || null,
        ],
      );
      await this.dataSource.query(
        `INSERT INTO sync_run_batches (
           sync_run_id, tenant_id, module, batch_index, total_batches, checksum, row_count,
           inserted_rows, updated_rows, status, queued_at, started_at, completed_at, failed_at, error_message
         )
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7,
           0, 0, $8, now(),
           CASE WHEN $8 = 'processing' THEN now() ELSE NULL END,
           CASE WHEN $8 = 'ok' THEN now() ELSE NULL END,
           CASE WHEN $8 = 'failed' THEN now() ELSE NULL END,
           $9
         )
         ON CONFLICT (sync_run_id, batch_index) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           module = EXCLUDED.module,
           total_batches = EXCLUDED.total_batches,
           checksum = EXCLUDED.checksum,
           row_count = EXCLUDED.row_count,
           inserted_rows = GREATEST(sync_run_batches.inserted_rows, EXCLUDED.inserted_rows),
           updated_rows = GREATEST(sync_run_batches.updated_rows, EXCLUDED.updated_rows),
           status = EXCLUDED.status,
           queued_at = COALESCE(sync_run_batches.queued_at, EXCLUDED.queued_at),
           started_at = COALESCE(EXCLUDED.started_at, sync_run_batches.started_at),
           completed_at = COALESCE(EXCLUDED.completed_at, sync_run_batches.completed_at),
           failed_at = COALESCE(EXCLUDED.failed_at, sync_run_batches.failed_at),
           error_message = EXCLUDED.error_message`,
        [
          syncRunId,
          tenantId,
          body.module,
          body.batchIndex ?? 0,
          body.totalBatches ?? 1,
          body.checksum || null,
          Array.isArray(body.rows) ? body.rows.length : 0,
          status,
          errorMessage || null,
        ],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || 'unknown telemetry error');
      this.logger.warn(`Sync telemetry write skipped for ${body.module}:${syncRunId}: ${message}`);
    }
  }

  async enqueue(body: IngestDto, conn: TenantConnection) {
    const tenantId = conn.tenant_id;
    body.syncRunId = body.syncRunId || randomUUID();
    body.batchIndex = body.batchIndex ?? 0;
    body.totalBatches = body.totalBatches ?? 1;
    const id = this.jobId(body, tenantId);
    const existing = (await this.redis.hget(this.statusKey, id)) as QueueStatus | null;
    if (existing && existing !== 'failed') {
      return {
        accepted: true,
        syncRunId: body.syncRunId,
        batchIndex: body.batchIndex ?? 0,
        status: existing,
        duplicate: true,
      };
    }

    const depth = await this.redis.llen(this.queueKey)
      + await this.redis.llen(this.processingKey)
      + this.activeTenants.size;
    if (depth >= this.maxDepth) {
      throw new ServiceUnavailableException({
        accepted: false,
        code: 'SYNC_BACKPRESSURE',
        message: `Sync queue is busy. Retry after ${this.retryAfterSeconds} seconds.`,
        retryAfterSeconds: this.retryAfterSeconds,
      });
    }

    await this.redis.hset(this.statusKey, id, 'queued');
    await this.recordBatch(body, tenantId, 'queued');
    const job: SyncJob = { id, body: { ...body, tenantId }, connectionId: conn.id, tenantId, enqueuedAt: Date.now() };
    await this.redis.rpush(this.queueKey, this.serializeJob(job));
    this.drainSoon();
    return {
      accepted: true,
      syncRunId: body.syncRunId,
      batchIndex: body.batchIndex ?? 0,
      status: 'queued',
    };
  }

  private drainSoon() {
    if (this.draining || this.stopped) return;
    this.draining = true;
    setImmediate(() => void this.drain());
  }

  private async drain() {
    try {
      while (!this.stopped) {
        const job = await this.takeNextJob();
        if (!job) break;
        this.activeTenants.add(job.tenantId);
        void this.process(job);
      }
    } finally {
      this.draining = false;
      if (await this.redis.llen(this.queueKey) > 0) {
        this.drainSoon();
      }
    }
  }

  private async process(job: SyncJob) {
    try {
      await this.redis.hset(this.statusKey, job.id, 'processing');
      await this.recordBatch(job.body, job.tenantId, 'processing');
      try {
        await this.dataSource.query(
          `UPDATE sync_runs SET status = 'running' WHERE id = $1::uuid AND status = 'queued'`,
          [job.body.syncRunId],
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err || 'unknown telemetry error');
        this.logger.warn(`Sync run status update skipped for ${job.id}: ${message}`);
      }
      const result = await this.ingestService.processIngest(job.body);
      const conn = await this.connRepo.findOne({ where: { id: job.connectionId } });
      if (conn) {
        conn.last_ingest_at = new Date();
        conn.last_ingest_module = job.body.module;
        conn.last_success_at = conn.last_ingest_at;
        conn.last_success_module = job.body.module;
        conn.last_failure_message = null as unknown as string;
        await this.connRepo.save(conn);
      }
      await this.redis.hset(this.statusKey, job.id, 'ok');
      this.logger.log(`Processed sync job ${job.id} in ${Date.now() - job.enqueuedAt}ms`);
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err || 'Unknown sync queue error');
      const conn = await this.connRepo.findOne({ where: { id: job.connectionId } });
      if (conn) {
        conn.last_failure_at = new Date();
        conn.last_failure_message = message.replace(/[\r\n\t]+/g, ' ').slice(0, 2000);
        await this.connRepo.save(conn);
      }
      await this.redis.hset(this.statusKey, job.id, 'failed');
      await this.recordBatch(job.body, job.tenantId, 'failed', message);
      this.logger.error(`Sync job failed ${job.id}: ${message}`, err instanceof Error ? err.stack : undefined);
    } finally {
      if (job.raw) {
        await this.redis.lrem(this.processingKey, 1, job.raw);
      }
      this.activeTenants.delete(job.tenantId);
      this.drainSoon();
    }
  }
}
