import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class FeedbackReadService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  insights(tenantId: string, accountId: string, page = 1, limit = 50) {
    return this.page('marketplace_review_insights', tenantId, accountId, page, limit, 'source_period_end');
  }

  trends(tenantId: string, accountId: string, page = 1, limit = 100) {
    return this.page('marketplace_review_trends', tenantId, accountId, page, limit, 'period_start');
  }

  ratingAggregates(tenantId: string, accountId: string, page = 1, limit = 50) {
    return this.page('marketplace_rating_aggregates', tenantId, accountId, page, limit, 'source_updated_at');
  }

  private async page(table: string, tenantId: string, accountId: string, requestedPage: number,
    requestedLimit: number, sortColumn: string) {
    const page = Math.max(1, Number(requestedPage) || 1);
    const limit = Math.min(100, Math.max(1, Number(requestedLimit) || 50));
    const offset = (page - 1) * limit;
    const rows = await this.db.query(
      `SELECT *, COUNT(*) OVER()::int AS total_count FROM ${table}
       WHERE tenant_id = $1 AND marketplace_account_id = $2
       ORDER BY ${sortColumn} DESC NULLS LAST, id DESC LIMIT $3 OFFSET $4`,
      [tenantId, accountId, limit, offset],
    );
    return { rows, total: Number(rows[0]?.total_count || 0), page, limit };
  }
}
