import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CircuitBreaker } from '../../common/utils/circuit-breaker';
import { MatviewRefreshCoordinator } from './matview-refresh-coordinator.service';

@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private readonly dbBreaker = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 15_000,
  });
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly matviews: MatviewRefreshCoordinator) {}

  onModuleInit() {
    const mins = Number.parseInt(process.env.MATVIEW_REFRESH_INTERVAL_MINUTES || '30', 10);
    if (!Number.isFinite(mins) || mins <= 0) {
      this.logger.log('Materialized view scheduler disabled (MATVIEW_REFRESH_INTERVAL_MINUTES <= 0)');
      return;
    }

    const intervalMs = mins * 60 * 1000;
    this.timer = setInterval(() => {
      void this.refreshMatviews();
    }, intervalMs);

    this.logger.log(`Materialized view scheduler enabled (every ${mins} min)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async refreshMatviews() {
    try {
      const result = await this.dbBreaker.execute(() => this.matviews.refresh());
      if (result.status === 'completed') {
        this.logger.log(`Scheduled materialized-view refresh completed in ${result.durationMs}ms`);
      } else if (result.status === 'skipped_locked') {
        this.logger.log('Scheduled materialized-view refresh skipped because another owner is active');
      } else {
        throw new Error(result.error);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown refresh error';
      this.logger.warn(
        `Scheduled materialized view refresh failed (${this.dbBreaker.getState()}): ${message}`,
      );
    }
  }
}
