import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService } from '../../cache/cache.service';
import { buildPaginatedResult } from '../../common/utils/pagination';
import { TenantScope } from '../../common/types/auth-request';
import { buildCsv, CsvColumn, CSV_EXPORT_MAX_ROWS } from '../../common/utils/csv-export';

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
  if (range === 'PREVIOUS_MONTH') {
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10),
      end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10),
    };
  }
  if (range === 'QUARTER' || range === 'PREVIOUS_QUARTER') {
    const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3 + (range === 'PREVIOUS_QUARTER' ? -3 : 0);
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1));
    return {
      start: startDate.toISOString().slice(0, 10),
      end: range === 'PREVIOUS_QUARTER' ? new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 3, 0)).toISOString().slice(0, 10) : end,
    };
  }
  if (range === 'YEAR') return { start: `${now.getUTCFullYear()}-01-01`, end };
  if (range === 'PREVIOUS_YEAR') { const year = now.getUTCFullYear() - 1; return { start: `${year}-01-01`, end: `${year}-12-31` }; }
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

@Injectable()
export class CustomersService {
  constructor(
    private readonly db: DataSource,
    private readonly cache: CacheService,
  ) {}

  async getKpis(scope: TenantScope, filters: CustomerFilters = {}) {
    const tenantId = scope.tenantIds;
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
         WHERE tenant_id = ANY($1::uuid[])`,
        [tenantId, start, end, prevStart, prevEnd],
      );
      const r = rows[0] || {};
      return {
        ...r,
        delta_new: pctDelta(Number(r.new_this_period), Number(r.new_prev_period)),
      };
    });
  }

  async getSegments(scope: TenantScope) {
    const tenantId = scope.tenantIds;
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
        WHERE tenant_id = ANY($1::uuid[])
        GROUP BY segment
        ORDER BY total_ltv DESC
        `,
        [tenantId],
      );
    });
  }

  async getMonthly(scope: TenantScope, filters: CustomerFilters = {}) {
    const tenantId = scope.tenantIds;
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
        WHERE tenant_id = ANY($1::uuid[])
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

  async getList(scope: TenantScope, filters: CustomerFilters) {
    const tenantId = scope.tenantIds;
    const page   = Math.max(1, parseInt(String(filters.page ?? '1'), 10) || 1);
    const limit  = Math.min(Math.max(1, parseInt(String(filters.limit ?? '50'), 10) || 50), CSV_EXPORT_MAX_ROWS);
    const offset = (page - 1) * limit;
    const searchTerm  = String(filters.search  || '').trim();
    const segmentTerm = String(filters.segment || '').trim();
    const { range = 'ALL', from, to } = filters;
    const { start, end } = dateRange(range, from, to);
    const key    = `jtl:${tenantId}:customers:list:${page}:${limit}:${searchTerm}:${segmentTerm}:${start}:${end}`;
    return this.cache.getOrSet(key, 300, async () => {
      // All user values go through parameterized $N placeholders — never interpolated
      const conditions: string[] = ['c.tenant_id = ANY($1::uuid[])'];
      const params: unknown[] = [tenantId, limit, offset];
      const countConditions: string[] = ['c.tenant_id = ANY($1::uuid[])'];
      const countParams: unknown[] = [tenantId];

      params.push(start, end);
      conditions.push(`(
        COALESCE(c.last_order_date, c.first_order_date) BETWEEN $${params.length - 1} AND $${params.length}
        OR ($${params.length - 1} = '2000-01-01' AND COALESCE(c.last_order_date, c.first_order_date) IS NULL)
      )`);
      countParams.push(start, end);
      countConditions.push(`(
        COALESCE(c.last_order_date, c.first_order_date) BETWEEN $${countParams.length - 1} AND $${countParams.length}
        OR ($${countParams.length - 1} = '2000-01-01' AND COALESCE(c.last_order_date, c.first_order_date) IS NULL)
      )`);

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

  async exportList(scope: TenantScope, filters: CustomerFilters): Promise<string> {
    const rows: Record<string, unknown>[] = [];
    let page = 1;
    let total = 0;

    for (;;) {
      const result = await this.getList(scope, { ...filters, page, limit: CSV_EXPORT_MAX_ROWS });
      const pageRows = result.rows as Record<string, unknown>[];
      rows.push(...pageRows);
      total = result.total;
      if (!result.has_next || rows.length >= total || pageRows.length === 0) break;
      page += 1;
    }

    const columns: CsvColumn<Record<string, unknown>>[] = [
      { key: 'first_name', header: 'First Name' },
      { key: 'last_name', header: 'Last Name' },
      { key: 'email', header: 'Email' },
      { key: 'company', header: 'Company' },
      { key: 'city', header: 'City' },
      { key: 'country_code', header: 'Country' },
      { key: 'region', header: 'Region' },
      { key: 'total_orders', header: 'Orders' },
      { key: 'total_revenue', header: 'Revenue' },
      { key: 'ltv', header: 'LTV' },
      { key: 'segment', header: 'Segment' },
      { key: 'rfm_score', header: 'RFM Score' },
      { key: 'last_order_date', header: 'Last Order' },
    ];

    return buildCsv(rows, columns, {
      metadata: {
        module: 'customers',
        total_matching_rows: total,
        exported_rows: rows.length,
        complete: rows.length >= total,
        generated_at: new Date().toISOString(),
      },
    });
  }

  async getTopByRevenue(scope: TenantScope) {
    const tenantId = scope.tenantIds;
    const key = `jtl:${tenantId}:customers:top`;
    return this.cache.getOrSet(key, 600, async () => {
      return this.db.query(
        `
        SELECT
          id, first_name, last_name, email, company,
          region, total_orders, total_revenue AS ltv,
          segment, last_order_date
        FROM customers
        WHERE tenant_id = ANY($1::uuid[]) AND total_revenue > 0
        ORDER BY total_revenue DESC
        LIMIT 20
        `,
        [tenantId],
      );
    });
  }
}
