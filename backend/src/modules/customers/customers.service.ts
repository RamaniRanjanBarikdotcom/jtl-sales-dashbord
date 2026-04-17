import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService } from '../../cache/cache.service';
import { buildPaginatedResult } from '../../common/utils/pagination';

type CustomerFilters = {
  page?: string | number;
  limit?: string | number;
  search?: string;
  segment?: string;
};

type CsvRow = Record<string, unknown>;

@Injectable()
export class CustomersService {
  constructor(
    private readonly db: DataSource,
    private readonly cache: CacheService,
  ) {}

  async getKpis(tenantId: string) {
    const key = `jtl:${tenantId}:customers:kpis`;
    return this.cache.getOrSet(key, 300, async () => {
      const rows = await this.db.query(
        `
        SELECT
          COUNT(*)                                                                          AS total_customers,
          COUNT(*) FILTER (WHERE first_order_date >= date_trunc('month', NOW()))          AS new_this_month,
          ROUND(COALESCE(AVG(ltv) FILTER (WHERE ltv > 0), 0)::numeric, 2)                AS avg_ltv,
          ROUND(COALESCE(AVG(total_orders) FILTER (WHERE total_orders > 0), 0)::numeric, 2) AS avg_orders
        FROM customers
        WHERE tenant_id = $1
        `,
        [tenantId],
      );
      return rows[0] || {};
    });
  }

  async getSegments(tenantId: string) {
    const key = `jtl:${tenantId}:customers:segments`;
    return this.cache.getOrSet(key, 300, async () => {
      return this.db.query(
        `
        SELECT
          COALESCE(segment, 'Unknown') AS name,
          COUNT(*)                     AS count,
          COALESCE(AVG(ltv), 0)        AS avg_ltv,
          COALESCE(SUM(ltv), 0)        AS total_ltv
        FROM customers
        WHERE tenant_id = $1
        GROUP BY segment
        ORDER BY total_ltv DESC
        `,
        [tenantId],
      );
    });
  }

  async getMonthly(tenantId: string) {
    const key = `jtl:${tenantId}:customers:monthly`;
    return this.cache.getOrSet(key, 600, async () => {
      return this.db.query(
        `
        SELECT
          to_char(date_trunc('month', first_order_date), 'YYYY-Mon') AS month,
          COUNT(*)                                                     AS new_customers,
          COALESCE(AVG(ltv), 0)                                       AS avg_ltv
        FROM customers
        WHERE tenant_id = $1
          AND first_order_date IS NOT NULL
          AND first_order_date >= (
            SELECT COALESCE(MAX(first_order_date), NOW()::date) - INTERVAL '24 months'
            FROM customers WHERE tenant_id = $1 AND first_order_date IS NOT NULL
          )
        GROUP BY date_trunc('month', first_order_date)
        ORDER BY date_trunc('month', first_order_date)
        LIMIT 24
        `,
        [tenantId],
      );
    });
  }

  async getList(tenantId: string, filters: CustomerFilters) {
    const page   = Math.max(1, parseInt(String(filters.page ?? '1'), 10) || 1);
    const limit  = Math.min(Math.max(1, parseInt(String(filters.limit ?? '50'), 10) || 50), 200);
    const offset = (page - 1) * limit;
    const searchTerm  = String(filters.search  || '').trim();
    const segmentTerm = String(filters.segment || '').trim();
    const key    = `jtl:${tenantId}:customers:list:${page}:${limit}:${searchTerm}:${segmentTerm}`;
    return this.cache.getOrSet(key, 300, async () => {
      // All user values go through parameterized $N placeholders — never interpolated
      const conditions: string[] = ['c.tenant_id = $1'];
      const params: unknown[] = [tenantId, limit, offset];
      const countConditions: string[] = ['c.tenant_id = $1'];
      const countParams: unknown[] = [tenantId];

      if (searchTerm) {
        params.push(`%${searchTerm}%`);
        conditions.push(`(c.email ILIKE $${params.length} OR c.last_name ILIKE $${params.length} OR c.first_name ILIKE $${params.length})`);
        countParams.push(`%${searchTerm}%`);
        countConditions.push(`(c.email ILIKE $${countParams.length} OR c.last_name ILIKE $${countParams.length} OR c.first_name ILIKE $${countParams.length})`);
      }
      if (segmentTerm) {
        params.push(segmentTerm);
        conditions.push(`c.segment = $${params.length}`);
        countParams.push(segmentTerm);
        countConditions.push(`c.segment = $${countParams.length}`);
      }

      const where      = conditions.join(' AND ');
      const countWhere = countConditions.join(' AND ');

      const [rows, countResult] = await Promise.all([
        this.db.query(
          `
          SELECT
            c.id, c.jtl_customer_id,
            c.first_name, c.last_name, c.email, c.company,
            c.city, c.country_code, c.region, c.postcode,
            c.total_orders, c.total_revenue, c.ltv,
            c.segment, c.rfm_score,
            c.last_order_date, c.days_since_last_order
          FROM customers c
          WHERE ${where}
          ORDER BY c.ltv DESC NULLS LAST
          LIMIT $2 OFFSET $3
          `,
          params,
        ),
        this.db.query(
          `SELECT COUNT(*)::int AS total FROM customers c WHERE ${countWhere}`,
          countParams,
        ),
      ]);

      return buildPaginatedResult(
        rows as Record<string, unknown>[],
        countResult[0]?.total,
        page,
        limit,
      );
    });
  }

  async exportList(tenantId: string, filters: CustomerFilters): Promise<string> {
    const searchTerm  = String(filters.search  || '').trim();
    const segmentTerm = String(filters.segment || '').trim();
    const conditions: string[] = ['c.tenant_id = $1'];
    const params: unknown[] = [tenantId];
    if (searchTerm) {
      params.push(`%${searchTerm}%`);
      conditions.push(`(c.email ILIKE $${params.length} OR c.last_name ILIKE $${params.length} OR c.first_name ILIKE $${params.length})`);
    }
    if (segmentTerm) {
      params.push(segmentTerm);
      conditions.push(`c.segment = $${params.length}`);
    }
    const where = conditions.join(' AND ');
    const rows = await this.db.query(
      `
      SELECT c.first_name, c.last_name, c.email, c.company, c.city, c.country_code, c.region,
             c.total_orders, c.total_revenue, c.ltv, c.segment, c.rfm_score, c.last_order_date
      FROM customers c
      WHERE ${where}
      ORDER BY c.ltv DESC NULLS LAST
      LIMIT 50000
      `,
      params,
    );
    const headers = ['First Name','Last Name','Email','Company','City','Country','Region','Orders','Revenue','LTV','Segment','RFM Score','Last Order'];
    const csvRows = (rows as CsvRow[]).map((r) =>
      [r.first_name, r.last_name, r.email, r.company, r.city, r.country_code, r.region, r.total_orders, r.total_revenue, r.ltv, r.segment, r.rfm_score, r.last_order_date]
        .map((v) => (v == null ? '' : String(v).includes(',') ? `"${v}"` : v))
        .join(',')
    );
    return [headers.join(','), ...csvRows].join('\n');
  }

  async getTopByRevenue(tenantId: string) {
    const key = `jtl:${tenantId}:customers:top`;
    return this.cache.getOrSet(key, 600, async () => {
      return this.db.query(
        `
        SELECT
          id, first_name, last_name, email, company,
          region, total_orders, total_revenue AS ltv,
          segment, last_order_date
        FROM customers
        WHERE tenant_id = $1 AND total_revenue > 0
        ORDER BY total_revenue DESC
        LIMIT 20
        `,
        [tenantId],
      );
    });
  }
}
