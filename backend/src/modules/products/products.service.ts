import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService } from '../../cache/cache.service';
import { applyMasking } from '../../common/utils/masking';
import { buildPaginatedResult } from '../../common/utils/pagination';

type ProductFilters = {
  range?: string;
  from?: string;
  to?: string;
  page?: string | number;
  limit?: string | number;
  sort?: string;
  order?: string;
  search?: string;
  category?: string;
};

type CsvRow = Record<string, unknown>;

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
  const days = map[range] ?? 365;
  return { start: new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10), end };
}

function prevPeriod(start: string, end: string) {
  const s     = new Date(start).getTime();
  const e     = new Date(end).getTime();
  const shift = Math.min(e - s, 365 * 86400000);
  return {
    prevStart: new Date(s - shift).toISOString().slice(0, 10),
    prevEnd:   new Date(e - shift).toISOString().slice(0, 10),
  };
}

function pctDelta(cur: number, prev: number): number | null {
  if (cur === 0 && prev === 0) return 0;
  return prev > 0 ? Math.round((cur - prev) / prev * 1000) / 10 : null;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly db: DataSource,
    private readonly cache: CacheService,
  ) {}

  async getKpis(tenantId: string, filters: ProductFilters, role: string, userLevel: string) {
    const { range = 'ALL', from, to } = filters || {};
    const { start, end } = dateRange(range, from, to);
    const { prevStart, prevEnd } = prevPeriod(start, end);
    const key = `jtl:${tenantId}:products:kpis:${range}:${start}:${end}`;
    return this.cache.getOrSet(key, 300, async () => {
      const rows = await this.db.query(
        `WITH catalog AS (
           SELECT
             COUNT(*)                                                                   AS total_products,
             COUNT(*) FILTER (WHERE is_active = true)                                  AS active_products,
             ROUND(COALESCE(SUM(stock_quantity * COALESCE(NULLIF(unit_cost,0), NULLIF(list_price_net,0), 0)), 0)::numeric, 2) AS total_stock_value
           FROM products WHERE tenant_id = $1
         ),
         cur_margin AS (
           SELECT ROUND(COALESCE(AVG(
             CASE WHEN oi.unit_price_net > 0
                   AND COALESCE(NULLIF(oi.unit_cost,0), p.unit_cost, 0) > 0
                  THEN (oi.unit_price_net - COALESCE(NULLIF(oi.unit_cost,0), p.unit_cost))
                       / oi.unit_price_net * 100
                  ELSE NULL END
           ), 0)::numeric, 2) AS avg_margin
           FROM order_items oi
           JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
           LEFT JOIN products p ON p.jtl_product_id = oi.product_id AND p.tenant_id = oi.tenant_id
           WHERE oi.tenant_id = $1 AND o.order_date BETWEEN $2 AND $3
             AND o.status NOT IN ('cancelled') AND oi.unit_price_net > 0
         ),
         prev_margin AS (
           SELECT ROUND(COALESCE(AVG(
             CASE WHEN oi.unit_price_net > 0
                   AND COALESCE(NULLIF(oi.unit_cost,0), p.unit_cost, 0) > 0
                  THEN (oi.unit_price_net - COALESCE(NULLIF(oi.unit_cost,0), p.unit_cost))
                       / oi.unit_price_net * 100
                  ELSE NULL END
           ), 0)::numeric, 2) AS avg_margin
           FROM order_items oi
           JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
           LEFT JOIN products p ON p.jtl_product_id = oi.product_id AND p.tenant_id = oi.tenant_id
           WHERE oi.tenant_id = $1 AND o.order_date BETWEEN $4 AND $5
             AND o.status NOT IN ('cancelled') AND oi.unit_price_net > 0
         ),
         top_prod AS (
           SELECT product_id, SUM(oi.line_total_gross) AS rev
           FROM order_items oi
           JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
           WHERE oi.tenant_id = $1 AND o.order_date BETWEEN $2 AND $3
             AND o.status NOT IN ('cancelled')
           GROUP BY product_id ORDER BY rev DESC LIMIT 1
         ),
         cur_top AS (
           SELECT COALESCE(SUM(oi.line_total_gross), 0) AS top_product_revenue
           FROM order_items oi
           JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
           JOIN top_prod tp ON tp.product_id = oi.product_id
           WHERE oi.tenant_id = $1 AND o.order_date BETWEEN $2 AND $3
             AND o.status NOT IN ('cancelled')
         ),
         prev_top AS (
           SELECT COALESCE(SUM(oi.line_total_gross), 0) AS top_product_revenue
           FROM order_items oi
           JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
           JOIN top_prod tp ON tp.product_id = oi.product_id
           WHERE oi.tenant_id = $1 AND o.order_date BETWEEN $4 AND $5
             AND o.status NOT IN ('cancelled')
         )
         SELECT
           c.total_products, c.active_products, c.total_stock_value,
           cm.avg_margin AS cur_margin, pm.avg_margin AS prev_margin,
           ct.top_product_revenue AS cur_top_rev, pt.top_product_revenue AS prev_top_rev
         FROM catalog c, cur_margin cm, prev_margin pm, cur_top ct, prev_top pt`,
        [tenantId, start, end, prevStart, prevEnd],
      );

      const r = rows[0] || {};
      const curTopRev  = parseFloat(r.cur_top_rev)  || 0;
      const prevTopRev = parseFloat(r.prev_top_rev) || 0;
      const curMargin  = parseFloat(r.cur_margin)   || 0;
      const prevMargin = parseFloat(r.prev_margin)  || 0;

      const result = {
        total_products:      r.total_products,
        active_products:     r.active_products,
        total_stock_value:   r.total_stock_value,
        avg_margin:          curMargin,
        top_product_revenue: curTopRev,
        top_product_delta:   pctDelta(curTopRev,  prevTopRev),
        avg_margin_delta:    pctDelta(curMargin,  prevMargin),
      };
      return applyMasking(result, userLevel, role);
    });
  }

  async getList(tenantId: string, filters: ProductFilters, role: string, userLevel: string) {
    const page      = Math.max(1, Number.parseInt(String(filters.page ?? '1'), 10) || 1);
    const limit     = Math.min(
      Math.max(1, Number.parseInt(String(filters.limit ?? '50'), 10) || 50),
      200,
    );
    const offset    = (page - 1) * limit;
    // Strict whitelist map: user input key → safe SQL column identifier
    const SORT_MAP: Record<string, string> = {
      total_revenue: 'total_revenue',
      total_units: 'total_units',
      margin_pct: 'margin_pct',
      name: 'name',
      stock_quantity: 'stock_quantity',
      list_price_gross: 'list_price_gross',
    };
    const sortField = SORT_MAP[String(filters.sort || '').trim().toLowerCase()] ?? 'total_revenue';
    const sortDir   = String(filters.order || '').trim().toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const searchTerm = String(filters.search || '').trim();
    const categoryTerm = String(filters.category || '').trim();
    const { start, end } = dateRange(filters.range || 'ALL', filters.from, filters.to);
    const { prevStart, prevEnd } = prevPeriod(start, end);

    const key = `jtl:${tenantId}:products:list:${page}:${limit}:${sortField}:${sortDir}:${searchTerm}:${categoryTerm}:${start}:${end}`;
    return this.cache.getOrSet(key, 300, async () => {
    const params: unknown[] = [
        tenantId,
        limit,
        offset,
        start,
        end,
        prevStart,
        prevEnd,
        searchTerm,
        categoryTerm,
        sortField,
        sortDir,
      ];
      const countParams: unknown[] = [tenantId, searchTerm, categoryTerm];

      const [rows, countResult] = await Promise.all([
        this.db.query(
          `
          SELECT
            p.id,
            p.jtl_product_id,
            p.article_number,
            p.name,
            p.list_price_gross,
            p.list_price_net,
            p.unit_cost,
            p.stock_quantity,
            p.is_active,
            p.ean,
            c.name AS category_name,
            COALESCE(rev.total_revenue, 0)      AS total_revenue,
            COALESCE(rev.total_units, 0)        AS total_units,
            COALESCE(prev.total_revenue, 0)     AS prev_revenue,
            CASE
              WHEN p.list_price_net > 0 AND p.unit_cost > 0
              THEN ROUND((p.list_price_net - p.unit_cost) / p.list_price_net * 100)
              ELSE 0
            END AS margin_pct
          FROM products p
          LEFT JOIN categories c
            ON c.jtl_category_id = p.category_id AND c.tenant_id = p.tenant_id
          LEFT JOIN (
            SELECT oi.product_id,
              SUM(oi.line_total_gross) AS total_revenue,
              SUM(oi.quantity)         AS total_units
            FROM order_items oi
            JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
            WHERE oi.tenant_id = $1 AND o.order_date BETWEEN $4 AND $5
              AND o.status NOT IN ('cancelled')
            GROUP BY oi.product_id
          ) rev ON rev.product_id = p.jtl_product_id
          LEFT JOIN (
            SELECT oi.product_id,
              SUM(oi.line_total_gross) AS total_revenue
            FROM order_items oi
            JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
            WHERE oi.tenant_id = $1 AND o.order_date BETWEEN $6 AND $7
              AND o.status NOT IN ('cancelled')
            GROUP BY oi.product_id
          ) prev ON prev.product_id = p.jtl_product_id
          WHERE p.tenant_id = $1
            AND (
              $8 = ''
              OR p.name ILIKE '%' || $8 || '%'
              OR p.article_number ILIKE '%' || $8 || '%'
            )
            AND (
              $9 = ''
              OR COALESCE(c.name, 'Uncategorized') = $9
            )
          ORDER BY
            CASE WHEN $10 = 'name' AND $11 = 'ASC' THEN p.name END ASC NULLS LAST,
            CASE WHEN $10 = 'name' AND $11 = 'DESC' THEN p.name END DESC NULLS LAST,
            CASE WHEN $10 = 'stock_quantity' AND $11 = 'ASC' THEN p.stock_quantity END ASC NULLS LAST,
            CASE WHEN $10 = 'stock_quantity' AND $11 = 'DESC' THEN p.stock_quantity END DESC NULLS LAST,
            CASE WHEN $10 = 'list_price_gross' AND $11 = 'ASC' THEN p.list_price_gross END ASC NULLS LAST,
            CASE WHEN $10 = 'list_price_gross' AND $11 = 'DESC' THEN p.list_price_gross END DESC NULLS LAST,
            CASE WHEN $10 = 'total_revenue' AND $11 = 'ASC' THEN COALESCE(rev.total_revenue, 0) END ASC NULLS LAST,
            CASE WHEN $10 = 'total_revenue' AND $11 = 'DESC' THEN COALESCE(rev.total_revenue, 0) END DESC NULLS LAST,
            CASE WHEN $10 = 'total_units' AND $11 = 'ASC' THEN COALESCE(rev.total_units, 0) END ASC NULLS LAST,
            CASE WHEN $10 = 'total_units' AND $11 = 'DESC' THEN COALESCE(rev.total_units, 0) END DESC NULLS LAST,
            CASE
              WHEN $10 = 'margin_pct' AND $11 = 'ASC' THEN
                CASE
                  WHEN p.list_price_net > 0 AND p.unit_cost > 0
                  THEN ROUND((p.list_price_net - p.unit_cost) / p.list_price_net * 100)
                  ELSE 0
                END
            END ASC NULLS LAST,
            CASE
              WHEN $10 = 'margin_pct' AND $11 = 'DESC' THEN
                CASE
                  WHEN p.list_price_net > 0 AND p.unit_cost > 0
                  THEN ROUND((p.list_price_net - p.unit_cost) / p.list_price_net * 100)
                  ELSE 0
                END
            END DESC NULLS LAST,
            p.id DESC
          LIMIT $2 OFFSET $3
          `,
          params,
        ),
        this.db.query(
          `
          SELECT COUNT(*)::int AS total
          FROM products p
          LEFT JOIN categories c
            ON c.jtl_category_id = p.category_id AND c.tenant_id = p.tenant_id
          WHERE p.tenant_id = $1
            AND (
              $2 = ''
              OR p.name ILIKE '%' || $2 || '%'
              OR p.article_number ILIKE '%' || $2 || '%'
            )
            AND (
              $3 = ''
              OR COALESCE(c.name, 'Uncategorized') = $3
            )
          `,
          countParams,
        ),
      ]);

      const maskedRows = applyMasking(rows, userLevel, role) as Record<string, unknown>[];
      return buildPaginatedResult(maskedRows, countResult[0]?.total, page, limit);
    });
  }

  async exportList(tenantId: string, filters: ProductFilters, role: string, userLevel: string): Promise<string> {
    const SORT_MAP: Record<string, string> = {
      total_revenue: 'total_revenue', total_units: 'total_units', margin_pct: 'margin_pct',
      name: 'name', stock_quantity: 'stock_quantity', list_price_gross: 'list_price_gross',
    };
    const sortField = SORT_MAP[String(filters.sort || '').trim().toLowerCase()] ?? 'total_revenue';
    const sortDir   = String(filters.order || '').trim().toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const searchTerm = String(filters.search || '').trim();
    const params: unknown[] = [tenantId, searchTerm, sortField, sortDir];

    const rows = await this.db.query(
      `
      SELECT
        p.article_number, p.name,
        c.name AS category_name,
        p.list_price_gross, p.list_price_net, p.unit_cost, p.stock_quantity,
        COALESCE(rev.total_revenue, 0) AS total_revenue,
        COALESCE(rev.total_units, 0)   AS total_units,
        CASE
          WHEN p.list_price_net > 0 AND p.unit_cost > 0
          THEN ROUND((p.list_price_net - p.unit_cost) / p.list_price_net * 100)
          ELSE 0
        END AS margin_pct
      FROM products p
      LEFT JOIN categories c ON c.jtl_category_id = p.category_id AND c.tenant_id = p.tenant_id  /* p.category_id stores jtl_category_id */
      LEFT JOIN (
        SELECT oi.product_id, SUM(oi.line_total_gross) AS total_revenue, SUM(oi.quantity) AS total_units
        FROM order_items oi
        JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
        WHERE oi.tenant_id = $1 AND o.status NOT IN ('cancelled')
        GROUP BY oi.product_id
      ) rev ON rev.product_id = p.jtl_product_id
      WHERE p.tenant_id = $1
        AND (
          $2 = ''
          OR p.name ILIKE '%' || $2 || '%'
          OR p.article_number ILIKE '%' || $2 || '%'
        )
      ORDER BY
        CASE WHEN $3 = 'name' AND $4 = 'ASC' THEN p.name END ASC NULLS LAST,
        CASE WHEN $3 = 'name' AND $4 = 'DESC' THEN p.name END DESC NULLS LAST,
        CASE WHEN $3 = 'stock_quantity' AND $4 = 'ASC' THEN p.stock_quantity END ASC NULLS LAST,
        CASE WHEN $3 = 'stock_quantity' AND $4 = 'DESC' THEN p.stock_quantity END DESC NULLS LAST,
        CASE WHEN $3 = 'list_price_gross' AND $4 = 'ASC' THEN p.list_price_gross END ASC NULLS LAST,
        CASE WHEN $3 = 'list_price_gross' AND $4 = 'DESC' THEN p.list_price_gross END DESC NULLS LAST,
        CASE WHEN $3 = 'total_revenue' AND $4 = 'ASC' THEN COALESCE(rev.total_revenue, 0) END ASC NULLS LAST,
        CASE WHEN $3 = 'total_revenue' AND $4 = 'DESC' THEN COALESCE(rev.total_revenue, 0) END DESC NULLS LAST,
        CASE WHEN $3 = 'total_units' AND $4 = 'ASC' THEN COALESCE(rev.total_units, 0) END ASC NULLS LAST,
        CASE WHEN $3 = 'total_units' AND $4 = 'DESC' THEN COALESCE(rev.total_units, 0) END DESC NULLS LAST,
        CASE
          WHEN $3 = 'margin_pct' AND $4 = 'ASC' THEN
            CASE
              WHEN p.list_price_net > 0 AND p.unit_cost > 0
              THEN ROUND((p.list_price_net - p.unit_cost) / p.list_price_net * 100)
              ELSE 0
            END
        END ASC NULLS LAST,
        CASE
          WHEN $3 = 'margin_pct' AND $4 = 'DESC' THEN
            CASE
              WHEN p.list_price_net > 0 AND p.unit_cost > 0
              THEN ROUND((p.list_price_net - p.unit_cost) / p.list_price_net * 100)
              ELSE 0
            END
        END DESC NULLS LAST,
        p.id DESC
      LIMIT 50000
      `,
      params,
    );

    const masked = applyMasking(rows, userLevel, role);
    const headers = ['Article Number','Name','Category','Price (Gross)','Price (Net)','Cost','Stock','Revenue','Units Sold','Margin %'];
    const csvRows = (masked as CsvRow[]).map((r) =>
      [r.article_number, r.name, r.category_name, r.list_price_gross, r.list_price_net, r.unit_cost, r.stock_quantity, r.total_revenue, r.total_units, r.margin_pct]
        .map((v) => (v == null ? '' : String(v).includes(',') ? `"${v}"` : v))
        .join(',')
    );
    return [headers.join(','), ...csvRows].join('\n');
  }

  async getCategories(tenantId: string, filters?: ProductFilters) {
    const { start, end } = dateRange((filters?.range || 'ALL'), filters?.from, filters?.to);
    const key = `jtl:${tenantId}:products:categories:${start}:${end}`;
    return this.cache.getOrSet(key, 300, async () => {
      return this.db.query(
        `
        SELECT
          COALESCE(c.name, 'Uncategorized') AS name,
          COUNT(DISTINCT p.id)              AS product_count,
          COALESCE(SUM(rev.total_revenue), 0) AS total_revenue,
          COALESCE(SUM(p.stock_quantity * p.list_price_net), 0) AS stock_value
        FROM products p
        LEFT JOIN categories c
          ON c.jtl_category_id = p.category_id AND c.tenant_id = p.tenant_id
        LEFT JOIN (
          SELECT oi.product_id, SUM(oi.line_total_gross) AS total_revenue
          FROM order_items oi
          JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
          WHERE oi.tenant_id = $1
            AND o.order_date BETWEEN $2 AND $3
            AND o.status NOT IN ('cancelled')
          GROUP BY oi.product_id
        ) rev ON rev.product_id = p.jtl_product_id
        WHERE p.tenant_id = $1
        GROUP BY c.name
        ORDER BY total_revenue DESC NULLS LAST
        LIMIT 500
        `,
        [tenantId, start, end],
      );
    });
  }

  async getTop(tenantId: string, filters: ProductFilters, role: string, userLevel: string) {
    const limit = Math.min(parseInt(String(filters.limit ?? '10'), 10), 100);
    const { start, end } = dateRange(filters.range || 'ALL', filters.from, filters.to);
    const key   = `jtl:${tenantId}:products:top:${limit}:${start}:${end}`;
    return this.cache.getOrSet(key, 300, async () => {
      const rows = await this.db.query(
        `
        SELECT
          p.id          AS product_id,
          p.name,
          p.article_number,
          p.stock_quantity,
          COALESCE(rev.total_revenue, 0) AS total_revenue,
          COALESCE(rev.total_units, 0)   AS total_units,
          CASE
            WHEN p.list_price_net > 0 AND p.unit_cost > 0
            THEN ROUND((p.list_price_net - p.unit_cost) / p.list_price_net * 100)
            ELSE 0
          END AS margin_pct
        FROM products p
        LEFT JOIN (
          SELECT oi.product_id,
            SUM(oi.line_total_gross) AS total_revenue,
            SUM(oi.quantity)         AS total_units
          FROM order_items oi
          JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
          WHERE oi.tenant_id = $1
            AND o.order_date BETWEEN $3 AND $4
            AND o.status NOT IN ('cancelled')
          GROUP BY oi.product_id
        ) rev ON rev.product_id = p.jtl_product_id
        WHERE p.tenant_id = $1
        ORDER BY total_revenue DESC NULLS LAST
        LIMIT $2
        `,
        [tenantId, limit, start, end],
      );
      return applyMasking(rows, userLevel, role);
    });
  }
}
