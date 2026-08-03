import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService } from '../../cache/cache.service';
import { buildPaginatedResult } from '../../common/utils/pagination';
import { MailService } from '../mail/mail.service';
import { TenantScope } from '../../common/types/auth-request';
import { buildCsv, CsvColumn, CSV_EXPORT_MAX_ROWS } from '../../common/utils/csv-export';
import {
  inventoryAggregationSql,
  inventoryJoinSql,
} from './inventory-stock';

type InventoryFilters = {
  page?: string | number;
  limit?: string | number;
  search?: string;
  range?: string;
  from?: string;
  to?: string;
  status?: string;
  category?: string;
  warehouse?: string;
  minStock?: number;
  maxStock?: number;
  minAvailable?: number;
  maxAvailable?: number;
  minReserved?: number;
  maxReserved?: number;
  minRevenue?: number;
  maxRevenue?: number;
  minDaysOfStock?: number;
  maxDaysOfStock?: number;
  channel?: string;
  channels?: string[] | string;
  performanceClass?: string;
  dataset?: string;
  sort?: string;
  order?: string;
};

function inventoryDateRange(range = '30D', from?: string, to?: string) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const end = to || today;
  if (from) {
    const days = Math.max(1, Math.round((new Date(end).getTime() - new Date(from).getTime()) / 86400000) + 1);
    return { start: from, end, days };
  }
  if (range === 'TODAY' || range === 'DAY') return { start: today, end: today, days: 1 };
  if (range === 'YESTERDAY') {
    const date = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    return { start: date, end: date, days: 1 };
  }
  if (range === 'MONTH') {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
    return { start, end, days: Math.max(1, now.getUTCDate()) };
  }
  if (range === 'PREVIOUS_MONTH') {
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    return { start: startDate.toISOString().slice(0, 10), end: endDate.toISOString().slice(0, 10), days: endDate.getUTCDate() };
  }
  if (range === 'QUARTER' || range === 'PREVIOUS_QUARTER') {
    const startMonth = Math.floor(now.getUTCMonth() / 3) * 3 + (range === 'PREVIOUS_QUARTER' ? -3 : 0);
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), startMonth, 1));
    const endDate = range === 'PREVIOUS_QUARTER' ? new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 3, 0)) : now;
    return { start: startDate.toISOString().slice(0, 10), end: endDate.toISOString().slice(0, 10), days: Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1) };
  }
  if (range === 'YEAR' || range === 'YTD') {
    const start = `${now.getUTCFullYear()}-01-01`;
    return { start, end, days: Math.max(1, Math.round((now.getTime() - new Date(start).getTime()) / 86400000) + 1) };
  }
  if (range === 'PREVIOUS_YEAR') {
    const year = now.getUTCFullYear() - 1;
    return { start: `${year}-01-01`, end: `${year}-12-31`, days: 365 };
  }
  if (range === 'ALL') return { start: '2000-01-01', end, days: Math.max(1, Math.round((now.getTime() - new Date('2000-01-01').getTime()) / 86400000) + 1) };
  const daysMap: Record<string, number> = { '7D': 7, '30D': 30, '3M': 90, '6M': 180, '12M': 365, '2Y': 730, '5Y': 1825 };
  const days = daysMap[range] || 30;
  return { start: new Date(now.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10), end, days };
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly db: DataSource,
    private readonly cache: CacheService,
    private readonly mail: MailService,
  ) {}

  async getKpis(scope: TenantScope) {
    const tenantId = scope.tenantIds;
    const key = `jtl:${tenantId}:inventory:kpis`;
    return this.cache.getOrSet(key, 300, async () => {
      const rows = await this.db.query(
        `
        WITH stock AS (
          SELECT
            p.id,
            p.tenant_id,
            p.is_active,
            p.list_price_net,
            p.list_price_gross,
            p.unit_cost,
            -- Use inventory table aggregate if available, else products.stock_quantity
            COALESCE(inv.total_available, p.stock_quantity, 0) AS effective_stock
          FROM products p
          LEFT JOIN (
            ${inventoryAggregationSql()}
          ) inv ON ${inventoryJoinSql('inv', 'p')}
          WHERE p.tenant_id = ANY($1::uuid[]) AND p.is_active = true
        )
        SELECT
          COUNT(*)                                                              AS total_skus,
          COUNT(*) FILTER (WHERE effective_stock = 0)                          AS out_of_stock,
          COUNT(*) FILTER (WHERE effective_stock > 0 AND effective_stock <= 5) AS low_stock_count,
          -- Stock value: stock × cost (or list price when cost is missing)
          ROUND(COALESCE(SUM(
            effective_stock * COALESCE(
              NULLIF(unit_cost, 0),
              NULLIF(list_price_net, 0),
              0
            )
          ), 0)::numeric, 2)                                                   AS total_inventory_value,
          -- Catalog value: sum of list prices for all active SKUs with prices
          -- (useful when physical stock is 0 / dropshipping model)
          ROUND(COALESCE(SUM(NULLIF(list_price_net, 0)), 0)::numeric, 2)       AS catalog_value,
          CASE WHEN COUNT(*) FILTER (WHERE unit_cost > 0) > 10
            THEN true ELSE false
          END                                                                   AS has_cost_data,
          ROUND(COALESCE(AVG(
            CASE WHEN list_price_net > 0
                  AND COALESCE(NULLIF(unit_cost, 0), 0) > 0
              THEN (list_price_net - unit_cost) / list_price_net * 100
              ELSE NULL END
          ), 0)::numeric, 2)                                                   AS avg_margin
        FROM stock
        `,
        [tenantId],
      );
      return rows[0] || {};
    });
  }

  async getAlerts(scope: TenantScope) {
    const tenantId = scope.tenantIds;
    const key = `jtl:${tenantId}:inventory:alerts`;
    return this.cache.getOrSet(key, 180, async () => {
      return this.db.query(
        `
        SELECT
          p.name        AS product_name,
          p.article_number,
          COALESCE(inv_stock.total_available, p.stock_quantity, 0) AS total_available,
          -- Aliases so any frontend field name resolves to the JTL "Bestand alle Lager" total
          COALESCE(inv_stock.total_available, p.stock_quantity, 0) AS stock,
          COALESCE(inv_stock.total_available, p.stock_quantity, 0) AS stock_quantity,
          COALESCE(inv_stock.on_hand_available, 0) AS available_stock,
          COALESCE(inv_stock.total_reserved, 0) AS total_reserved,
          CASE WHEN COALESCE(inv_stock.total_available, p.stock_quantity, 0) = 0 THEN 'out_of_stock' ELSE 'low_stock' END AS status,
          dsi.days_of_stock,
          COALESCE(inv_stock.reorder_point, 0) AS reorder_point
        FROM products p
        LEFT JOIN (
          ${inventoryAggregationSql()}
        ) inv_stock ON ${inventoryJoinSql('inv_stock', 'p')}
        LEFT JOIN (
          SELECT
            oi.tenant_id,
            oi.product_id,
            CASE
              WHEN SUM(oi.quantity) > 0
              THEN ROUND(COALESCE(inv2.total_available, p2.stock_quantity, 0) / (SUM(oi.quantity) / 30.0))
              ELSE NULL
            END AS days_of_stock
          FROM order_items oi
          JOIN orders o    ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
          JOIN products p2 ON p2.jtl_product_id = oi.product_id AND p2.tenant_id = oi.tenant_id
          LEFT JOIN (
            ${inventoryAggregationSql()}
          ) inv2 ON ${inventoryJoinSql('inv2', 'p2')}
          WHERE oi.tenant_id = ANY($1::uuid[])
            AND o.order_date >= NOW() - INTERVAL '30 days'
          GROUP BY oi.tenant_id, oi.product_id, p2.stock_quantity, inv2.total_available
        ) dsi ON dsi.tenant_id = p.tenant_id
          AND dsi.product_id = p.jtl_product_id
        WHERE p.tenant_id = ANY($1::uuid[])
          AND COALESCE(inv_stock.total_available, p.stock_quantity, 0) <= 5
          AND p.list_price_net > 0
        ORDER BY COALESCE(inv_stock.total_available, p.stock_quantity, 0) ASC, p.name ASC
        LIMIT 500
        `,
        [tenantId],
      );
    });
  }

  async emailAlerts(tenantId: string) {
    const [settingsRow] = await this.db.query(
      `
      SELECT
        t.name AS company_name,
        COALESCE(cs.settings->'alert_recipients', '[]'::jsonb) AS alert_recipients
      FROM tenants t
      LEFT JOIN company_settings cs ON cs.tenant_id = t.id
      WHERE t.id = $1::uuid
      LIMIT 1
      `,
      [tenantId],
    );
    const recipients = Array.isArray(settingsRow?.alert_recipients)
      ? settingsRow.alert_recipients.map(String).map((email: string) => email.trim()).filter(Boolean)
      : [];
    if (recipients.length === 0) {
      return { ok: false, skipped: true, reason: 'no_alert_recipients' };
    }

    const alerts = await this.getAlerts({
      scope: 'single',
      tenantId,
      tenantIds: [tenantId],
      cacheKey: `single:${tenantId}`,
    });
    if (alerts.length === 0) {
      return { ok: true, skipped: true, reason: 'no_alerts', recipients: recipients.length };
    }

    const delivery = await this.mail.sendInventoryAlertsEmail({
      to: recipients,
      companyName: String(settingsRow?.company_name || 'Company'),
      alerts,
    });
    return {
      ...delivery,
      recipients: recipients.length,
      alerts: alerts.length,
    };
  }

  async getAlertsPaged(scope: TenantScope, filters: InventoryFilters) {
    const tenantId = scope.tenantIds;
    const page = Math.max(1, Number.parseInt(String(filters.page ?? '1'), 10) || 1);
    const limit = Math.min(Math.max(1, Number.parseInt(String(filters.limit ?? '50'), 10) || 50), CSV_EXPORT_MAX_ROWS);
    const offset = (page - 1) * limit;
    const searchTerm = String(filters.search || '').trim();
    const status = String(filters.status || 'all').trim().toLowerCase();
    const category = String(filters.category || '').trim();
    const warehouse = String(filters.warehouse || '').trim();
    const channel = String(filters.channel || '').trim();
    const { start, end, days } = inventoryDateRange(filters.range, filters.from, filters.to);
    const key = `jtl:${tenantId}:inventory:alerts-paged:${page}:${limit}:${searchTerm}:${status}:${category}:${warehouse}:${channel}:${start}:${end}`;

    return this.cache.getOrSet(key, 60, async () => {
      const rows = await this.db.query(
        `
        WITH current_stock AS (
          ${inventoryAggregationSql()}
        ), demand AS (
          SELECT oi.tenant_id, oi.product_id,
            SUM(oi.quantity)::float8 / $4::numeric AS avg_daily_sales,
            STRING_AGG(DISTINCT COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown'), ', ' ORDER BY COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')) AS sales_channels
          FROM order_items oi
          JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
          WHERE oi.tenant_id = ANY($1::uuid[])
            AND o.order_date BETWEEN $2::date AND $3::date
            AND LOWER(COALESCE(o.status, '')) <> 'cancelled'
          GROUP BY oi.tenant_id, oi.product_id
        ), base AS (
          SELECT p.name AS product_name, p.article_number,
            COALESCE(c.name, 'Uncategorized') AS category_name,
            COALESCE(inv.total_available, p.stock_quantity, 0)::float8 AS total_available,
            COALESCE(inv.on_hand_available, 0)::float8 AS available_stock,
            COALESCE(inv.total_reserved, 0)::float8 AS total_reserved,
            COALESCE(inv.reorder_point, 0)::float8 AS reorder_point,
            COALESCE(inv.warehouse_names, '') AS warehouse_names,
            COALESCE(d.sales_channels, '') AS sales_channels,
            CASE WHEN COALESCE(d.avg_daily_sales, 0) > 0
              THEN ROUND(COALESCE(inv.total_available, p.stock_quantity, 0) / d.avg_daily_sales)::int
              ELSE NULL END AS days_of_stock
          FROM products p
          LEFT JOIN current_stock inv ON ${inventoryJoinSql('inv', 'p')}
          LEFT JOIN demand d ON d.tenant_id = p.tenant_id AND d.product_id = p.jtl_product_id
          LEFT JOIN categories c ON c.tenant_id = p.tenant_id AND c.jtl_category_id = p.category_id
          WHERE p.tenant_id = ANY($1::uuid[]) AND p.is_active = true
            AND p.list_price_net > 0
            AND ($5 = '' OR p.name ILIKE '%' || $5 || '%' OR p.article_number ILIKE '%' || $5 || '%')
            AND ($7 = '' OR c.name = $7)
            AND ($8 = '' OR EXISTS (
              SELECT 1 FROM inventory iw
              WHERE iw.tenant_id = p.tenant_id AND iw.jtl_product_id = p.jtl_product_id
                AND (iw.warehouse_name ILIKE '%' || $8 || '%' OR iw.jtl_warehouse_id::text = $8)
            ))
            AND ($9 = '' OR EXISTS (
              SELECT 1 FROM order_items coi
              JOIN orders co ON co.tenant_id = coi.tenant_id AND co.jtl_order_id = coi.order_id
              WHERE coi.tenant_id = p.tenant_id AND coi.product_id = p.jtl_product_id
                AND co.order_date BETWEEN $2::date AND $3::date
                AND LOWER(COALESCE(co.channel, '')) = LOWER($9)
            ))
        ), filtered AS (
          SELECT *,
            CASE
              WHEN total_available = 0 THEN 'out_of_stock'
              WHEN days_of_stock IS NOT NULL AND days_of_stock <= 7 THEN 'stockout_risk'
              WHEN reorder_point > 0 AND total_available <= reorder_point THEN 'below_reorder_point'
              ELSE 'low_stock'
            END AS status,
            COUNT(*) OVER()::int AS total_count
          FROM base
          WHERE (total_available <= 5
              OR (reorder_point > 0 AND total_available <= reorder_point)
              OR (days_of_stock IS NOT NULL AND days_of_stock <= 7))
            AND ($6 = 'all'
              OR ($6 = 'out_of_stock' AND total_available = 0)
              OR ($6 = 'low_stock' AND total_available > 0 AND total_available <= 5)
              OR ($6 = 'below_reorder_point' AND reorder_point > 0 AND total_available <= reorder_point)
              OR ($6 = 'high_demand_low_stock' AND total_available > 0 AND total_available <= 5 AND days_of_stock IS NOT NULL AND days_of_stock <= 7)
              OR ($6 = 'stockout_risk' AND days_of_stock IS NOT NULL AND days_of_stock <= 7))
        )
        SELECT * FROM filtered
        ORDER BY total_available ASC, product_name ASC
        LIMIT $10 OFFSET $11
        `,
        [tenantId, start, end, days, searchTerm, status, category, warehouse, channel, limit, offset],
      );

      return buildPaginatedResult(
        rows as Record<string, unknown>[],
        rows[0]?.total_count,
        page,
        limit,
      );
    });
  }

  async getList(scope: TenantScope, filters: InventoryFilters) {
    const tenantId = scope.tenantIds;
    const page   = Math.max(1, parseInt(String(filters.page ?? '1'), 10) || 1);
    const limit  = Math.min(Math.max(1, parseInt(String(filters.limit ?? '50'), 10) || 50), CSV_EXPORT_MAX_ROWS);
    const offset = (page - 1) * limit;
    const searchTerm = String(filters.search || '').trim();
    const statusFilter = String(filters.status || 'all').trim().toLowerCase();
    const categoryFilter = String(filters.category || '').trim();
    const warehouseFilter = String(filters.warehouse || '').trim();
    const minStock = filters.minStock == null ? null : Number(filters.minStock);
    const maxStock = filters.maxStock == null ? null : Number(filters.maxStock);
    const minAvailable = filters.minAvailable == null ? null : Number(filters.minAvailable);
    const maxAvailable = filters.maxAvailable == null ? null : Number(filters.maxAvailable);
    const minReserved = filters.minReserved == null ? null : Number(filters.minReserved);
    const maxReserved = filters.maxReserved == null ? null : Number(filters.maxReserved);
    const minRevenue = filters.minRevenue == null ? null : Number(filters.minRevenue);
    const maxRevenue = filters.maxRevenue == null ? null : Number(filters.maxRevenue);
    const channelFilter = String(filters.channel || '').trim();
    const channels = (Array.isArray(filters.channels) ? filters.channels : String(filters.channels || '').split(','))
      .map((value) => value.trim()).filter(Boolean).slice(0, 50);
    const performanceClass = String(filters.performanceClass || 'all').trim().toLowerCase();
    const { start, end, days } = inventoryDateRange(filters.range, filters.from, filters.to);
    const sortColumns: Record<string, string> = {
      total_stock: 'total_available',
      available_stock: 'available_stock',
      reserved_stock: 'total_reserved',
      product_name: 'product_name',
      category: 'category_name',
      stock_value: 'stock_value',
      revenue: 'revenue',
      units: 'units',
      days_since_sale: 'days_since_last_sale',
    };
    const requestedSort = String(filters.sort || (statusFilter === 'available' ? 'total_stock' : 'product_name'));
    const sortColumn = sortColumns[requestedSort] || sortColumns.total_stock;
    const defaultDirection = statusFilter === 'available' ? 'DESC' : 'ASC';
    const sortDirection = String(filters.order || defaultDirection).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const orderBy = `ORDER BY ${sortColumn} ${sortDirection} NULLS LAST, product_name ASC`;
    const key = `jtl:${tenantId}:inventory:list:${page}:${limit}:${searchTerm}:${statusFilter}:${categoryFilter}:${warehouseFilter}:${minStock}:${maxStock}:${minAvailable}:${maxAvailable}:${minReserved}:${maxReserved}:${minRevenue}:${maxRevenue}:${channelFilter}:${channels.join(',')}:${performanceClass}:${start}:${end}:${requestedSort}:${sortDirection}`;
    return this.cache.getOrSet(key, 300, async () => {
      const params: unknown[] = [
        tenantId, limit, offset, searchTerm, statusFilter, categoryFilter,
        warehouseFilter, minStock, maxStock, start, end, channelFilter,
        performanceClass, minAvailable, maxAvailable, minReserved, maxReserved,
        minRevenue, maxRevenue, channels,
      ];
      const rows = await this.db.query(
          `
          WITH current_stock AS (
            ${inventoryAggregationSql()}
          ), sales AS (
            SELECT oi.tenant_id, oi.product_id,
              COALESCE(SUM(oi.line_total_gross), 0)::float8 AS revenue,
              COALESCE(SUM(oi.quantity), 0)::float8 AS units,
              COUNT(DISTINCT o.jtl_order_id)::int AS orders,
              COUNT(DISTINCT o.customer_id)::int AS customers,
              MAX(o.order_date) AS last_sale,
              STRING_AGG(DISTINCT COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown'), ', ' ORDER BY COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')) AS sales_channels
            FROM order_items oi
            JOIN orders o ON o.tenant_id = oi.tenant_id AND o.jtl_order_id = oi.order_id
            WHERE oi.tenant_id = ANY($1::uuid[])
              AND o.order_date BETWEEN $10::date AND $11::date
              AND LOWER(COALESCE(o.status, '')) <> 'cancelled'
              AND ($12 = '' OR LOWER(COALESCE(o.channel, '')) = LOWER($12))
              AND (cardinality($20::text[]) = 0 OR LOWER(COALESCE(o.channel, '')) = ANY(ARRAY(SELECT LOWER(value) FROM unnest($20::text[]) AS value)))
            GROUP BY oi.tenant_id, oi.product_id
          ), base AS (
            SELECT
              p.id, p.jtl_product_id, p.name AS product_name, p.article_number,
              COALESCE(c.name, 'Uncategorized') AS category_name,
              COALESCE(inv.total_available, p.stock_quantity, 0)::float8 AS total_available,
              COALESCE(inv.total_available, p.stock_quantity, 0)::float8 AS stock,
              COALESCE(inv.total_available, p.stock_quantity, 0)::float8 AS stock_quantity,
              COALESCE(inv.on_hand_available, 0)::float8 AS available_stock,
              COALESCE(inv.total_reserved, 0)::float8 AS total_reserved,
              COALESCE(inv.reorder_point, 0)::float8 AS reorder_point,
              COALESCE(inv.warehouse_names, '') AS warehouse_names,
              COALESCE(s.revenue, 0)::float8 AS revenue,
              COALESCE(s.units, 0)::float8 AS units,
              COALESCE(s.orders, 0)::int AS orders,
              COALESCE(s.customers, 0)::int AS customers,
              COALESCE(s.sales_channels, '') AS sales_channels,
              s.last_sale,
              CASE WHEN s.last_sale IS NULL THEN NULL ELSE CURRENT_DATE - s.last_sale::date END AS days_since_last_sale,
              CASE WHEN COALESCE(s.units, 0) > 0 THEN COALESCE(s.units, 0) / $21::numeric ELSE 0 END AS average_daily_units,
              (COALESCE(inv.total_available, p.stock_quantity, 0) * COALESCE(NULLIF(p.unit_cost, 0), NULLIF(p.list_price_net, 0), 0))::float8 AS stock_value,
              p.unit_cost, p.list_price_net, p.list_price_gross, p.ean
            FROM products p
            LEFT JOIN current_stock inv ON ${inventoryJoinSql('inv', 'p')}
            LEFT JOIN sales s ON s.tenant_id = p.tenant_id AND s.product_id = p.jtl_product_id
            LEFT JOIN categories c ON c.tenant_id = p.tenant_id AND c.jtl_category_id = p.category_id
            WHERE p.tenant_id = ANY($1::uuid[]) AND p.is_active = true
            AND ($4 = '' OR p.name ILIKE '%' || $4 || '%' OR p.article_number ILIKE '%' || $4 || '%')
            AND ($6 = '' OR c.name = $6)
            AND ($7 = '' OR EXISTS (
              SELECT 1
              FROM inventory iw
              WHERE iw.tenant_id = p.tenant_id
                AND iw.jtl_product_id = p.jtl_product_id
                AND (iw.warehouse_name ILIKE '%' || $7 || '%' OR iw.jtl_warehouse_id::text = $7)
            ))
          ), classified AS (
            SELECT *,
              (total_available > 0 AND total_available <= 5) AS is_low_stock,
              CASE
                WHEN total_available <= 0 THEN 'out_of_stock'
                WHEN reorder_point > 0 AND total_available <= reorder_point THEN 'below_reorder_point'
                WHEN average_daily_units > 0 AND total_available / average_daily_units <= 7 THEN 'stockout_risk'
                WHEN total_available > 0 AND revenue = 0 THEN 'dead_stock'
                WHEN average_daily_units > 0 AND total_available / average_daily_units > 180 THEN 'overstock'
                WHEN average_daily_units >= 1 THEN 'fast_moving'
                WHEN average_daily_units >= 0.2 THEN 'average_performing'
                WHEN average_daily_units > 0 THEN 'slow_moving'
                ELSE 'no_demand'
              END AS classification
            FROM base
          ), filtered AS (
            SELECT *, COUNT(*) OVER()::int AS total_count FROM classified
            WHERE ($5 = 'all'
              OR ($5 = 'available' AND total_available > 0)
              OR ($5 = 'out_of_stock' AND total_available = 0)
              OR ($5 = 'low_stock' AND total_available > 0 AND total_available <= 5)
              OR ($5 = 'in_stock' AND total_available > 5)
              OR ($5 = 'high_stock' AND total_available > 100))
              AND ($8::numeric IS NULL OR total_available >= $8::numeric)
              AND ($9::numeric IS NULL OR total_available <= $9::numeric)
              AND ($13 = 'all' OR classification = $13 OR ($13 = 'stock_no_sales' AND total_available > 0 AND revenue = 0))
              AND ($14::numeric IS NULL OR available_stock >= $14::numeric)
              AND ($15::numeric IS NULL OR available_stock <= $15::numeric)
              AND ($16::numeric IS NULL OR total_reserved >= $16::numeric)
              AND ($17::numeric IS NULL OR total_reserved <= $17::numeric)
              AND ($18::numeric IS NULL OR revenue >= $18::numeric)
              AND ($19::numeric IS NULL OR revenue <= $19::numeric)
          )
          SELECT * FROM filtered
          ${orderBy}
          LIMIT $2 OFFSET $3
          `,
          [...params, days],
        );

      return buildPaginatedResult(
        rows as Record<string, unknown>[],
        rows[0]?.total_count,
        page,
        limit,
      );
    });
  }

  async exportList(scope: TenantScope, filters: InventoryFilters): Promise<string> {
    if (filters.dataset === 'alerts') return this.exportAlerts(scope, filters);
    if (filters.dataset === 'dsi') return this.exportDsi(scope, filters);
    if (filters.dataset === 'demand') return this.exportDemand(scope, filters);
    if (filters.dataset === 'categories') return this.exportCategories(scope, filters);

    const rows: Record<string, unknown>[] = [];
    let total = 0;
    for (let page = 1; rows.length < CSV_EXPORT_MAX_ROWS; page += 1) {
      const result = await this.getList(scope, { ...filters, page, limit: CSV_EXPORT_MAX_ROWS });
      rows.push(...(result.rows as Record<string, unknown>[]));
      total = result.total;
      if (!result.has_next || rows.length >= total) break;
    }
    const columns: CsvColumn<Record<string, unknown>>[] = [
      { key: 'article_number', header: 'Article Number' },
      { key: 'product_name', header: 'Product' },
      { key: 'category_name', header: 'Category' },
      { key: 'warehouse_names', header: 'Warehouses' },
      { key: 'total_available', header: 'Total Stock' },
      { key: 'available_stock', header: 'Available Stock' },
      { key: 'total_reserved', header: 'Reserved Stock' },
      { key: 'reorder_point', header: 'Reorder Point' },
      { key: 'revenue', header: 'Revenue' },
      { key: 'units', header: 'Units Sold' },
      { key: 'orders', header: 'Orders' },
      { key: 'customers', header: 'Customers' },
      { key: 'sales_channels', header: 'Sales Channels' },
      { key: 'last_sale', header: 'Last Sale' },
      { key: 'days_since_last_sale', header: 'Days Since Last Sale', value: (row) => row.days_since_last_sale ?? 'No sale' },
      { key: 'average_daily_units', header: 'Average Daily Units' },
      { key: 'classification', header: 'Performance Classification' },
      { key: 'is_low_stock', header: 'Low Stock' },
      { key: 'unit_cost', header: 'Unit Cost' },
      { key: 'list_price_net', header: 'List Price Net' },
      { key: 'list_price_gross', header: 'List Price Gross' },
      {
        key: 'stock_value',
        header: 'Stock Value',
        value: (row) => Number(row.total_available || 0) * Number(row.list_price_net || row.unit_cost || 0),
      },
      { key: 'ean', header: 'EAN' },
    ];
    return buildCsv(rows, columns, {
      metadata: {
        module: 'inventory',
        stock_semantics: 'total_available is JTL TotalStock / Bestand alle Lager',
        total_matching_rows: total,
        exported_rows: rows.length,
        complete: rows.length >= total,
        row_limit: CSV_EXPORT_MAX_ROWS,
        generated_at: new Date().toISOString(),
      },
    });
  }

  private async exportAlerts(scope: TenantScope, filters: InventoryFilters): Promise<string> {
    const rows: Record<string, unknown>[] = [];
    let total = 0;
    for (let page = 1; rows.length < CSV_EXPORT_MAX_ROWS; page += 1) {
      const result = await this.getAlertsPaged(scope, { ...filters, page, limit: CSV_EXPORT_MAX_ROWS });
      rows.push(...(result.rows as Record<string, unknown>[]));
      total = result.total;
      if (!result.has_next || rows.length >= total) break;
    }
    return buildCsv(rows, [
      { key: 'article_number', header: 'Article Number' },
      { key: 'product_name', header: 'Product' },
      { key: 'category_name', header: 'Category' },
      { key: 'warehouse_names', header: 'Warehouses' },
      { key: 'sales_channels', header: 'Recent Sales Channels' },
      { key: 'status', header: 'Status' },
      { key: 'total_available', header: 'Total Stock' },
      { key: 'days_of_stock', header: 'Days of Stock', value: (row) => row.days_of_stock ?? 'No demand' },
      { key: 'reorder_point', header: 'Reorder Point' },
    ], {
      metadata: this.exportMetadata('inventory_alerts', total, rows.length),
    });
  }

  private async exportDsi(scope: TenantScope, filters: InventoryFilters): Promise<string> {
    const rows: Record<string, unknown>[] = [];
    let total = 0;
    for (let page = 1; rows.length < CSV_EXPORT_MAX_ROWS; page += 1) {
      const result = await this.getMovements(scope, { ...filters, page, limit: 500 });
      rows.push(...(result.dsi as Record<string, unknown>[]));
      total = Number(result.dsi_total) || 0;
      if (rows.length >= total || result.dsi.length === 0) break;
    }
    return buildCsv(rows, [
      { key: 'article_number', header: 'Article Number' },
      { key: 'name', header: 'Product' },
      { key: 'category_name', header: 'Category' },
      { key: 'warehouse_names', header: 'Warehouses' },
      { key: 'stock_quantity', header: 'Total Stock' },
      { key: 'avg_daily_sales', header: 'Average Daily Demand' },
      { key: 'dsi', header: 'Days of Stock', value: (row) => row.dsi ?? 'No demand' },
      {
        key: 'classification',
        header: 'Classification',
        value: (row) => {
          if (row.dsi == null) return 'No demand';
          const dsi = Number(row.dsi);
          if (dsi <= 0) return 'Critical';
          if (dsi <= 7) return 'Low cover';
          if (dsi <= 30) return 'Watch';
          if (dsi > 90) return 'Overstock';
          return 'Healthy';
        },
      },
    ], {
      metadata: this.exportMetadata('inventory_days_of_stock', total, rows.length),
    });
  }

  private async exportDemand(scope: TenantScope, filters: InventoryFilters): Promise<string> {
    const result = await this.getMovements(scope, { ...filters, page: 1, limit: 1 });
    const rows = result.daily as Record<string, unknown>[];
    return buildCsv(rows, [
      { key: 'd', header: 'Date' },
      { key: 'ord', header: 'Orders' },
      { key: 'rev', header: 'Revenue' },
    ], {
      metadata: {
        module: 'inventory_demand',
        exported_rows: rows.length,
        complete: true,
        generated_at: new Date().toISOString(),
      },
    });
  }

  private async exportCategories(scope: TenantScope, filters: InventoryFilters): Promise<string> {
    const rows: Record<string, unknown>[] = [];
    let total = 0;
    for (let page = 1; rows.length < CSV_EXPORT_MAX_ROWS; page += 1) {
      const result = await this.getCategories(scope, { ...filters, page, limit: 200 });
      rows.push(...(result.rows as Record<string, unknown>[]));
      total = result.total;
      if (!result.has_next || rows.length >= total) break;
    }
    return buildCsv(rows, [
      { key: 'category_name', header: 'Category' },
      { key: 'products', header: 'Products' },
      { key: 'out_of_stock', header: 'Out of Stock Products' },
      { key: 'total_stock', header: 'Total Stock' },
      { key: 'available_stock', header: 'Available Stock' },
      { key: 'reserved_stock', header: 'Reserved Stock' },
      { key: 'stock_value', header: 'Stock Value' },
    ], {
      metadata: this.exportMetadata('inventory_categories', total, rows.length),
    });
  }

  private exportMetadata(module: string, total: number, exported: number) {
    return {
      module,
      total_matching_rows: total,
      exported_rows: exported,
      complete: exported >= total,
      row_limit: CSV_EXPORT_MAX_ROWS,
      generated_at: new Date().toISOString(),
    };
  }

  async getCategories(scope: TenantScope, filters: InventoryFilters) {
    const tenantId = scope.tenantIds;
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(filters.limit) || 20));
    const offset = (page - 1) * limit;
    const search = String(filters.search || '').trim();
    const rows = await this.db.query(
      `
      WITH product_stock AS (
        SELECT
          COALESCE(NULLIF(TRIM(c.name), ''), 'Uncategorized') AS category_name,
          COALESCE(inv.total_available, p.stock_quantity, 0) AS total_stock,
          COALESCE(inv.on_hand_available, 0) AS available_stock,
          COALESCE(inv.total_reserved, 0) AS reserved_stock,
          COALESCE(NULLIF(p.unit_cost, 0), NULLIF(p.list_price_net, 0), 0) AS unit_value
        FROM products p
        LEFT JOIN (
          ${inventoryAggregationSql()}
        ) inv ON ${inventoryJoinSql('inv', 'p')}
        LEFT JOIN categories c
          ON c.tenant_id = p.tenant_id
         AND c.jtl_category_id = p.category_id
        WHERE p.tenant_id = ANY($1::uuid[])
          AND p.is_active = true
      ), grouped AS (
        SELECT
          category_name,
          COUNT(*)::int AS products,
          COUNT(*) FILTER (WHERE total_stock = 0)::int AS out_of_stock,
          COALESCE(SUM(total_stock), 0) AS total_stock,
          COALESCE(SUM(available_stock), 0) AS available_stock,
          COALESCE(SUM(reserved_stock), 0) AS reserved_stock,
          ROUND(COALESCE(SUM(total_stock * unit_value), 0)::numeric, 2) AS stock_value
        FROM product_stock
        GROUP BY category_name
      )
      SELECT grouped.*, COUNT(*) OVER()::int AS total_groups
      FROM grouped
      WHERE ($4 = '' OR category_name ILIKE '%' || $4 || '%')
      ORDER BY stock_value DESC, category_name ASC
      LIMIT $2 OFFSET $3
      `,
      [tenantId, limit, offset, search],
    );
    return buildPaginatedResult(
      rows.map(({ total_groups: _totalGroups, ...row }: Record<string, unknown>) => row),
      rows[0]?.total_groups ?? 0,
      page,
      limit,
    );
  }

  async getMovements(scope: TenantScope, filters: InventoryFilters) {
    const tenantId = scope.tenantIds;
    const { start, end, days } = inventoryDateRange(filters.range, filters.from, filters.to);
    const page = Math.max(1, Number.parseInt(String(filters.page ?? '1'), 10) || 1);
    const limit = Math.min(Math.max(1, Number.parseInt(String(filters.limit ?? '20'), 10) || 20), CSV_EXPORT_MAX_ROWS);
    const offset = (page - 1) * limit;
    const searchTerm = String(filters.search || '').trim();
    const category = String(filters.category || '').trim();
    const warehouse = String(filters.warehouse || '').trim();
    const channel = String(filters.channel || '').trim();
    const performanceClass = String(filters.performanceClass || 'all').trim().toLowerCase();
    const minDaysOfStock = filters.minDaysOfStock == null ? null : Number(filters.minDaysOfStock);
    const maxDaysOfStock = filters.maxDaysOfStock == null ? null : Number(filters.maxDaysOfStock);
    const key  = `jtl:${tenantId}:inventory:movements:${start}:${end}:${page}:${limit}:${searchTerm}:${category}:${warehouse}:${channel}:${performanceClass}:${minDaysOfStock}:${maxDaysOfStock}`;
    return this.cache.getOrSet(key, 30, async () => {
      const dsi = await this.db.query(
        `
        WITH current_stock AS (
          ${inventoryAggregationSql()}
        ), sales AS (
          SELECT oi.tenant_id, oi.product_id, SUM(oi.quantity)::float8 / $4::numeric AS avg_daily
          FROM order_items oi
          JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
          WHERE oi.tenant_id = ANY($1::uuid[])
            AND o.order_date BETWEEN $2::date AND $3::date
            AND LOWER(COALESCE(o.status, '')) <> 'cancelled'
            AND ($10 = '' OR LOWER(COALESCE(o.channel, '')) = LOWER($10))
          GROUP BY oi.tenant_id, oi.product_id
        ), base AS (
          SELECT p.name, p.article_number,
            COALESCE(c.name, 'Uncategorized') AS category_name,
            COALESCE(inv.warehouse_names, '') AS warehouse_names,
            COALESCE(inv.total_available, p.stock_quantity, 0)::float8 AS stock_quantity,
            COALESCE(s.avg_daily, 0)::float8 AS avg_daily_sales,
            CASE WHEN COALESCE(s.avg_daily, 0) > 0
              THEN ROUND(COALESCE(inv.total_available, p.stock_quantity, 0) / s.avg_daily)::int
              ELSE NULL END AS dsi
          FROM products p
          LEFT JOIN current_stock inv ON ${inventoryJoinSql('inv', 'p')}
          LEFT JOIN sales s ON s.tenant_id = p.tenant_id AND s.product_id = p.jtl_product_id
          LEFT JOIN categories c ON c.tenant_id = p.tenant_id AND c.jtl_category_id = p.category_id
          WHERE p.tenant_id = ANY($1::uuid[]) AND p.is_active = true
            AND ($7 = '' OR p.name ILIKE '%' || $7 || '%' OR p.article_number ILIKE '%' || $7 || '%')
            AND ($8 = '' OR c.name = $8)
            AND ($9 = '' OR EXISTS (
              SELECT 1 FROM inventory iw
              WHERE iw.tenant_id = p.tenant_id AND iw.jtl_product_id = p.jtl_product_id
                AND (iw.warehouse_name ILIKE '%' || $9 || '%' OR iw.jtl_warehouse_id::text = $9)
            ))
            AND ($10 = '' OR s.product_id IS NOT NULL)
        ), classified AS (
          SELECT *, CASE
            WHEN dsi IS NULL THEN 'no_demand'
            WHEN dsi <= 0 THEN 'critical'
            WHEN dsi <= 7 THEN 'low_cover'
            WHEN dsi <= 30 THEN 'watch'
            WHEN dsi > 90 THEN 'overstock'
            ELSE 'healthy'
          END AS classification
          FROM base
        ), filtered AS (
          SELECT *, COUNT(*) OVER()::int AS total_count
          FROM classified
          WHERE ($11::numeric IS NULL OR dsi >= $11::numeric)
            AND ($12::numeric IS NULL OR dsi <= $12::numeric)
            AND ($13 = 'all' OR classification = $13)
        )
        SELECT * FROM filtered
        ORDER BY dsi ASC NULLS LAST, name ASC
        LIMIT $5 OFFSET $6
        `,
        [tenantId, start, end, days, limit, offset, searchTerm, category, warehouse, channel, minDaysOfStock, maxDaysOfStock, performanceClass],
      );

      const daily = await this.db.query(
        `
        SELECT
          order_date::date AS d,
          COUNT(*)         AS ord,
          COALESCE(SUM(gross_revenue), 0) AS rev
        FROM orders
        WHERE tenant_id = ANY($1::uuid[])
          AND order_date BETWEEN $2::date AND $3::date
          AND status NOT IN ('cancelled', 'returned')
          AND ($4 = '' OR LOWER(COALESCE(channel, '')) = LOWER($4))
        GROUP BY order_date::date
        ORDER BY order_date::date
        `,
        [tenantId, start, end, channel],
      );

      return {
        warehouses: [],
        dsi,
        dsi_page: page,
        dsi_limit: limit,
        dsi_total: dsi[0]?.total_count ?? 0,
        daily,
      };
    });
  }
}
