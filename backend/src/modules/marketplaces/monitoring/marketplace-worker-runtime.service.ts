import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { Job, Worker } from 'bullmq';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { getBuildInfo } from '../../../common/utils/build-info';
import { Marketplace } from '../core/marketplace.enum';
import { MarketplaceSyncJobV1 } from '../core/marketplace.types';
import { marketplaceQueueName, MarketplaceWorkload } from '../queues/marketplace-queue-names';
import { MarketplaceShadowSyncService } from '../sync/marketplace-shadow-sync.service';

export type MarketplaceWorkerRole = 'realtime' | 'bulk' | 'postprocess';

@Injectable()
export class MarketplaceWorkerRuntimeService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MarketplaceWorkerRuntimeService.name);
  private readonly workers: Worker[] = [];
  private heartbeat?: NodeJS.Timeout;
  private readonly workerId = `${process.env.HOSTNAME || 'local'}:${process.pid}:${randomUUID()}`;

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly db: DataSource,
    private readonly shadowSync: MarketplaceShadowSyncService,
  ) {}

  async onModuleInit(): Promise<void> {
    const role = this.config.get<MarketplaceWorkerRole>('MARKETPLACE_WORKER_ROLE');
    if (!role) return;
    const enabledFlag = role === 'realtime' ? 'MARKETPLACE_REALTIME_WORKER_ENABLED'
      : role === 'bulk' ? 'MARKETPLACE_BULK_WORKER_ENABLED' : 'MARKETPLACE_POSTPROCESS_WORKER_ENABLED';
    if (!this.enabled('MARKETPLACE_PLATFORM_ENABLED') || !this.enabled('MARKETPLACE_QUEUE_ENABLED') || !this.enabled(enabledFlag)) {
      this.logger.warn(`Marketplace ${role} worker is disabled; no queues will be consumed`);
      await this.writeHeartbeat(role, 'DISABLED');
      return;
    }
    const workloads: MarketplaceWorkload[] = role === 'realtime' ? ['realtime'] : role === 'bulk' ? ['bulk', 'financial'] : [];
    for (const marketplace of Object.values(Marketplace)) {
      for (const workload of workloads) {
        this.workers.push(new Worker(marketplaceQueueName(marketplace, workload),
          (job) => this.process(role, job as Job<MarketplaceSyncJobV1>),
          { connection: this.connection(), concurrency: role === 'realtime' ? 2 : 1 }));
      }
    }
    this.heartbeat = setInterval(() => void this.writeHeartbeat(role, 'RUNNING'), 30_000);
    await this.writeHeartbeat(role, 'RUNNING');
    this.logger.log(`Marketplace ${role} worker started with ${this.workers.length} isolated queues`);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    await Promise.all(this.workers.map((worker) => worker.close()));
  }

  private async process(role: MarketplaceWorkerRole, job: Job<MarketplaceSyncJobV1>) {
    const payload = job.data;
    if (payload.protocolVersion !== 1) throw new Error('Unsupported marketplace job protocol');
    if (!payload.tenantId || !payload.marketplaceAccountId || !payload.syncRunId || !payload.cursorId) {
      throw new Error('Invalid marketplace job identifiers');
    }
    await this.db.query(
      `UPDATE marketplace_sync_runs
       SET status = 'RUNNING', started_at = COALESCE(started_at, now())
       WHERE id = $1 AND tenant_id = $2 AND marketplace_account_id = $3`,
      [payload.syncRunId, payload.tenantId, payload.marketplaceAccountId],
    );
    this.logger.log(JSON.stringify({ event: 'marketplace_job_claimed', role, queue: job.queueName,
      jobId: job.id, tenantId: payload.tenantId, accountId: payload.marketplaceAccountId,
      resource: payload.resource, syncRunId: payload.syncRunId }));
    try {
      const result = await this.shadowSync.process(payload);
      return { ...result, shadowMode: true };
    } catch (error) {
      await this.shadowSync.recordFailure(payload, error);
      throw error;
    }
  }

  private async writeHeartbeat(role: MarketplaceWorkerRole, status: string): Promise<void> {
    try {
      const build = getBuildInfo();
      await this.db.query(
        `INSERT INTO marketplace_worker_heartbeats (worker_id, role, version, status, metadata, heartbeat_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, now())
         ON CONFLICT (worker_id) DO UPDATE SET status = EXCLUDED.status, metadata = EXCLUDED.metadata,
           version = EXCLUDED.version, heartbeat_at = now()`,
        [this.workerId, role, build.version, status, JSON.stringify({ pid: process.pid })],
      );
    } catch (error) {
      this.logger.warn(`Marketplace heartbeat unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  private enabled(name: string): boolean {
    return this.config.get<string>(name, 'false').trim().toLowerCase() === 'true';
  }

  private connection() {
    return {
      host: this.config.get<string>('REDIS_QUEUE_HOST', 'redis-queue'),
      port: this.config.get<number>('REDIS_QUEUE_PORT', 6379),
      password: this.config.get<string>('REDIS_QUEUE_PASSWORD'),
      maxRetriesPerRequest: null,
    };
  }
}
