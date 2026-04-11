import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService } from '../../cache/cache.service';
import { applyMasking } from '../../common/utils/masking';

function dateRange(
  range: string,
  from?: string,
  to?: string,
): { start: string; end: string } {
  const now = new Date();
  const end = to || now.toISOString().slice(0, 10);
  if (from) return { start: from, end };
  const map: Record<string, number> = {
    '7D': 7,
    '30D': 30,
    '3M': 90,
    '6M': 180,
    '12M': 365,
    '2Y': 730,
    '5Y': 1825,
    YTD: 0,
  };
  if (range === 'YTD') {
    return { start: `${now.getFullYear()}-01-01`, end };
  }
  if (range === 'ALL') {
    return { start: '2000-01-01', end };
  }
  const days = map[range] ?? 365;
  const start = new Date(now.getTime() - days * 86400000)
    .toISOString()
    .slice(0, 10);
  return { start, end };
}

@Injectable()
export class SalesService {
  constructor(
    private readonly db: DataSource,
    private readonly cache: CacheService,
  ) {}

  async getKpis(
    tenantId: string,
    filters: any,
    role: string,
    userLevel: string,
  ) {
    const { range = 'ALL', from, to } = filters;
    const { start, end } = dateRange(range, from, to);
    const key = `jtl:${tenantId}:sales:kpis:${range}:${start}:${end}`;
    return this.cache.getOrSet(key, 60, async () => {
      const [kpiRow, marginRow] = await Promise.all([
        this.db.query(
          `
          SELECT
            SUM(total_revenue)                            AS total_revenue,
            SUM(total_orders)                             AS total_orders,
            ROUND(AVG(avg_order_value)::numeric, 2)       AS avg_order_value,
            SUM(total_returns)                            AS total_returns,
            AVG(return_rate)                              AS return_rate
          FROM mv_daily_summary
          WHERE tenant_id = $1 AND summary_date BETWEEN $2 AND $3
          `,
          [tenantId, start, end],
        ),
        // avg_margin: use order_items with product-cost fallback so we get
        // a real number even when order_items.unit_cost was 0 at sync time.
        this.db.query(
          `
          SELECT ROUND(
            COALESCE(
              AVG(
                CASE
                  WHEN oi.unit_price_net > 0
                    AND COALESCE(NULLIF(oi.unit_cost, 0), p.unit_cost, 0) > 0
                  THEN (oi.unit_price_net
                        - COALESCE(NULLIF(oi.unit_cost, 0), p.unit_cost))
                       / oi.unit_price_net * 100
                  ELSE NULL
                END
              ),
              0
            )::numeric, 2) AS avg_margin
          FROM order_items oi
          JOIN orders o
            ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
          LEFT JOIN products p
            ON p.jtl_product_id = oi.product_id AND p.tenant_id = oi.tenant_id
          WHERE oi.tenant_id = $1
            AND o.order_date BETWEEN $2 AND $3
            AND o.status != 'cancelled'
            AND oi.unit_price_net > 0
          `,
          [tenantId, start, end],
        ),
      ]);
      const combined = {
        ...(kpiRow[0] || {}),
        avg_margin: marginRow[0]?.avg_margin ?? 0,
      };
      return applyMasking(combined, userLevel, role);
    });
  }

  async getRevenue(
    tenantId: string,
    filters: any,
    role: string,
    userLevel: string,
  ) {
    const { range = 'ALL', from, to } = filters;
    const { start, end } = dateRange(range, from, to);
    const key = `jtl:${tenantId}:sales:revenue:${range}:${start}:${end}`;
    return this.cache.getOrSet(key, 900, async () => {
      const rows = await this.db.query(
        `
        SELECT year_month, total_revenue, total_orders, avg_order_value,
               COALESCE(avg_margin_pct, 0) AS avg_margin,
               COALESCE(total_returns, 0)  AS total_returns,
               COALESCE(unique_customers, 0) AS unique_customers
        FROM mv_monthly_kpis
        WHERE tenant_id = $1
          AND year_month >= DATE_TRUNC('month', $2::date)::date
          AND year_month <= DATE_TRUNC('month', $3::date)::date
        ORDER BY year_month
      `,
        [tenantId, start, end],
      );
      return applyMasking(rows, userLevel, role);
    });
  }

  async getDaily(
    tenantId: string,
    filters: any,
    role: string,
    userLevel: string,
  ) {
    const { range = '30D', from, to } = filters;
    const { start, end } = dateRange(range, from, to);
    const key = `jtl:${tenantId}:sales:daily:${range}:${start}:${end}`;
    return this.cache.getOrSet(key, 300, async () => {
      const rows = await this.db.query(
        `
        SELECT summary_date, total_orders, total_revenue, avg_order_value
        FROM mv_daily_summary
        WHERE tenant_id = $1 AND summary_date BETWEEN $2 AND $3
        ORDER BY summary_date
      `,
        [tenantId, start, end],
      );
      return rows;
    });
  }

  async getHeatmap(tenantId: string, filters: any) {
    const { range = 'ALL', from, to } = filters;
    const { start, end } = dateRange(range, from, to);
    const key = `jtl:${tenantId}:sales:heatmap:${range}:${start}:${end}`;
    return this.cache.getOrSet(key, 1800, async () => {
      return this.db.query(
        `
        SELECT
          EXTRACT(DOW FROM order_date)::int AS day_of_week,
          -- jtl_modified_at stores dErstellt (creation datetime with time-of-day).
          -- Fall back to synced_at so the heatmap always has non-null hour data.
          EXTRACT(HOUR FROM COALESCE(jtl_modified_at, synced_at))::int AS hour_of_day,
          COUNT(*) AS order_count
        FROM orders
        WHERE tenant_id = $1 AND order_date BETWEEN $2 AND $3
          AND COALESCE(jtl_modified_at, synced_at) IS NOT NULL
        GROUP BY day_of_week, hour_of_day
        ORDER BY day_of_week, hour_of_day
      `,
        [tenantId, start, end],
      );
    });
  }

  async getOrders(tenantId: string, filters: any) {
    const { range = '12M', from, to, orderNumber = '', sku = '', page = 1, limit = 50 } = filters;
    const parsedLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    const parsedPage = Math.max(1, Number(page) || 1);
    const skuFilter   = String(sku).trim();
    const orderFilter = String(orderNumber).trim();
    const offset      = (parsedPage - 1) * parsedLimit;

    // When searching by order number or SKU with no explicit date range,
    // skip the date filter so results aren't missed due to date windowing.
    const skipDate = !!(( orderFilter || skuFilter) && !from && !to);
    const { start, end } = skipDate
      ? { start: '2000-01-01', end: new Date().toISOString().slice(0, 10) }
      : dateRange(range, from, to);

    const baseWhere = `
      WHERE o.tenant_id = $1
        AND ($6 OR o.order_date BETWEEN $2 AND $3)
        AND ($4 = '' OR o.order_number ILIKE '%' || $4 || '%')
        AND ($5 = '' OR EXISTS (
          SELECT 1 FROM order_items oi
          LEFT JOIN products p ON p.id = oi.product_id AND p.tenant_id = oi.tenant_id
          WHERE oi.order_id = o.jtl_order_id AND oi.tenant_id = o.tenant_id
            AND (p.article_number ILIKE '%' || $5 || '%' OR $5 = '')
        ))
    `;
    const baseParams = [tenantId, start, end, orderFilter, skuFilter, skipDate];

    const [rows, countRows] = await Promise.all([
      this.db.query(
        `
        SELECT
          o.order_number,
          o.order_date::text,
          o.gross_revenue,
          o.net_revenue,
          o.status,
          o.channel,
          o.item_count,
          o.region,
          o.postcode,
          o.city,
          o.country,
          o.gross_margin,
          o.shipping_cost,
          o.external_order_number,
          o.customer_number,
          o.payment_method,
          o.shipping_method
        FROM orders o
        ${baseWhere}
        ORDER BY o.order_date DESC, o.jtl_order_id DESC
        LIMIT $7 OFFSET $8
        `,
        [...baseParams, parsedLimit, offset],
      ),
      this.db.query(
        `SELECT COUNT(*)::int AS total FROM orders o ${baseWhere}`,
        baseParams,
      ),
    ]);

    return {
      rows,
      total: countRows[0]?.total ?? 0,
      page: parsedPage,
      limit: parsedLimit,
    };
  }

  async getChannels(tenantId: string, filters: any) {
    const { range = '12M', from, to } = filters;
    const { start, end } = dateRange(range, from, to);
    const key = `jtl:${tenantId}:sales:channels:${range}:${start}:${end}`;
    return this.cache.getOrSet(key, 300, async () => {
      return this.db.query(
        `
        SELECT channel, COUNT(*) AS orders, SUM(gross_revenue) AS revenue
        FROM orders
        WHERE tenant_id = $1 AND order_date BETWEEN $2 AND $3
        GROUP BY channel ORDER BY revenue DESC
      `,
        [tenantId, start, end],
      );
    });
  }

  async getRegional(tenantId: string, filters: any) {
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
        // Current period — revenue/orders/customers by region
        this.db.query(
          `SELECT ${regionExpr} AS region_name,
                  COUNT(*)::int                   AS orders,
                  SUM(gross_revenue)::numeric      AS revenue,
                  COUNT(DISTINCT customer_id)::int AS customers
           FROM orders
           WHERE tenant_id=$1 AND order_date BETWEEN $2 AND $3
           GROUP BY region_name ORDER BY revenue DESC`,
          [tenantId, start, end],
        ),
        // Prior-year same window — for growth %
        this.db.query(
          `SELECT ${regionExpr} AS region_name,
                  SUM(gross_revenue)::numeric AS revenue,
                  COUNT(*)::int               AS orders
           FROM orders
           WHERE tenant_id=$1
             AND order_date BETWEEN $2::date - INTERVAL '1 year'
                                AND $3::date - INTERVAL '1 year'
           GROUP BY region_name`,
          [tenantId, start, end],
        ),
        // Top cities
        this.db.query(
          `SELECT COALESCE(NULLIF(TRIM(city),''), 'Unknown') AS city,
                  COALESCE(NULLIF(TRIM(country),''), 'Unknown') AS country,
                  COUNT(*)::int               AS orders,
                  SUM(gross_revenue)::numeric AS revenue
           FROM orders
           WHERE tenant_id=$1 AND order_date BETWEEN $2 AND $3
           GROUP BY city, country ORDER BY revenue DESC LIMIT 20`,
          [tenantId, start, end],
        ),
      ]);

      const pyMap: Record<string, { revenue: number; orders: number }> = {};
      for (const r of pyRows) {
        pyMap[r.region_name] = { revenue: parseFloat(r.revenue) || 0, orders: parseInt(r.orders) || 0 };
      }

      const totalRevenue = cyRows.reduce((s: number, r: any) => s + (parseFloat(r.revenue) || 0), 0);

      const regions = cyRows.map((r: any) => {
        const cy = parseFloat(r.revenue) || 0;
        const py = pyMap[r.region_name]?.revenue || 0;
        const growth = py > 0 ? Math.round((cy - py) / py * 1000) / 10 : null;
        return {
          name:      r.region_name,
          revenue:   cy,
          orders:    parseInt(r.orders) || 0,
          customers: parseInt(r.customers) || 0,
          py_revenue: py,
          py_orders:  pyMap[r.region_name]?.orders || 0,
          growth_pct: growth,
          share_pct:  totalRevenue > 0 ? Math.round(cy / totalRevenue * 1000) / 10 : 0,
        };
      });

      return {
        regions,
        cities: cityRows.map((r: any) => ({
          city:    r.city,
          country: r.country,
          orders:  parseInt(r.orders) || 0,
          revenue: parseFloat(r.revenue) || 0,
        })),
        total_revenue: totalRevenue,
      };
    });
  }
}
