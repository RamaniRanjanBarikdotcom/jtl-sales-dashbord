import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService } from '../../cache/cache.service';
import { applyMasking } from '../../common/utils/masking';
import { buildPaginatedResult } from '../../common/utils/pagination';

type SalesFilters = {
  range?: string;
  from?: string;
  to?: string;
  orderNumber?: string;
  sku?: string;
  status?: string;
  page?: string | number;
  limit?: string | number;
};

type RevenueRow = Record<string, unknown>;
type RegionalRow = { region_name: string; revenue: string; orders: string; customers?: string };
type CityRow = { city: string; country: string; orders: string; revenue: string };

function dateRange(
  range: string,
  from?: string,
  to?: string,
): { start: string; end: string } {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const end = to || todayStr;
  if (from) return { start: from, end };

  if (range === 'TODAY') {
    return { start: todayStr, end: todayStr };
  }
  if (range === 'YESTERDAY') {
    const y = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    return { start: y, end: y };
  }
  if (range === 'YTD') {
    return { start: `${now.getFullYear()}-01-01`, end };
  }
  if (range === 'ALL') {
    return { start: '2000-01-01', end };
  }
  const map: Record<string, number> = {
    '7D': 7, '30D': 30, '3M': 90, '6M': 180, '12M': 365, '2Y': 730, '5Y': 1825,
  };
  const days = map[range] ?? 365;
  const start = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  return { start, end };
}

/** Shift the window back to get the comparison period.
 *  Periods ≤ 1 year → shift by the same duration (period-over-period).
 *  Periods > 1 year → shift by exactly 1 year (year-over-year) so there is always data. */
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
  if (prev === 0 && current === 0) return 0;   // no change — both zero
  if (!prev) return null;                       // can't compute % from zero base
  return Math.round((current - prev) / prev * 1000) / 10;
}

@Injectable()
export class SalesService {
  constructor(
    private readonly db: DataSource,
    private readonly cache: CacheService,
  ) {}

  async getKpis(
    tenantId: string,
    filters: SalesFilters,
    role: string,
    userLevel: string,
  ) {
    const { range = 'ALL', from, to, status = '' } = filters;
    const { start, end } = dateRange(range, from, to);
    const { prevStart, prevEnd } = prevPeriod(start, end);
    const statusFilter = String(status).trim();
    const key = `jtl:${tenantId}:sales:kpis:${range}:${start}:${end}:${statusFilter}`;
    return this.cache.getOrSet(key, 60, async () => {

      if (statusFilter) {
        // Status filter specified — query orders table directly, bypass matview
        const kpiSql = `
          SELECT
            COALESCE(SUM(gross_revenue), 0)                                           AS total_revenue,
            COUNT(*)                                                                   AS total_orders,
            COALESCE(ROUND(AVG(gross_revenue)::numeric, 2), 0)                       AS avg_order_value,
            0                                                                          AS total_returns,
            0                                                                          AS return_rate
          FROM orders
          WHERE tenant_id = $1 AND order_date BETWEEN $2 AND $3 AND status = $4`;
        const marginSql = `
          WITH item_margin AS (
            SELECT AVG(
              CASE
                WHEN oi.unit_price_net > 0
                  AND COALESCE(NULLIF(oi.unit_cost, 0), p.unit_cost, 0) > 0
                THEN (oi.unit_price_net - COALESCE(NULLIF(oi.unit_cost, 0), p.unit_cost))
                     / oi.unit_price_net * 100
                ELSE NULL END
            ) AS v
            FROM order_items oi
            JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
            LEFT JOIN products p ON p.jtl_product_id = oi.product_id AND p.tenant_id = oi.tenant_id
            WHERE oi.tenant_id = $1 AND o.order_date BETWEEN $2 AND $3
              AND o.status = $4 AND oi.unit_price_net > 0
          ),
          order_margin AS (
            SELECT AVG(NULLIF(o.gross_margin, 0)) AS v
            FROM orders o
            WHERE o.tenant_id = $1 AND o.order_date BETWEEN $2 AND $3 AND o.status = $4
          )
          SELECT ROUND(COALESCE(NULLIF((SELECT v FROM item_margin), 0), NULLIF((SELECT v FROM order_margin), 0), 0)::numeric, 2) AS avg_margin`;

        const [kpiRow, prevKpiRow, marginRow, prevMarginRow] = await Promise.all([
          this.db.query(kpiSql,    [tenantId, start,     end,     statusFilter]),
          this.db.query(kpiSql,    [tenantId, prevStart, prevEnd, statusFilter]),
          this.db.query(marginSql, [tenantId, start,     end,     statusFilter]),
          this.db.query(marginSql, [tenantId, prevStart, prevEnd, statusFilter]),
        ]);
        const cur = kpiRow[0] || {};
        const prev = prevKpiRow[0] || {};
        const curRevenue = parseFloat(cur.total_revenue) || 0;
        const curOrders  = parseFloat(cur.total_orders)  || 0;
        const curAov     = parseFloat(cur.avg_order_value) || 0;
        const curMargin  = parseFloat(marginRow[0]?.avg_margin) || 0;
        const combined = {
          ...cur,
          avg_margin:        curMargin,
          revenue_delta:     pctDelta(curRevenue, parseFloat(prev.total_revenue) || 0),
          orders_delta:      pctDelta(curOrders,  parseFloat(prev.total_orders)  || 0),
          aov_delta:         pctDelta(curAov,     parseFloat(prev.avg_order_value) || 0),
          margin_delta:      pctDelta(curMargin,  parseFloat(prevMarginRow[0]?.avg_margin) || 0),
          cancelled_orders:  0,
          cancelled_revenue: 0,
          returned_orders:   0,
          returned_revenue:  0,
        };
        return applyMasking(combined, userLevel, role);
      }

      // No status filter — fast path via matview
      const kpiSql = `
        SELECT
          COALESCE(SUM(total_revenue), 0)               AS total_revenue,
          COALESCE(SUM(total_orders), 0)                AS total_orders,
          COALESCE(ROUND(AVG(avg_order_value)::numeric, 2), 0) AS avg_order_value,
          COALESCE(SUM(total_returns), 0)               AS total_returns,
          COALESCE(AVG(return_rate), 0)                 AS return_rate
        FROM mv_daily_summary
        WHERE tenant_id = $1 AND summary_date BETWEEN $2 AND $3`;
      const marginSql = `
        WITH item_margin AS (
          SELECT AVG(
            CASE
              WHEN oi.unit_price_net > 0
                AND COALESCE(NULLIF(oi.unit_cost, 0), p.unit_cost, 0) > 0
              THEN (oi.unit_price_net - COALESCE(NULLIF(oi.unit_cost, 0), p.unit_cost))
                   / oi.unit_price_net * 100
              ELSE NULL END
          ) AS v
          FROM order_items oi
          JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
          LEFT JOIN products p ON p.jtl_product_id = oi.product_id AND p.tenant_id = oi.tenant_id
          WHERE oi.tenant_id = $1
            AND o.order_date BETWEEN $2 AND $3
            AND o.status != 'cancelled'
            AND oi.unit_price_net > 0
        ),
        order_margin AS (
          SELECT AVG(NULLIF(o.gross_margin, 0)) AS v
          FROM orders o
          WHERE o.tenant_id = $1
            AND o.order_date BETWEEN $2 AND $3
            AND o.status != 'cancelled'
        )
        SELECT ROUND(
          COALESCE(
            NULLIF((SELECT v FROM item_margin), 0),
            NULLIF((SELECT v FROM order_margin), 0),
            0
          )::numeric,
          2
        ) AS avg_margin`;
      const statusSql = `
        SELECT
          COUNT(*) FILTER (WHERE status = 'cancelled')::int  AS cancelled_orders,
          COALESCE(SUM(gross_revenue) FILTER (WHERE status = 'cancelled'), 0) AS cancelled_revenue,
          COUNT(*) FILTER (WHERE status = 'returned')::int   AS returned_orders,
          COALESCE(SUM(gross_revenue) FILTER (WHERE status = 'returned'), 0)  AS returned_revenue
        FROM orders
        WHERE tenant_id = $1 AND order_date BETWEEN $2 AND $3`;

      const [kpiRow, prevKpiRow, marginRow, prevMarginRow, statusRow] = await Promise.all([
        this.db.query(kpiSql,    [tenantId, start,     end    ]),
        this.db.query(kpiSql,    [tenantId, prevStart, prevEnd]),
        this.db.query(marginSql, [tenantId, start,     end    ]),
        this.db.query(marginSql, [tenantId, prevStart, prevEnd]),
        this.db.query(statusSql, [tenantId, start,     end    ]),
      ]);
      const cur  = kpiRow[0]     || {};
      const prev = prevKpiRow[0] || {};
      const stat = statusRow[0]  || {};
      const curRevenue  = parseFloat(cur.total_revenue)  || 0;
      const curOrders   = parseFloat(cur.total_orders)   || 0;
      const curAov      = parseFloat(cur.avg_order_value) || 0;
      const curMargin   = parseFloat(marginRow[0]?.avg_margin) || 0;
      const prevRevenue = parseFloat(prev.total_revenue) || 0;
      const prevOrders  = parseFloat(prev.total_orders)  || 0;
      const prevAov     = parseFloat(prev.avg_order_value) || 0;
      const prevMargin  = parseFloat(prevMarginRow[0]?.avg_margin) || 0;
      const combined = {
        ...cur,
        avg_margin:         curMargin,
        revenue_delta:      pctDelta(curRevenue,  prevRevenue),
        orders_delta:       pctDelta(curOrders,   prevOrders),
        aov_delta:          pctDelta(curAov,      prevAov),
        margin_delta:       pctDelta(curMargin,   prevMargin),
        cancelled_orders:   parseInt(stat.cancelled_orders, 10) || 0,
        cancelled_revenue:  parseFloat(stat.cancelled_revenue) || 0,
        returned_orders:    parseInt(stat.returned_orders, 10) || 0,
        returned_revenue:   parseFloat(stat.returned_revenue) || 0,
      };
      return applyMasking(combined, userLevel, role);
    });
  }

  async getRevenue(
    tenantId: string,
    filters: SalesFilters,
    role: string,
    userLevel: string,
  ) {
    const { range = 'ALL', from, to, status = '' } = filters;
    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const key = `jtl:${tenantId}:sales:revenue:${range}:${start}:${end}:${statusFilter}`;
    return this.cache.getOrSet(key, 900, async () => {
      if (statusFilter) {
        const rows = await this.db.query(
          `SELECT DATE_TRUNC('month', order_date)::date AS year_month,
                  COALESCE(SUM(gross_revenue), 0)                       AS total_revenue,
                  COUNT(*)                                               AS total_orders,
                  COALESCE(ROUND(AVG(gross_revenue)::numeric, 2), 0)    AS avg_order_value,
                  0 AS avg_margin, 0 AS total_returns,
                  COUNT(DISTINCT customer_number)                        AS unique_customers
           FROM orders
           WHERE tenant_id = $1 AND order_date BETWEEN $2 AND $3 AND status = $4
           GROUP BY year_month ORDER BY year_month LIMIT 1200`,
          [tenantId, start, end, statusFilter],
        );
        return applyMasking(
          (rows as RevenueRow[]).map(r => ({ ...r, prev_year_revenue: null })),
          userLevel, role,
        );
      }

      const [rows, prevRows] = await Promise.all([
        this.db.query(
          `SELECT year_month, total_revenue, total_orders, avg_order_value,
                  COALESCE(avg_margin_pct, 0) AS avg_margin,
                  COALESCE(total_returns, 0)  AS total_returns,
                  COALESCE(unique_customers, 0) AS unique_customers
           FROM mv_monthly_kpis
           WHERE tenant_id = $1
             AND year_month >= DATE_TRUNC('month', $2::date)::date
             AND year_month <= DATE_TRUNC('month', $3::date)::date
           ORDER BY year_month LIMIT 1200`,
          [tenantId, start, end],
        ),
        this.db.query(
          `SELECT year_month, total_revenue AS prev_year_revenue
           FROM mv_monthly_kpis
           WHERE tenant_id = $1
             AND year_month >= DATE_TRUNC('month', ($2::date - INTERVAL '1 year'))::date
             AND year_month <= DATE_TRUNC('month', ($3::date - INTERVAL '1 year'))::date
           ORDER BY year_month LIMIT 1200`,
          [tenantId, start, end],
        ),
      ]);
      const merged = (rows as RevenueRow[]).map((r, i: number) => ({
        ...r,
        prev_year_revenue: (prevRows as RevenueRow[])[i]?.prev_year_revenue ?? null,
      }));
      return applyMasking(merged, userLevel, role);
    });
  }

  async getDaily(
    tenantId: string,
    filters: SalesFilters,
    role: string,
    userLevel: string,
  ) {
    const { range = '30D', from, to, status = '' } = filters;
    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const key = `jtl:${tenantId}:sales:daily:${range}:${start}:${end}:${statusFilter}`;
    return this.cache.getOrSet(key, 300, async () => {
      if (statusFilter) {
        return this.db.query(
          `SELECT order_date AS summary_date,
                  COUNT(*) AS total_orders,
                  COALESCE(SUM(gross_revenue), 0) AS total_revenue,
                  COALESCE(ROUND(AVG(gross_revenue)::numeric, 2), 0) AS avg_order_value,
                  0 AS total_returns
           FROM orders
           WHERE tenant_id = $1 AND order_date BETWEEN $2 AND $3 AND status = $4
           GROUP BY order_date ORDER BY order_date LIMIT 5000`,
          [tenantId, start, end, statusFilter],
        );
      }
      return this.db.query(
        `SELECT summary_date, total_orders, total_revenue, avg_order_value,
                COALESCE(total_returns, 0) AS total_returns
         FROM mv_daily_summary
         WHERE tenant_id = $1 AND summary_date BETWEEN $2 AND $3
         ORDER BY summary_date LIMIT 5000`,
        [tenantId, start, end],
      );
    });
  }

  async getHeatmap(tenantId: string, filters: SalesFilters) {
    const { range = 'ALL', from, to, status = '' } = filters;
    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const key = `jtl:${tenantId}:sales:heatmap:${range}:${start}:${end}:${statusFilter}`;
    const statusClause = statusFilter ? `AND status = '${statusFilter.replace(/'/g, "''")}'` : `AND status NOT IN ('cancelled')`;
    return this.cache.getOrSet(key, 1800, async () => {
      return this.db.query(
        `SELECT
           EXTRACT(DOW FROM order_date)::int AS day_of_week,
           EXTRACT(HOUR FROM COALESCE(jtl_modified_at, synced_at))::int AS hour_of_day,
           COUNT(*) AS order_count
         FROM orders
         WHERE tenant_id = $1 AND order_date BETWEEN $2 AND $3
           ${statusClause}
           AND COALESCE(jtl_modified_at, synced_at) IS NOT NULL
         GROUP BY day_of_week, hour_of_day
         ORDER BY day_of_week, hour_of_day`,
        [tenantId, start, end],
      );
    });
  }

  async getOrders(tenantId: string, filters: SalesFilters) {
    const { range = '12M', from, to, orderNumber = '', sku = '', status = '', page = 1, limit = 50 } = filters;
    const parsedLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    const parsedPage = Math.max(1, Number(page) || 1);
    const skuFilter    = String(sku).trim();
    const orderFilter  = String(orderNumber).trim();
    const statusFilter = String(status).trim();
    const offset       = (parsedPage - 1) * parsedLimit;

    // When searching by order number or SKU with no explicit date range,
    // skip the date filter so results aren't missed due to date windowing.
    const skipDate = !!(( orderFilter || skuFilter) && !from && !to);
    const { start, end } = skipDate
      ? { start: '2000-01-01', end: new Date().toISOString().slice(0, 10) }
      : dateRange(range, from, to);

    const baseWhere = `
      WHERE o.tenant_id = $1
        AND ($6 OR o.order_date BETWEEN $2 AND $3)
        AND ($4 = '' OR o.order_number ILIKE '%' || $4 || '%'
                     OR o.external_order_number ILIKE '%' || $4 || '%')
        AND ($5 = '' OR EXISTS (
          SELECT 1 FROM order_items oi
          LEFT JOIN products p ON p.jtl_product_id = oi.product_id AND p.tenant_id = oi.tenant_id
          WHERE oi.order_id = o.jtl_order_id AND oi.tenant_id = o.tenant_id
            AND (p.article_number ILIKE '%' || $5 || '%' OR $5 = '')
        ))
        AND ($7 = '' OR o.status = $7)
    `;
    const baseParams = [tenantId, start, end, orderFilter, skuFilter, skipDate, statusFilter];

    const [rows, aggRows] = await Promise.all([
      this.db.query(
        `
        WITH filtered_orders AS (
          SELECT o.*
          FROM orders o
          ${baseWhere}
        ),
        order_margin AS (
          SELECT
            oi.order_id,
            ROUND(
              CASE
                WHEN SUM(
                  CASE
                    WHEN oi.unit_price_net > 0 THEN oi.quantity * oi.unit_price_net
                    ELSE 0
                  END
                ) > 0
                 AND SUM(
                  CASE
                    WHEN COALESCE(NULLIF(oi.unit_cost, 0), p.unit_cost, 0) > 0
                      THEN oi.quantity * COALESCE(NULLIF(oi.unit_cost, 0), p.unit_cost)
                    ELSE 0
                  END
                ) > 0
                THEN (
                  SUM(
                    CASE
                      WHEN oi.unit_price_net > 0 THEN oi.quantity * oi.unit_price_net
                      ELSE 0
                    END
                  )
                  - SUM(
                    CASE
                      WHEN COALESCE(NULLIF(oi.unit_cost, 0), p.unit_cost, 0) > 0
                        THEN oi.quantity * COALESCE(NULLIF(oi.unit_cost, 0), p.unit_cost)
                      ELSE 0
                    END
                  )
                )
                / NULLIF(
                    SUM(
                      CASE
                        WHEN oi.unit_price_net > 0 THEN oi.quantity * oi.unit_price_net
                        ELSE 0
                      END
                    ),
                    0
                  ) * 100
                ELSE NULL
              END::numeric,
              2
            ) AS calc_margin
          FROM filtered_orders fo
          JOIN order_items oi
            ON oi.tenant_id = fo.tenant_id
           AND oi.order_id = fo.jtl_order_id
          LEFT JOIN products p
            ON p.tenant_id = oi.tenant_id
           AND p.jtl_product_id = oi.product_id
          GROUP BY oi.order_id
        )
        SELECT
          fo.order_number,
          fo.order_date::text,
          fo.gross_revenue,
          fo.net_revenue,
          fo.status,
          fo.channel,
          fo.item_count,
          fo.region,
          fo.postcode,
          fo.city,
          fo.country,
          COALESCE(
            NULLIF(fo.gross_margin, 0),
            CASE
              WHEN fo.gross_revenue > 0 AND COALESCE(fo.cost_of_goods, 0) > 0
              THEN ROUND(((fo.gross_revenue - fo.cost_of_goods) / fo.gross_revenue * 100)::numeric, 2)
              ELSE NULL
            END,
            om.calc_margin,
            0
          ) AS gross_margin,
          fo.shipping_cost,
          fo.external_order_number,
          fo.customer_number,
          fo.payment_method,
          fo.shipping_method
        FROM filtered_orders fo
        LEFT JOIN order_margin om
          ON om.order_id = fo.jtl_order_id
        ORDER BY fo.order_date DESC, fo.jtl_order_id DESC
        LIMIT $8 OFFSET $9
        `,
        [...baseParams, parsedLimit, offset],
      ),
      // Single aggregate query: total count + total revenue + avg margin
      this.db.query(
        `
         WITH filtered_orders AS (
           SELECT o.*
           FROM orders o
           ${baseWhere}
         ),
         order_margin AS (
           SELECT
             oi.order_id,
             ROUND(
               CASE
                 WHEN SUM(
                   CASE
                     WHEN oi.unit_price_net > 0 THEN oi.quantity * oi.unit_price_net
                     ELSE 0
                   END
                 ) > 0
                  AND SUM(
                   CASE
                     WHEN COALESCE(NULLIF(oi.unit_cost, 0), p.unit_cost, 0) > 0
                       THEN oi.quantity * COALESCE(NULLIF(oi.unit_cost, 0), p.unit_cost)
                     ELSE 0
                   END
                 ) > 0
                 THEN (
                   SUM(
                     CASE
                       WHEN oi.unit_price_net > 0 THEN oi.quantity * oi.unit_price_net
                       ELSE 0
                     END
                   )
                   - SUM(
                     CASE
                       WHEN COALESCE(NULLIF(oi.unit_cost, 0), p.unit_cost, 0) > 0
                         THEN oi.quantity * COALESCE(NULLIF(oi.unit_cost, 0), p.unit_cost)
                       ELSE 0
                     END
                   )
                 )
                 / NULLIF(
                     SUM(
                       CASE
                         WHEN oi.unit_price_net > 0 THEN oi.quantity * oi.unit_price_net
                         ELSE 0
                       END
                     ),
                     0
                   ) * 100
                 ELSE NULL
               END::numeric,
               2
             ) AS calc_margin
           FROM filtered_orders fo
           JOIN order_items oi
             ON oi.tenant_id = fo.tenant_id
            AND oi.order_id = fo.jtl_order_id
           LEFT JOIN products p
             ON p.tenant_id = oi.tenant_id
            AND p.jtl_product_id = oi.product_id
           GROUP BY oi.order_id
         ),
         merged AS (
           SELECT
             fo.gross_revenue,
             fo.status,
             COALESCE(
               NULLIF(fo.gross_margin, 0),
               CASE
                 WHEN fo.gross_revenue > 0 AND COALESCE(fo.cost_of_goods, 0) > 0
                 THEN ROUND(((fo.gross_revenue - fo.cost_of_goods) / fo.gross_revenue * 100)::numeric, 2)
                 ELSE NULL
               END,
               om.calc_margin,
               0
             ) AS resolved_margin
           FROM filtered_orders fo
           LEFT JOIN order_margin om
             ON om.order_id = fo.jtl_order_id
         )
         SELECT
           COUNT(*)::int                      AS total,
           COALESCE(SUM(gross_revenue), 0)    AS total_revenue,
           COALESCE(AVG(resolved_margin), 0)  AS avg_margin,
           COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_count,
           COUNT(*) FILTER (WHERE status = 'returned')::int  AS returned_count
         FROM merged
        `,
        baseParams,
      ),
    ]);

    const agg = aggRows[0] ?? {};
    return buildPaginatedResult(
      rows as Record<string, unknown>[],
      agg.total,
      parsedPage,
      parsedLimit,
      {
        total_revenue: parseFloat(agg.total_revenue) || 0,
        avg_margin: parseFloat(agg.avg_margin) || 0,
        cancelled_count: parseInt(agg.cancelled_count, 10) || 0,
        returned_count: parseInt(agg.returned_count, 10) || 0,
      },
    );
  }

  async getChannels(tenantId: string, filters: SalesFilters) {
    const { range = '12M', from, to, status = '' } = filters;
    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const key = `jtl:${tenantId}:sales:channels:${range}:${start}:${end}:${statusFilter}`;
    return this.cache.getOrSet(key, 300, async () => {
      if (statusFilter) {
        return this.db.query(
          `SELECT channel,
                  COUNT(*) AS orders,
                  COALESCE(SUM(gross_revenue), 0) AS revenue,
                  0 AS cancelled_orders, 0 AS cancelled_revenue,
                  0 AS returned_orders,  0 AS returned_revenue
           FROM orders
           WHERE tenant_id = $1 AND order_date BETWEEN $2 AND $3 AND status = $4
           GROUP BY channel ORDER BY revenue DESC LIMIT 100`,
          [tenantId, start, end, statusFilter],
        );
      }
      return this.db.query(
        `SELECT channel,
                COUNT(*) FILTER (WHERE status NOT IN ('cancelled'))              AS orders,
                COALESCE(SUM(gross_revenue) FILTER (WHERE status NOT IN ('cancelled')), 0) AS revenue,
                COUNT(*) FILTER (WHERE status = 'cancelled')                     AS cancelled_orders,
                COALESCE(SUM(gross_revenue) FILTER (WHERE status = 'cancelled'), 0) AS cancelled_revenue,
                COUNT(*) FILTER (WHERE status = 'returned')                      AS returned_orders,
                COALESCE(SUM(gross_revenue) FILTER (WHERE status = 'returned'), 0)  AS returned_revenue
         FROM orders
         WHERE tenant_id = $1 AND order_date BETWEEN $2 AND $3
         GROUP BY channel ORDER BY revenue DESC LIMIT 100`,
        [tenantId, start, end],
      );
    });
  }

  async getRegional(tenantId: string, filters: SalesFilters) {
    const { range = '12M', from, to } = filters;
    const { start, end } = dateRange(range, from, to);
    const key = `jtl:${tenantId}:sales:regional:${range}:${start}:${end}`;
    return this.cache.getOrSet(key, 600, async () => {
      // Normalise country: treat blank/"Deutschland"/"Germany"/"DE" all as German domestic
      const regionExpr = `
        CASE
          WHEN LOWER(TRIM(COALESCE(country,''))) IN ('','de','deutschland','germany')
          THEN COALESCE(NULLIF(TRIM(region),''), 'Unknown')
          ELSE 'International'
        END`;

      const [cyRows, pyRows, cityRows] = await Promise.all([
        // Current period — revenue/orders/customers by region (excl. cancelled)
        this.db.query(
          `SELECT ${regionExpr} AS region_name,
                  COUNT(*) FILTER (WHERE status NOT IN ('cancelled'))::int                   AS orders,
                  COALESCE(SUM(gross_revenue) FILTER (WHERE status NOT IN ('cancelled')), 0)::numeric AS revenue,
                  COUNT(DISTINCT customer_id) FILTER (WHERE status NOT IN ('cancelled'))::int AS customers,
                  COUNT(*) FILTER (WHERE status = 'cancelled')::int   AS cancelled_orders,
                  COALESCE(SUM(gross_revenue) FILTER (WHERE status = 'cancelled'), 0)::numeric AS cancelled_revenue,
                  COUNT(*) FILTER (WHERE status = 'returned')::int    AS returned_orders,
                  COALESCE(SUM(gross_revenue) FILTER (WHERE status = 'returned'), 0)::numeric  AS returned_revenue
           FROM orders
           WHERE tenant_id=$1 AND order_date BETWEEN $2 AND $3
           GROUP BY region_name ORDER BY revenue DESC`,
          [tenantId, start, end],
        ),
        // Prior-year same window — for growth % (excl. cancelled)
        this.db.query(
          `SELECT ${regionExpr} AS region_name,
                  COALESCE(SUM(gross_revenue) FILTER (WHERE status NOT IN ('cancelled')), 0)::numeric AS revenue,
                  COUNT(*) FILTER (WHERE status NOT IN ('cancelled'))::int AS orders
           FROM orders
           WHERE tenant_id=$1
             AND order_date BETWEEN $2::date - INTERVAL '1 year'
                                AND $3::date - INTERVAL '1 year'
           GROUP BY region_name`,
          [tenantId, start, end],
        ),
        // Top cities (excl. cancelled)
        this.db.query(
          `SELECT COALESCE(NULLIF(TRIM(city),''), 'Unknown') AS city,
                  COALESCE(NULLIF(TRIM(country),''), 'Unknown') AS country,
                  COUNT(*) FILTER (WHERE status NOT IN ('cancelled'))::int AS orders,
                  COALESCE(SUM(gross_revenue) FILTER (WHERE status NOT IN ('cancelled')), 0)::numeric AS revenue
           FROM orders
           WHERE tenant_id=$1 AND order_date BETWEEN $2 AND $3
           GROUP BY city, country ORDER BY revenue DESC LIMIT 20`,
          [tenantId, start, end],
        ),
      ]);

      const pyMap: Record<string, { revenue: number; orders: number }> = {};
      for (const r of pyRows as RegionalRow[]) {
        pyMap[r.region_name] = { revenue: parseFloat(r.revenue) || 0, orders: parseInt(r.orders, 10) || 0 };
      }

      const totalRevenue = (cyRows as RegionalRow[]).reduce(
        (s: number, r) => s + (parseFloat(r.revenue) || 0),
        0,
      );

      const regions = (cyRows as RegionalRow[]).map((r) => {
        const cy = parseFloat(r.revenue) || 0;
        const py = pyMap[r.region_name]?.revenue || 0;
        const growth = py > 0 ? Math.round((cy - py) / py * 1000) / 10 : null;
        return {
          name:      r.region_name,
          revenue:   cy,
          orders:    parseInt(r.orders, 10) || 0,
          customers: parseInt(String(r.customers ?? 0), 10) || 0,
          py_revenue: py,
          py_orders:  pyMap[r.region_name]?.orders || 0,
          growth_pct: growth,
          share_pct:  totalRevenue > 0 ? Math.round(cy / totalRevenue * 1000) / 10 : 0,
        };
      });

      return {
        regions,
        cities: (cityRows as CityRow[]).map((r) => ({
          city:    r.city,
          country: r.country,
          orders:  parseInt(r.orders, 10) || 0,
          revenue: parseFloat(r.revenue) || 0,
        })),
        total_revenue: totalRevenue,
      };
    });
  }
}
