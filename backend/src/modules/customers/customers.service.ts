import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService } from '../../cache/cache.service';

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
          to_char(date_trunc('month', synced_at), 'Mon') AS month,
          COUNT(*)                                        AS new_customers,
          COALESCE(AVG(ltv), 0)                          AS avg_ltv
        FROM customers
        WHERE tenant_id = $1
          AND synced_at >= NOW() - INTERVAL '12 months'
        GROUP BY date_trunc('month', synced_at)
        ORDER BY date_trunc('month', synced_at)
        `,
        [tenantId],
      );
    });
  }

  async getList(tenantId: string, filters: any) {
    const page   = parseInt(filters.page  || '1');
    const limit  = Math.min(parseInt(filters.limit || '50'), 200);
    const offset = (page - 1) * limit;
    const key    = `jtl:${tenantId}:customers:list:${page}:${limit}:${filters.search || ''}:${filters.segment || ''}`;
    return this.cache.getOrSet(key, 300, async () => {
      const conditions: string[] = ['tenant_id = $1'];
      const params: any[] = [tenantId, limit, offset];
      const countConditions: string[] = ['tenant_id = $1'];
      const countParams: any[] = [tenantId];

      if (filters.search) {
        params.push(`%${filters.search}%`);
        conditions.push(`(email ILIKE $${params.length} OR last_name ILIKE $${params.length} OR first_name ILIKE $${params.length})`);
        countParams.push(`%${filters.search}%`);
        countConditions.push(`(email ILIKE $${countParams.length} OR last_name ILIKE $${countParams.length} OR first_name ILIKE $${countParams.length})`);
      }
      if (filters.segment) {
        params.push(filters.segment);
        conditions.push(`segment = $${params.length}`);
        countParams.push(filters.segment);
        countConditions.push(`segment = $${countParams.length}`);
      }

      const where      = conditions.join(' AND ');
      const countWhere = countConditions.join(' AND ');

      const [rows, countResult] = await Promise.all([
        this.db.query(
          `
          SELECT
            id, jtl_customer_id,
            first_name, last_name, email, company,
            city, country_code, region, postcode,
            total_orders, total_revenue, ltv,
            segment, rfm_score,
            last_order_date, days_since_last_order
          FROM customers
          WHERE ${where}
          ORDER BY ltv DESC NULLS LAST
          LIMIT $2 OFFSET $3
          `,
          params,
        ),
        this.db.query(
          `SELECT COUNT(*)::int AS total FROM customers WHERE ${countWhere}`,
          countParams,
        ),
      ]);

      return { rows, total: countResult[0]?.total ?? 0, page, limit };
    });
  }

  async exportList(tenantId: string, filters: any): Promise<string> {
    const conditions: string[] = ['tenant_id = $1'];
    const params: any[] = [tenantId];
    if (filters.search) {
      params.push(`%${filters.search}%`);
      conditions.push(`(email ILIKE $${params.length} OR last_name ILIKE $${params.length} OR first_name ILIKE $${params.length})`);
    }
    if (filters.segment) {
      params.push(filters.segment);
      conditions.push(`segment = $${params.length}`);
    }
    const where = conditions.join(' AND ');
    const rows = await this.db.query(
      `
      SELECT first_name, last_name, email, company, city, country_code, region,
             total_orders, total_revenue, ltv, segment, rfm_score, last_order_date
      FROM customers
      WHERE ${where}
      ORDER BY ltv DESC NULLS LAST
      LIMIT 50000
      `,
      params,
    );
    const headers = ['First Name','Last Name','Email','Company','City','Country','Region','Orders','Revenue','LTV','Segment','RFM Score','Last Order'];
    const csvRows = rows.map((r: any) =>
      [r.first_name, r.last_name, r.email, r.company, r.city, r.country_code, r.region, r.total_orders, r.total_revenue, r.ltv, r.segment, r.rfm_score, r.last_order_date]
        .map((v: any) => (v == null ? '' : String(v).includes(',') ? `"${v}"` : v))
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
