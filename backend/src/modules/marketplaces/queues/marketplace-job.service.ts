import { Injectable, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { MarketplaceResource } from '../core/marketplace-resource.enum';
import { MarketplaceSyncJobV1 } from '../core/marketplace.types';
import { marketplaceQueueName, MarketplaceWorkload } from './marketplace-queue-names';

@Injectable()
export class MarketplaceJobService implements OnApplicationShutdown {
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly config: ConfigService) {}

  async enqueue(job: MarketplaceSyncJobV1): Promise<{ queue: string; jobId: string }> {
    const workload = this.workload(job.resource);
    const queueName = marketplaceQueueName(job.marketplace, workload);
    const jobId = [job.protocolVersion, job.tenantId, job.marketplaceAccountId, job.resource, job.syncRunId, job.cursorId,
      job.windowStart ?? '-', job.windowEnd ?? '-'].join(':');
    const queue = this.queue(queueName);
    const maxWaiting = Math.max(1, this.config.get<number>('MARKETPLACE_QUEUE_MAX_WAITING', 10_000));
    const waiting = await queue.getWaitingCount();
    if (waiting >= maxWaiting) {
      throw new ServiceUnavailableException({
        code: 'MARKETPLACE_QUEUE_BACKPRESSURE',
        message: `Marketplace queue is at its configured waiting-job limit (${maxWaiting})`,
      });
    }
    await queue.add('marketplace.sync.v1', job, {
      jobId,
      priority: job.trigger === 'BACKFILL' ? 20 : job.trigger === 'WEBHOOK' ? 1 : 5,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 5_000 },
      removeOnFail: { age: 604_800, count: 10_000 },
    });
    return { queue: queueName, jobId };
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(Array.from(this.queues.values()).map((queue) => queue.close()));
  }

  private queue(name: string): Queue {
    const existing = this.queues.get(name);
    if (existing) return existing;
    const queue = new Queue(name, { connection: this.connection() });
    this.queues.set(name, queue);
    return queue;
  }

  private connection() {
    return {
      host: this.config.get<string>('REDIS_QUEUE_HOST', 'redis-queue'),
      port: this.config.get<number>('REDIS_QUEUE_PORT', 6379),
      password: this.config.get<string>('REDIS_QUEUE_PASSWORD'),
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    };
  }

  private workload(resource: MarketplaceResource): MarketplaceWorkload {
    if ([MarketplaceResource.ORDERS, MarketplaceResource.ORDER_ITEMS, MarketplaceResource.RETURNS,
      MarketplaceResource.REFUNDS, MarketplaceResource.CANCELLATIONS, MarketplaceResource.SHIPMENTS]
      .includes(resource)) return 'realtime';
    if ([MarketplaceResource.FINANCIALS, MarketplaceResource.ADVERTISING, MarketplaceResource.INVOICES]
      .includes(resource)) return 'financial';
    return 'bulk';
  }
}
