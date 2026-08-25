import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class MarketplaceSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketplaceSchedulerService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly config: ConfigService, @InjectDataSource() private readonly db: DataSource) {}

  onModuleInit(): void {
    if (this.config.get<string>('MARKETPLACE_WORKER_ROLE') !== 'scheduler') return;
    if (!this.enabled('MARKETPLACE_PLATFORM_ENABLED') || !this.enabled('MARKETPLACE_SCHEDULER_ENABLED')) {
      this.logger.warn('Marketplace scheduler disabled');
      return;
    }
    this.timer = setInterval(() => void this.observeDueWork(), 30_000);
    void this.observeDueWork();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async observeDueWork(): Promise<void> {
    const rows = await this.db.query<{ due: number }[]>(
      `SELECT COUNT(*)::int AS due
       FROM marketplace_sync_policies policy
       JOIN marketplace_accounts account ON account.id = policy.marketplace_account_id
       WHERE policy.enabled = true AND account.status = 'ACTIVE'
         AND (policy.next_due_at IS NULL OR policy.next_due_at <= now())`,
    );
    const due = Number(rows[0]?.due ?? 0);
    if (due > 0) this.logger.log(`Marketplace scheduler observed ${due} due resources; automatic enqueue remains shadow-controlled`);
  }

  private enabled(name: string): boolean {
    return this.config.get<string>(name, 'false').trim().toLowerCase() === 'true';
  }
}
