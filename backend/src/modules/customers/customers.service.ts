import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService } from '../../cache/cache.service';
import { buildPaginatedResult } from '../../common/utils/pagination';

type CustomerFilters = {
  range?: string;
  from?: string;
  to?: string;
  page?: string | number;
  limit?: string | number;
  search?: string;
  segment?: string;
};

function dateRange(range: string, from?: string, to?: string): { start: string; end: string } {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const end = to || todayStr;
  if (from) return { start: from, end };
  if (range === 'DAY') return { start: todayStr, end: todayStr };
  if (range === 'MONTH') {
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
    return { start: startOfMonth, end };
  }
  if (range === 'YEAR') return { start: `${now.getUTCFullYear()}-01-01`, end };
  if (range === 'TODAY')     return { start: todayStr, end: todayStr };
  if (range === 'YESTERDAY') { const y = new Date(now.getTime() - 86400000).toISOString().slice(0, 10); return { start: y, end: y }; }
  if (range === 'YTD') return { start: `${now.getFullYear()}-01-01`, end };
  if (range === 'ALL') return { start: '2000-01-01', end };
  const map: Record<string, number> = { '7D':7,'30D':30,'3M':90,'6M':180,'12M':365,'2Y':730,'5Y':1825 };
  return { start: new Date(now.getTime() - (map[range] ?? 365) * 86400000).toISOString().slice(0, 10), end };
}

function prevPeriod(start: string, end: string): { prevStart: string; prevEnd: string } {
  const s     = new Date(start).getTime();
  const e     = new Date(end).getTime();
  const shift = Math.min(e - s, 365 * 86400000);
  return {
    prevStart: new Date(s - shift).toISOString().slice(0, 10),
    prevEnd:   new Date(e - shift).toISOString().slice(0, 10),
  };
}

function pctDelta(current: number, prev: number): number | null {
  if (prev === 0 && current === 0) return 0;
  if (prev === 0) return null;
  return Math.round((current - prev) / prev * 1000) / 10;
}

type CsvRow = Record<string, unknown>;

@Injectable()
export class CustomersService {
  constructor(
    private readonly db: DataSource,
    private readonly cache: CacheService,
  ) {}

  async getKpis(tenantId: string, filters: CustomerFilters = {}) {
    const { range = 'ALL', from, to } = filters;
    const { start, end } = dateRange(range, from, to);
    const { prevStart, prevEnd } = prevPeriod(start, end);
    const key = `jtl:${tenantId}:customers:kpis:${range}:${start}:${end}`;
    return this.cache.getOrSet(key, 300, async () => {
      const rows = await this.db.query(
        `SELECT
           COUNT(*)                                                                                    AS total_customers,
           COUNT(*) FILTER (WHERE first_order_date BETWEEN $2 AND $3)                                AS new_this_period,
           COUNT(*) FILTER (WHERE first_order_date BETWEEN $4 AND $5)                                AS new_prev_period,
           ROUND(COALESCE(AVG(ltv) FILTER (WHERE ltv > 0), 0)::numeric, 2)                          AS avg_ltv,
           ROUND(COALESCE(AVG(total_orders) FILTER (WHERE total_orders > 0), 0)::numeric, 2)         AS avg_orders
         FROM customers
         WHERE tenant_id = $1`,
        [tenantId, start, end, prevStart, prevEnd],
      );
      const r = rows[0] || {};
      return {
        ...r,
        delta_new: pctDelta(Number(r.new_this_period), Number(r.new_prev_period)),
      };
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

  async getMonthly(tenantId: string, filters: CustomerFilters = {}) {
    const { range = 'ALL', from, to } = filters;
    const { start, end } = dateRange(range, from, to);
    const key = `jtl:${tenantId}:customers:monthly:${range}:${start}:${end}`;
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
          AND first_order_date BETWEEN $2 AND $3
        GROUP BY date_trunc('month', first_order_date)
        ORDER BY date_trunc('month', first_order_date)
        LIMIT 24
        `,
        [tenantId, start, end],
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
