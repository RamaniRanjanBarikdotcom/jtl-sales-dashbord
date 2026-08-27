import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export type MatviewRefreshResult =
  | { status: 'completed'; durationMs: number }
  | { status: 'skipped_locked'; durationMs: number }
  | { status: 'failed'; durationMs: number; error: string };

@Injectable()
export class MatviewRefreshCoordinator {
  private readonly logger = new Logger(MatviewRefreshCoordinator.name);
  private readonly lockKey = 1_907_042_611;
  private failures = 0;
  private nextAllowedAt = 0;

  constructor(private readonly db: DataSource) {}

  async refresh(): Promise<MatviewRefreshResult> {
    const startedAt = Date.now();
    if (Date.now() < this.nextAllowedAt) {
      return { status: 'skipped_locked', durationMs: 0 };
    }

    const runner = this.db.createQueryRunner();
    let lockAcquired = false;
    try {
      await runner.connect();
      const [lock] = await runner.query(
        'SELECT pg_try_advisory_lock($1) AS acquired',
        [this.lockKey],
      );
      lockAcquired = Boolean(lock?.acquired);
      if (!lockAcquired) {
        return {
          status: 'skipped_locked',
          durationMs: Date.now() - startedAt,
        };
      }

      await runner.query('SELECT refresh_all_matviews()');
      this.failures = 0;
      this.nextAllowedAt = 0;
      return { status: 'completed', durationMs: Date.now() - startedAt };
    } catch (error) {
      this.failures += 1;
      const backoffMs = Math.min(30 * 60_000, 30_000 * 2 ** (this.failures - 1));
      this.nextAllowedAt = Date.now() + backoffMs;
      const message = error instanceof Error ? error.message : 'unknown refresh error';
      this.logger.warn(`Materialized-view refresh failed; backoff=${backoffMs}ms: ${message}`);
      return {
        status: 'failed',
        durationMs: Date.now() - startedAt,
        error: message,
      };
    } finally {
      if (lockAcquired) {
        try {
          await runner.query('SELECT pg_advisory_unlock($1)', [this.lockKey]);
        } catch {
          this.logger.warn('Could not explicitly release materialized-view advisory lock');
        }
      }
      await runner.release();
    }
  }
}
