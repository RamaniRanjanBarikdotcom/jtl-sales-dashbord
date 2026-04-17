import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService } from '../../cache/cache.service';
import { applyMasking } from '../../common/utils/masking';
import { buildPaginatedResult } from '../../common/utils/pagination';

type MarketingFilters = {
  range?: string;
  platform?: string;
  page?: string | number;
  limit?: string | number;
};

@Injectable()
export class MarketingService {
  constructor(
    private readonly db: DataSource,
    private readonly cache: CacheService,
  ) {}

  async getKpis(
    tenantId: string,
    filters: MarketingFilters,
    role: string,
    userLevel: string,
  ) {
    const key = `jtl:${tenantId}:marketing:kpis:${filters.range || '12M'}:${filters.platform || 'all'}`;
    return this.cache.getOrSet(key, 1800, async () => {
      const platform = String(filters.platform || '').trim();
      const params: unknown[] = [tenantId, platform];
      const rows = await this.db.query(
        `
        SELECT
          SUM(total_spend) AS total_spend,
          SUM(total_revenue) AS total_revenue,
          SUM(total_clicks) AS total_clicks,
          SUM(total_conversions) AS total_conversions,
          ROUND(SUM(total_revenue) / NULLIF(SUM(total_spend), 0), 4) AS avg_roas,
          ROUND(SUM(total_spend) / NULLIF(SUM(total_clicks), 0), 4) AS avg_cpc
        FROM mv_marketing_summary
        WHERE tenant_id = $1
          AND ($2 = '' OR platform = $2)
      `,
        params,
      );
      return applyMasking(rows[0] || {}, userLevel, role);
    });
  }

  async getChannels(
    tenantId: string,
    filters: MarketingFilters,
    role: string,
    userLevel: string,
  ) {
    const key = `jtl:${tenantId}:marketing:channels:${filters.range || '12M'}`;
    return this.cache.getOrSet(key, 1800, async () => {
      const rows = await this.db.query(
        `
        SELECT
          platform,
          SUM(total_spend) AS spend,
          SUM(total_revenue) AS revenue,
          ROUND(SUM(total_revenue) / NULLIF(SUM(total_spend), 0), 4) AS roas,
          SUM(total_conversions) AS conversions
        FROM mv_marketing_summary WHERE tenant_id = $1
        GROUP BY platform
        ORDER BY spend DESC
        LIMIT 100
      `,
        [tenantId],
      );
      return applyMasking(rows, userLevel, role);
    });
  }

  async getCampaigns(
    tenantId: string,
    filters: MarketingFilters,
    role: string,
    userLevel: string,
  ) {
    const page = Math.max(1, Number.parseInt(String(filters.page ?? '1'), 10) || 1);
    const limit = Math.min(
      Math.max(1, Number.parseInt(String(filters.limit ?? '20'), 10) || 20),
      100,
    );
    const offset = (page - 1) * limit;
    const key = `jtl:${tenantId}:marketing:campaigns:${page}:${limit}`;
    return this.cache.getOrSet(key, 1800, async () => {
      const [rows, countRows] = await Promise.all([
        this.db.query(
          `
          SELECT
            c.id,
            c.name,
            c.platform,
            c.status,
            COALESCE(SUM(m.spend), 0) AS spend,
            COALESCE(SUM(m.conversion_value), 0) AS revenue,
            COALESCE(SUM(m.conversions), 0) AS conversions,
            ROUND(SUM(m.conversion_value) / NULLIF(SUM(m.spend), 0), 4) AS roas
          FROM marketing_campaigns c
          LEFT JOIN marketing_metrics m ON m.campaign_id = c.id AND m.tenant_id = c.tenant_id
          WHERE c.tenant_id = $1
          GROUP BY c.id, c.name, c.platform, c.status
          ORDER BY spend DESC NULLS LAST
          LIMIT $2 OFFSET $3
        `,
          [tenantId, limit, offset],
        ),
        this.db.query(
          `
          SELECT COUNT(*)::int AS total
          FROM marketing_campaigns
          WHERE tenant_id = $1
          `,
          [tenantId],
        ),
      ]);
      const maskedRows = applyMasking(rows, userLevel, role) as Record<string, unknown>[];
      return buildPaginatedResult(maskedRows, countRows[0]?.total, page, limit);
    });
  }

  async getRoasTrend(
    tenantId: string,
    filters: MarketingFilters,
    role: string,
    userLevel: string,
  ) {
    const key = `jtl:${tenantId}:marketing:roas-trend:${filters.range || '12M'}`;
    return this.cache.getOrSet(key, 1800, async () => {
      const rows = await this.db.query(
        `
        SELECT month, platform, roas, cpc, total_spend
        FROM mv_marketing_summary WHERE tenant_id = $1
        ORDER BY month, platform
        LIMIT 5000
      `,
        [tenantId],
      );
      return applyMasking(rows, userLevel, role);
    });
  }
}
