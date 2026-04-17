import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService } from '../../cache/cache.service';
import { buildPaginatedResult } from '../../common/utils/pagination';

type InventoryFilters = {
  page?: string | number;
  limit?: string | number;
  search?: string;
  range?: string;
};

@Injectable()
export class InventoryService {
  constructor(
    private readonly db: DataSource,
    private readonly cache: CacheService,
  ) {}

  async getKpis(tenantId: string) {
    const key = `jtl:${tenantId}:inventory:kpis`;
    return this.cache.getOrSet(key, 300, async () => {
      const rows = await this.db.query(
        `
        SELECT
          COUNT(*)                                                              AS total_skus,
          COUNT(*) FILTER (WHERE stock_quantity = 0)                           AS out_of_stock,
          COUNT(*) FILTER (WHERE stock_quantity > 0 AND stock_quantity <= 5)   AS low_stock_count,
          -- Inventory value: use purchase cost when available, else list price.
          -- JTL often has unit_cost=0 (fEKNetto not populated), so this falls
          -- back to list_price_net which gives the "catalog value at retail".
          ROUND(COALESCE(SUM(
            stock_quantity * COALESCE(
              NULLIF(unit_cost, 0),
              NULLIF(list_price_net, 0),
              0
            )
          ), 0)::numeric, 2)                                                   AS total_inventory_value,
          -- Flag so the frontend can show "(at cost)" vs "(at list price)"
          CASE WHEN COUNT(*) FILTER (WHERE unit_cost > 0) > 10
            THEN true ELSE false
          END                                                                   AS has_cost_data,
          ROUND(COALESCE(AVG(
            CASE WHEN list_price_net > 0
                  AND COALESCE(NULLIF(unit_cost, 0), 0) > 0
              THEN (list_price_net - unit_cost) / list_price_net * 100
              ELSE NULL END
          ), 0)::numeric, 2)                                                   AS avg_margin
        FROM products
        WHERE tenant_id = $1 AND is_active = true
        `,
        [tenantId],
      );
      return rows[0] || {};
    });
  }

  async getAlerts(tenantId: string) {
    const key = `jtl:${tenantId}:inventory:alerts`;
    return this.cache.getOrSet(key, 180, async () => {
      return this.db.query(
        `
        SELECT
          p.name        AS product_name,
          p.article_number,
          p.stock_quantity  AS total_available,
          CASE WHEN p.stock_quantity = 0 THEN 'out_of_stock' ELSE 'low_stock' END AS status,
          COALESCE(dsi.days_of_stock, 0) AS days_of_stock,
          COALESCE(inv.reorder_point, 0) AS reorder_point
        FROM products p
        LEFT JOIN (
          SELECT jtl_product_id, MAX(reorder_point) AS reorder_point
          FROM inventory
          WHERE tenant_id = $1
          GROUP BY jtl_product_id
        ) inv ON inv.jtl_product_id = p.jtl_product_id
        LEFT JOIN (
          SELECT
            oi.product_id,
            CASE
              WHEN SUM(oi.quantity) > 0
              THEN ROUND(p2.stock_quantity / (SUM(oi.quantity) / 30.0))
              ELSE 999
            END AS days_of_stock
          FROM order_items oi
          JOIN orders o   ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
          JOIN products p2 ON p2.jtl_product_id = oi.product_id AND p2.tenant_id = oi.tenant_id
          WHERE oi.tenant_id = $1
            AND o.order_date >= NOW() - INTERVAL '30 days'
          GROUP BY oi.product_id, p2.stock_quantity
        ) dsi ON dsi.product_id = p.jtl_product_id
        WHERE p.tenant_id = $1 AND p.stock_quantity <= 5
        ORDER BY p.stock_quantity ASC
        LIMIT 50
        `,
        [tenantId],
      );
    });
  }

  async getList(tenantId: string, filters: InventoryFilters) {
    const page   = Math.max(1, parseInt(String(filters.page ?? '1'), 10) || 1);
    const limit  = Math.min(Math.max(1, parseInt(String(filters.limit ?? '50'), 10) || 50), 200);
    const offset = (page - 1) * limit;
    const searchTerm = String(filters.search || '').trim();
    const key    = `jtl:${tenantId}:inventory:list:${page}:${limit}:${searchTerm}`;
    return this.cache.getOrSet(key, 300, async () => {
      // Use parameterized $4 for search — empty string matches all via the OR condition
      const params: unknown[] = [tenantId, limit, offset, searchTerm];
      const [rows, countRows] = await Promise.all([
        this.db.query(
          `
          SELECT
            p.id,
            p.name            AS product_name,
            p.article_number,
            p.stock_quantity  AS total_available,
            COALESCE(inv.total_reserved, 0) AS total_reserved,
            p.stock_quantity <= 5 AS is_low_stock,
            p.unit_cost,
            p.list_price_net,
            p.ean
          FROM products p
          LEFT JOIN (
            SELECT jtl_product_id, SUM(reserved) AS total_reserved
            FROM inventory
            WHERE tenant_id = $1
            GROUP BY jtl_product_id
          ) inv ON inv.jtl_product_id = p.jtl_product_id
          WHERE p.tenant_id = $1
            AND ($4 = '' OR p.name ILIKE '%' || $4 || '%' OR p.article_number ILIKE '%' || $4 || '%')
          ORDER BY p.stock_quantity ASC
          LIMIT $2 OFFSET $3
          `,
          params,
        ),
        this.db.query(
          `
          SELECT COUNT(*)::int AS total
          FROM products p
          WHERE p.tenant_id = $1
            AND ($2 = '' OR p.name ILIKE '%' || $2 || '%' OR p.article_number ILIKE '%' || $2 || '%')
          `,
          [tenantId, searchTerm],
        ),
      ]);

      return buildPaginatedResult(
        rows as Record<string, unknown>[],
        countRows[0]?.total,
        page,
        limit,
      );
    });
  }

  async getMovements(tenantId: string, filters: InventoryFilters) {
    const daysMap: Record<string, number> = { '7D': 7, '30D': 30, '3M': 90, '6M': 180 };
    const days = daysMap[filters.range || '30D'] || 30;
    const key  = `jtl:${tenantId}:inventory:movements:${days}`;
    return this.cache.getOrSet(key, 600, async () => {
      // DSI per product
      const dsi = await this.db.query(
        `
        SELECT
          p.name,
          p.article_number,
          p.stock_quantity,
          COALESCE(s.avg_daily, 0) AS avg_daily_sales,
          CASE
            WHEN COALESCE(s.avg_daily, 0) > 0
            THEN LEAST(ROUND(p.stock_quantity / s.avg_daily), 999)::int
            ELSE 999
          END AS dsi
        FROM products p
        LEFT JOIN (
          SELECT oi.product_id, SUM(oi.quantity)::float / $2 AS avg_daily
          FROM order_items oi
          JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
          WHERE oi.tenant_id = $1
            AND o.order_date >= NOW() - ($2 || ' days')::interval
          GROUP BY oi.product_id
        ) s ON s.product_id = p.jtl_product_id
        WHERE p.tenant_id = $1 AND p.is_active = true
        ORDER BY dsi ASC
        LIMIT 20
        `,
        [tenantId, days],
      );

      // Daily units sold from orders
      const daily = await this.db.query(
        `
        SELECT
          order_date::date AS d,
          COUNT(*)         AS ord,
          COALESCE(SUM(gross_revenue), 0) AS rev
        FROM orders
        WHERE tenant_id = $1
          AND order_date >= NOW() - ($2 || ' days')::interval
          AND status NOT IN ('cancelled', 'returned')
        GROUP BY order_date::date
        ORDER BY order_date::date
        `,
        [tenantId, days],
      );

      return { warehouses: [], dsi, daily };
    });
  }
}
