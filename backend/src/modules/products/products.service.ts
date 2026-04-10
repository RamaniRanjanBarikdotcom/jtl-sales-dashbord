import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService } from '../../cache/cache.service';
import { applyMasking } from '../../common/utils/masking';

@Injectable()
export class ProductsService {
  constructor(
    private readonly db: DataSource,
    private readonly cache: CacheService,
  ) {}

  async getKpis(tenantId: string, _filters: any, role: string, userLevel: string) {
    const key = `jtl:${tenantId}:products:kpis`;
    return this.cache.getOrSet(key, 300, async () => {
      const [kpiRow, topRow] = await Promise.all([
        this.db.query(
          `
          SELECT
            COUNT(*)                                                          AS total_products,
            COUNT(*) FILTER (WHERE is_active = true)                         AS active_products,
            ROUND(COALESCE(AVG(
              CASE WHEN list_price_net > 0
                    AND COALESCE(NULLIF(unit_cost,0), 0) > 0
                THEN (list_price_net - unit_cost) / list_price_net * 100
                ELSE NULL END
            ), 0)::numeric, 2)                                               AS avg_margin,
            -- Stock value: use purchase cost when available, else list price
            ROUND(COALESCE(SUM(
              stock_quantity * COALESCE(
                NULLIF(unit_cost, 0),
                NULLIF(list_price_net, 0),
                0
              )
            ), 0)::numeric, 2)                                               AS total_stock_value
          FROM products
          WHERE tenant_id = $1
          `,
          [tenantId],
        ),
        // Real top-product revenue from order_items (all-time)
        this.db.query(
          `
          SELECT COALESCE(SUM(oi.line_total_gross), 0) AS top_product_revenue
          FROM order_items oi
          WHERE oi.tenant_id = $1
            AND oi.product_id = (
              SELECT product_id
              FROM order_items
              WHERE tenant_id = $1
              GROUP BY product_id
              ORDER BY SUM(line_total_gross) DESC
              LIMIT 1
            )
          `,
          [tenantId],
        ),
      ]);
      const result = {
        ...(kpiRow[0] || {}),
        top_product_revenue: parseFloat(topRow[0]?.top_product_revenue) || 0,
      };
      return applyMasking(result, userLevel, role);
    });
  }

  async getList(tenantId: string, filters: any, role: string, userLevel: string) {
    const page      = parseInt(filters.page  || '1');
    const limit     = Math.min(parseInt(filters.limit || '50'), 200);
    const offset    = (page - 1) * limit;
    const validSort = ['total_revenue', 'total_units', 'margin_pct', 'name', 'stock_quantity', 'list_price_gross'];
    const sortField = validSort.includes(filters.sort) ? filters.sort : 'total_revenue';
    const sortDir   = (filters.order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const key = `jtl:${tenantId}:products:list:${page}:${limit}:${sortField}:${filters.search || ''}`;
    return this.cache.getOrSet(key, 300, async () => {
      const searchClause = filters.search ? `AND p.name ILIKE $4` : '';
      const params: any[] = [tenantId, limit, offset];
      if (filters.search) params.push(`%${filters.search}%`);

      const countParams: any[] = [tenantId];
      if (filters.search) countParams.push(`%${filters.search}%`);
      const countSearchClause = filters.search ? `AND p.name ILIKE $2` : '';

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
            COALESCE(rev.total_revenue, 0)  AS total_revenue,
            COALESCE(rev.total_units, 0)    AS total_units,
            CASE
              WHEN p.list_price_net > 0 AND p.unit_cost > 0
              THEN ROUND((p.list_price_net - p.unit_cost) / p.list_price_net * 100)
              ELSE 0
            END AS margin_pct
          FROM products p
          LEFT JOIN categories c
            ON c.jtl_category_id = p.category_id AND c.tenant_id = p.tenant_id  /* p.category_id stores jtl_category_id */
          LEFT JOIN (
            SELECT
              oi.product_id,
              SUM(oi.line_total_gross)  AS total_revenue,
              SUM(oi.quantity)          AS total_units
            FROM order_items oi
            WHERE oi.tenant_id = $1
            GROUP BY oi.product_id
          ) rev ON rev.product_id = p.jtl_product_id
          WHERE p.tenant_id = $1 ${searchClause}
          ORDER BY ${sortField} ${sortDir} NULLS LAST
          LIMIT $2 OFFSET $3
          `,
          params,
        ),
        this.db.query(
          `SELECT COUNT(*)::int AS total FROM products p WHERE p.tenant_id = $1 ${countSearchClause}`,
          countParams,
        ),
      ]);

      const maskedRows = applyMasking(rows, userLevel, role);
      return { rows: maskedRows, total: countResult[0]?.total ?? 0, page, limit };
    });
  }

  async exportList(tenantId: string, filters: any, role: string, userLevel: string): Promise<string> {
    const validSort = ['total_revenue', 'total_units', 'margin_pct', 'name', 'stock_quantity', 'list_price_gross'];
    const sortField = validSort.includes(filters.sort) ? filters.sort : 'total_revenue';
    const sortDir   = (filters.order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const searchClause = filters.search ? `AND p.name ILIKE $2` : '';
    const params: any[] = [tenantId];
    if (filters.search) params.push(`%${filters.search}%`);

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
        FROM order_items oi WHERE oi.tenant_id = $1 GROUP BY oi.product_id
      ) rev ON rev.product_id = p.jtl_product_id
      WHERE p.tenant_id = $1 ${searchClause}
      ORDER BY ${sortField} ${sortDir} NULLS LAST
      LIMIT 50000
      `,
      params,
    );

    const masked = applyMasking(rows, userLevel, role);
    const headers = ['Article Number','Name','Category','Price (Gross)','Price (Net)','Cost','Stock','Revenue','Units Sold','Margin %'];
    const csvRows = (masked as any[]).map((r: any) =>
      [r.article_number, r.name, r.category_name, r.list_price_gross, r.list_price_net, r.unit_cost, r.stock_quantity, r.total_revenue, r.total_units, r.margin_pct]
        .map((v: any) => (v == null ? '' : String(v).includes(',') ? `"${v}"` : v))
        .join(',')
    );
    return [headers.join(','), ...csvRows].join('\n');
  }

  async getCategories(tenantId: string) {
    const key = `jtl:${tenantId}:products:categories`;
    return this.cache.getOrSet(key, 300, async () => {
      return this.db.query(
        `
        SELECT
          COALESCE(c.name, 'Uncategorized') AS name,
          COUNT(p.id)                       AS product_count,
          COALESCE(SUM(rev.total_revenue), 0) AS total_revenue,
          COALESCE(SUM(p.stock_quantity * p.list_price_net), 0) AS stock_value
        FROM products p
        LEFT JOIN categories c
          ON c.jtl_category_id = p.category_id AND c.tenant_id = p.tenant_id  /* p.category_id stores jtl_category_id */
        LEFT JOIN (
          SELECT oi.product_id, SUM(oi.line_total_gross) AS total_revenue
          FROM order_items oi WHERE oi.tenant_id = $1
          GROUP BY oi.product_id
        ) rev ON rev.product_id = p.jtl_product_id
        WHERE p.tenant_id = $1
        GROUP BY c.name
        ORDER BY total_revenue DESC NULLS LAST
        `,
        [tenantId],
      );
    });
  }

  async getTop(tenantId: string, filters: any, role: string, userLevel: string) {
    const limit = Math.min(parseInt(filters.limit || '10'), 100);
    const key   = `jtl:${tenantId}:products:top:${limit}`;
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
          FROM order_items oi WHERE oi.tenant_id = $1
          GROUP BY oi.product_id
        ) rev ON rev.product_id = p.jtl_product_id
        WHERE p.tenant_id = $1
        ORDER BY total_revenue DESC NULLS LAST
        LIMIT $2
        `,
        [tenantId, limit],
      );
      return applyMasking(rows, userLevel, role);
    });
  }
}
