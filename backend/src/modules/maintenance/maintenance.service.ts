import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CircuitBreaker } from '../../common/utils/circuit-breaker';

@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private readonly dbBreaker = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 15_000,
  });
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly db: DataSource) {}

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

    // Warm-start one refresh shortly after boot.
    setTimeout(() => {
      void this.refreshMatviews();
    }, 45_000);

    // One-time fix: mark zero-revenue orders as cancelled (they were ingested
    // before the status mapping was corrected). Runs on every startup but is
    // idempotent — the WHERE clause ensures it only touches pending+zero rows.
    setTimeout(() => {
      void this.fixZeroRevenueOrderStatuses();
    }, 10_000);

    this.logger.log(`Materialized view scheduler enabled (every ${mins} min)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async fixZeroRevenueOrderStatuses() {
    try {
      const result = await this.db.query(`
        UPDATE orders
        SET status = 'cancelled', updated_at = now()
        WHERE status = 'pending'
          AND gross_revenue = 0
          AND COALESCE(net_revenue, 0) = 0
      `);
      const affected = Array.isArray(result) ? (result[1] ?? 0) : 0;
      if (affected > 0) {
        this.logger.log(`Fixed ${affected} zero-revenue orders → status='cancelled'`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown migration error';
      this.logger.warn(`Zero-revenue order status fix failed: ${message}`);
    }
  }

  private async refreshMatviews() {
    try {
      await this.dbBreaker.execute(() => this.db.query('SELECT refresh_all_matviews()'));
      this.logger.log('Scheduled materialized view refresh completed');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown refresh error';
      this.logger.warn(
        `Scheduled materialized view refresh failed (${this.dbBreaker.getState()}): ${message}`,
      );
    }
  }
}
