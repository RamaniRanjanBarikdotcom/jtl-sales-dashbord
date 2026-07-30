import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PlatformConfigService, FeatureFlag } from '../../config/platform-config.service';
import { TenantScope } from '../../common/types/auth-request';
import { ComparisonQueryDto, ProductCompareDto, SavedViewDto } from './comparison.dto';

type Period = { start: string; end: string };

const METRIC_DEFINITIONS = [
  { key: 'revenue', name: 'Net revenue', formula: 'SUM(orders.net_revenue)', unit: 'currency', exclusions: 'Cancelled orders and zero-value orders' },
  { key: 'orders', name: 'Orders', formula: 'COUNT(DISTINCT orders.jtl_order_id)', unit: 'count', exclusions: 'Cancelled orders' },
  { key: 'average_order_value', name: 'Average order value', formula: 'Net revenue / orders', unit: 'currency', exclusions: 'Periods without orders' },
  { key: 'gross_margin', name: 'Gross margin', formula: 'Net revenue - cost of goods', unit: 'currency', exclusions: 'Rows without revenue' },
  { key: 'units_sold', name: 'Units sold', formula: 'SUM(order_items.quantity)', unit: 'count', exclusions: 'Cancelled orders' },
  { key: 'stock_cover_days', name: 'Stock cover', formula: 'Current stock / average daily units sold', unit: 'days', exclusions: 'Capped at 999 when there is no recent demand' },
  { key: 'dead_stock', name: 'Dead stock', formula: 'Stock > 0 and no sale within configured threshold', unit: 'boolean', exclusions: 'Default threshold is 90 days' },
  { key: 'repeat_customer', name: 'Repeat customer', formula: 'Customer total_orders > 1', unit: 'boolean', exclusions: 'None' },
];

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function resolvePeriod(query: ComparisonQueryDto): Period {
  const now = new Date();
  const end = query.to || isoDate(now);
  if (query.from) return { start: query.from, end };
  const today = isoDate(now);
  const range = query.range || '30D';
  if (range === 'TODAY' || range === 'DAY') return { start: today, end: today };
  if (range === 'YESTERDAY') {
    const yesterday = isoDate(new Date(now.getTime() - 86400000));
    return { start: yesterday, end: yesterday };
  }
  if (range === 'MONTH') return { start: isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), end };
  if (range === 'YEAR' || range === 'YTD') return { start: `${now.getUTCFullYear()}-01-01`, end };
  if (range === 'ALL') return { start: '2000-01-01', end };
  const days = ({ '7D': 7, '30D': 30, '3M': 90, '6M': 180, '12M': 365, '2Y': 730, '5Y': 1825 } as Record<string, number>)[range] || 30;
  return { start: isoDate(new Date(now.getTime() - (days - 1) * 86400000)), end };
}

function comparisonPeriod(current: Period, query: ComparisonQueryDto): Period | null {
  const mode = query.compareMode || 'previous_period';
  if (mode === 'none') return null;
  if (mode === 'custom') {
    if (!query.compareFrom || !query.compareTo) throw new BadRequestException('Custom comparison requires compareFrom and compareTo');
    return { start: query.compareFrom, end: query.compareTo };
  }
  const start = new Date(`${current.start}T00:00:00Z`);
  const end = new Date(`${current.end}T00:00:00Z`);
  if (mode === 'previous_year') {
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    end.setUTCFullYear(end.getUTCFullYear() - 1);
    return { start: isoDate(start), end: isoDate(end) };
  }
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  return {
    start: isoDate(new Date(start.getTime() - days * 86400000)),
    end: isoDate(new Date(end.getTime() - days * 86400000)),
  };
}

function delta(current: number, comparison: number): number | null {
  if (current === 0 && comparison === 0) return 0;
  return comparison === 0 ? null : Math.round(((current - comparison) / comparison) * 1000) / 10;
}

function channelIds(value?: string): string[] {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean).slice(0, 50);
}

@Injectable()
export class ComparisonService {
  constructor(
    private readonly db: DataSource,
    private readonly config: PlatformConfigService,
  ) {}

  private assertEnabled(flag: FeatureFlag = 'COMPARISON_CENTRE_ENABLED') {
    if (!this.config.enabled('COMPARISON_CENTRE_ENABLED') || !this.config.enabled(flag)) {
      throw new NotFoundException('Comparison feature is disabled');
    }
  }

  private periods(query: ComparisonQueryDto) {
    const current = resolvePeriod(query);
    return { current, comparison: comparisonPeriod(current, query) };
  }

  private page(query: ComparisonQueryDto) {
    const limit = Math.min(100, Math.max(1, query.limit || 50));
    const page = Math.max(1, query.page || 1);
    return { page, limit, offset: (page - 1) * limit };
  }

  private filters(query: ComparisonQueryDto) {
    return [
      channelIds(query.channels),
      query.status && query.status !== 'all' ? query.status.toLowerCase() : '',
      query.country || '',
      query.region || '',
    ];
  }

  private async freshness(scope: TenantScope) {
    const [row] = await this.db.query(
      `SELECT GREATEST(
        COALESCE((SELECT MAX(synced_at) FROM orders WHERE tenant_id = ANY($1::uuid[])), '-infinity'),
        COALESCE((SELECT MAX(synced_at) FROM products WHERE tenant_id = ANY($1::uuid[])), '-infinity'),
        COALESCE((SELECT MAX(synced_at) FROM inventory WHERE tenant_id = ANY($1::uuid[])), '-infinity'),
        COALESCE((SELECT MAX(synced_at) FROM customers WHERE tenant_id = ANY($1::uuid[])), '-infinity')
      ) AS last_synced_at`,
      [scope.tenantIds],
    );
    return row?.last_synced_at || null;
  }

  private async salesTotals(scope: TenantScope, period: Period, query: ComparisonQueryDto) {
    const [channels, status, country, region] = this.filters(query);
    const [row] = await this.db.query(
      `SELECT
        COALESCE(SUM(COALESCE(o.net_revenue, o.gross_revenue)), 0)::float8 AS revenue,
        COUNT(DISTINCT o.jtl_order_id)::int AS orders,
        COALESCE(SUM(o.cost_of_goods), 0)::float8 AS cost_of_goods,
        COALESCE(SUM(o.item_count), 0)::float8 AS units
      FROM orders o
      LEFT JOIN channel_mappings cm
        ON cm.tenant_id = o.tenant_id AND cm.raw_channel = COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')
      WHERE o.tenant_id = ANY($1::uuid[])
        AND o.order_date BETWEEN $2::date AND $3::date
        AND LOWER(COALESCE(o.status, '')) <> 'cancelled'
        AND COALESCE(o.net_revenue, o.gross_revenue, 0) > 0
        AND (cardinality($4::text[]) = 0 OR COALESCE(cm.canonical_id, 'raw-' || md5(COALESCE(o.channel, 'Unknown'))) = ANY($4::text[]))
        AND ($5 = '' OR LOWER(COALESCE(o.status, '')) = $5)
        AND ($6 = '' OR LOWER(COALESCE(o.country, '')) = LOWER($6))
        AND ($7 = '' OR LOWER(COALESCE(o.region, '')) = LOWER($7))`,
      [scope.tenantIds, period.start, period.end, channels, status, country, region],
    );
    const revenue = Number(row?.revenue || 0);
    const orders = Number(row?.orders || 0);
    const cost = Number(row?.cost_of_goods || 0);
    return { revenue, orders, averageOrderValue: orders ? revenue / orders : 0, grossMargin: revenue - cost, units: Number(row?.units || 0) };
  }

  async summary(scope: TenantScope, query: ComparisonQueryDto) {
    this.assertEnabled();
    const { current, comparison } = this.periods(query);
    const [currentTotals, comparisonTotals, freshness] = await Promise.all([
      this.salesTotals(scope, current, query),
      comparison ? this.salesTotals(scope, comparison, query) : Promise.resolve(null),
      this.freshness(scope),
    ]);
    return {
      periods: { current, comparison },
      current: currentTotals,
      comparison: comparisonTotals,
      change: comparisonTotals ? {
        revenue: delta(currentTotals.revenue, comparisonTotals.revenue),
        orders: delta(currentTotals.orders, comparisonTotals.orders),
        averageOrderValue: delta(currentTotals.averageOrderValue, comparisonTotals.averageOrderValue),
        grossMargin: delta(currentTotals.grossMargin, comparisonTotals.grossMargin),
        units: delta(currentTotals.units, comparisonTotals.units),
      } : null,
      freshness: { lastSyncedAt: freshness },
      scope: scope.scope,
    };
  }

  async salesTrend(scope: TenantScope, query: ComparisonQueryDto) {
    this.assertEnabled('COMPARISON_CHANNEL_DRILLDOWN_ENABLED');
    const { current, comparison } = this.periods(query);
    const granularity = ['day', 'week', 'month', 'quarter', 'year'].includes(query.granularity || '') ? query.granularity : 'day';
    const [channels, status, country, region] = this.filters(query);
    const run = (period: Period) => this.db.query(
      `SELECT date_trunc($4, o.order_date)::date AS bucket,
        COALESCE(SUM(COALESCE(o.net_revenue, o.gross_revenue)), 0)::float8 AS revenue,
        COUNT(DISTINCT o.jtl_order_id)::int AS orders
      FROM orders o
      LEFT JOIN channel_mappings cm
        ON cm.tenant_id = o.tenant_id AND cm.raw_channel = COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')
      WHERE o.tenant_id = ANY($1::uuid[]) AND o.order_date BETWEEN $2::date AND $3::date
        AND LOWER(COALESCE(o.status, '')) <> 'cancelled'
        AND COALESCE(o.net_revenue, o.gross_revenue, 0) > 0
        AND (cardinality($5::text[]) = 0 OR COALESCE(cm.canonical_id, 'raw-' || md5(COALESCE(o.channel, 'Unknown'))) = ANY($5::text[]))
        AND ($6 = '' OR LOWER(COALESCE(o.status, '')) = $6)
        AND ($7 = '' OR LOWER(COALESCE(o.country, '')) = LOWER($7))
        AND ($8 = '' OR LOWER(COALESCE(o.region, '')) = LOWER($8))
      GROUP BY 1 ORDER BY 1`,
      [scope.tenantIds, period.start, period.end, granularity, channels, status, country, region],
    );
    const [currentRows, comparisonRows] = await Promise.all([run(current), comparison ? run(comparison) : Promise.resolve([])]);
    return { periods: { current, comparison }, current: currentRows, comparison: comparisonRows, granularity };
  }

  async channels(scope: TenantScope, query: ComparisonQueryDto) {
    this.assertEnabled('COMPARISON_CHANNEL_DRILLDOWN_ENABLED');
    const { current, comparison } = this.periods(query);
    const { page, limit, offset } = this.page(query);
    const sortMap: Record<string, string> = { revenue: 'revenue', orders: 'orders', averageOrderValue: 'average_order_value', change: 'revenue_change' };
    const sort = sortMap[query.sort || 'revenue'] || 'revenue';
    const order = String(query.order || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const comparisonStart = comparison?.start || current.start;
    const comparisonEnd = comparison?.end || current.end;
    const requestedChannels = channelIds(query.channels);
    const [, status, country, region] = this.filters(query);
    const rows = await this.db.query(
      `WITH grouped AS (
        SELECT
          COALESCE(cm.canonical_id, 'raw-' || md5(COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown'))) AS channel_id,
          COALESCE(cm.display_name, NULLIF(TRIM(o.channel), ''), 'Unknown') AS channel_name,
          COALESCE(cm.channel_type, 'other') AS channel_type,
          ARRAY_AGG(DISTINCT COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')) AS raw_channels,
          COALESCE(SUM(COALESCE(o.net_revenue, o.gross_revenue)) FILTER (WHERE o.order_date BETWEEN $2::date AND $3::date), 0)::float8 AS revenue,
          COUNT(DISTINCT o.jtl_order_id) FILTER (WHERE o.order_date BETWEEN $2::date AND $3::date)::int AS orders,
          COALESCE(SUM(COALESCE(o.net_revenue, o.gross_revenue)) FILTER (WHERE o.order_date BETWEEN $4::date AND $5::date), 0)::float8 AS comparison_revenue
        FROM orders o
        LEFT JOIN channel_mappings cm ON cm.tenant_id = o.tenant_id AND cm.raw_channel = COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')
        WHERE o.tenant_id = ANY($1::uuid[])
          AND o.order_date BETWEEN LEAST($2::date, $4::date) AND GREATEST($3::date, $5::date)
          AND LOWER(COALESCE(o.status, '')) <> 'cancelled'
          AND COALESCE(o.net_revenue, o.gross_revenue, 0) > 0
          AND ($9 = '' OR LOWER(COALESCE(o.status, '')) = $9)
          AND ($10 = '' OR LOWER(COALESCE(o.country, '')) = LOWER($10))
          AND ($11 = '' OR LOWER(COALESCE(o.region, '')) = LOWER($11))
        GROUP BY 1,2,3
      ), ranked AS (
        SELECT *, CASE WHEN orders > 0 THEN revenue / orders ELSE 0 END AS average_order_value,
          CASE WHEN comparison_revenue = 0 THEN NULL ELSE ((revenue - comparison_revenue) / comparison_revenue) * 100 END AS revenue_change,
          COUNT(*) OVER()::int AS total_count
        FROM grouped
        WHERE cardinality($8::text[]) = 0 OR channel_id = ANY($8::text[])
      )
      SELECT * FROM ranked ORDER BY ${sort} ${order} NULLS LAST LIMIT $6 OFFSET $7`,
      [scope.tenantIds, current.start, current.end, comparisonStart, comparisonEnd, limit, offset, requestedChannels, status, country, region],
    );
    return { rows, total: Number(rows[0]?.total_count || 0), page, limit, periods: { current, comparison } };
  }

  async channelDetail(scope: TenantScope, channelId: string, query: ComparisonQueryDto) {
    const result = await this.channels(scope, { ...query, channels: channelId, page: 1, limit: 1 });
    const channel = result.rows.find((row: Record<string, unknown>) => row.channel_id === channelId);
    if (!channel) throw new NotFoundException('Channel not found');
    const products = await this.products(scope, { ...query, channels: channelId, page: 1, limit: 20 });
    const orders = await this.orders(scope, { ...query, channels: channelId, page: 1, limit: 20 });
    return { channel, products, orders, periods: result.periods };
  }

  async products(scope: TenantScope, query: ComparisonQueryDto) {
    this.assertEnabled('COMPARISON_PRODUCT_PERFORMANCE_ENABLED');
    const { current, comparison } = this.periods(query);
    const { page, limit, offset } = this.page(query);
    const sortMap: Record<string, string> = { revenue: 'revenue', units: 'units', stock: 'stock', name: 'name', change: 'revenue_change' };
    const sort = sortMap[query.sort || 'revenue'] || 'revenue';
    const order = String(query.order || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const channels = channelIds(query.channels);
    const performance = query.performance || 'all';
    const comparisonStart = comparison?.start || current.start;
    const comparisonEnd = comparison?.end || current.end;
    const rows = await this.db.query(
      `WITH sales AS (
        SELECT oi.tenant_id, oi.product_id,
          COALESCE(SUM(oi.line_total_gross) FILTER (WHERE o.order_date BETWEEN $2::date AND $3::date), 0)::float8 AS revenue,
          COALESCE(SUM(oi.quantity) FILTER (WHERE o.order_date BETWEEN $2::date AND $3::date), 0)::float8 AS units,
          COUNT(DISTINCT o.jtl_order_id) FILTER (WHERE o.order_date BETWEEN $2::date AND $3::date)::int AS orders,
          COALESCE(SUM(oi.line_total_gross) FILTER (WHERE o.order_date BETWEEN $4::date AND $5::date), 0)::float8 AS comparison_revenue,
          MAX(o.order_date) AS last_sale_date
        FROM order_items oi
        JOIN orders o ON o.tenant_id = oi.tenant_id AND o.jtl_order_id = oi.order_id
        LEFT JOIN channel_mappings cm ON cm.tenant_id = o.tenant_id AND cm.raw_channel = COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')
        WHERE oi.tenant_id = ANY($1::uuid[])
          AND o.order_date BETWEEN LEAST($2::date, $4::date) AND GREATEST($3::date, $5::date)
          AND LOWER(COALESCE(o.status, '')) <> 'cancelled'
          AND (cardinality($6::text[]) = 0 OR COALESCE(cm.canonical_id, 'raw-' || md5(COALESCE(o.channel, 'Unknown'))) = ANY($6::text[]))
        GROUP BY oi.tenant_id, oi.product_id
      ), stock AS (
        SELECT tenant_id, jtl_product_id, SUM(total)::float8 AS stock
        FROM inventory WHERE tenant_id = ANY($1::uuid[]) GROUP BY tenant_id, jtl_product_id
      ), base AS (
        SELECT p.id, p.jtl_product_id, p.article_number AS sku, p.name,
          COALESCE(c.name, 'Uncategorised') AS category,
          COALESCE(s.revenue, 0) AS revenue, COALESCE(s.units, 0) AS units,
          COALESCE(s.orders, 0) AS orders, COALESCE(s.comparison_revenue, 0) AS comparison_revenue,
          COALESCE(st.stock, p.stock_quantity, 0) AS stock, s.last_sale_date,
          CASE WHEN COALESCE(s.comparison_revenue, 0) = 0 THEN NULL
            ELSE ((COALESCE(s.revenue, 0) - s.comparison_revenue) / s.comparison_revenue) * 100 END AS revenue_change
        FROM products p
        LEFT JOIN sales s ON s.tenant_id = p.tenant_id AND s.product_id = p.jtl_product_id
        LEFT JOIN stock st ON st.tenant_id = p.tenant_id AND st.jtl_product_id = p.jtl_product_id
        LEFT JOIN categories c ON c.tenant_id = p.tenant_id AND c.jtl_category_id = p.category_id
        WHERE p.tenant_id = ANY($1::uuid[]) AND p.is_active = true
          AND ($7 = '' OR p.name ILIKE '%' || $7 || '%' OR p.article_number ILIKE '%' || $7 || '%')
          AND ($8 = '' OR c.name ILIKE $8)
      ), filtered AS (
        SELECT *, COUNT(*) OVER()::int AS total_count FROM base
        WHERE ($9 = 'all'
          OR ($9 = 'zero_sales' AND revenue = 0)
          OR ($9 = 'stock_no_sales' AND revenue = 0 AND stock > 0)
          OR ($9 = 'growing' AND revenue_change > 0)
          OR ($9 = 'declining' AND revenue_change < 0))
      )
      SELECT * FROM filtered ORDER BY ${sort} ${order} NULLS LAST LIMIT $10 OFFSET $11`,
      [scope.tenantIds, current.start, current.end, comparisonStart, comparisonEnd, channels, query.search || '', query.category || '', performance, limit, offset],
    );
    return { rows, total: Number(rows[0]?.total_count || 0), page, limit, periods: { current, comparison } };
  }

  async compareProducts(scope: TenantScope, body: ProductCompareDto) {
    this.assertEnabled('COMPARISON_PRODUCT_PERFORMANCE_ENABLED');
    const ids = [...new Set((body.productIds || []).filter(Number.isFinite))].slice(0, 10);
    if (ids.length < 2) throw new BadRequestException('Select at least two products');
    return this.db.query(
      `SELECT p.id, p.jtl_product_id, p.article_number AS sku, p.name,
        COALESCE(SUM(oi.line_total_gross), 0)::float8 AS revenue,
        COALESCE(SUM(oi.quantity), 0)::float8 AS units,
        COUNT(DISTINCT o.jtl_order_id)::int AS orders,
        COALESCE(MAX(p.stock_quantity), 0)::float8 AS stock
      FROM products p
      LEFT JOIN order_items oi ON oi.tenant_id = p.tenant_id AND oi.product_id = p.jtl_product_id
      LEFT JOIN orders o ON o.tenant_id = oi.tenant_id AND o.jtl_order_id = oi.order_id
        AND ($3::date IS NULL OR o.order_date >= $3::date) AND ($4::date IS NULL OR o.order_date <= $4::date)
      WHERE p.tenant_id = ANY($1::uuid[]) AND p.id = ANY($2::bigint[])
      GROUP BY p.id ORDER BY revenue DESC`,
      [scope.tenantIds, ids, body.from || null, body.to || null],
    );
  }

  async productDetail(scope: TenantScope, productId: number, query: ComparisonQueryDto) {
    const product = await this.db.query(
      `SELECT p.*, c.name AS category FROM products p
       LEFT JOIN categories c ON c.tenant_id = p.tenant_id AND c.jtl_category_id = p.category_id
       WHERE p.tenant_id = ANY($1::uuid[]) AND p.id = $2 LIMIT 1`,
      [scope.tenantIds, productId],
    );
    if (!product[0]) throw new NotFoundException('Product not found');
    const performance = await this.products(scope, { ...query, search: product[0].article_number || product[0].name, page: 1, limit: 1 });
    const inventory = await this.db.query(
      `SELECT warehouse_name, available::float8, reserved::float8, total::float8, synced_at
       FROM inventory WHERE tenant_id = ANY($1::uuid[]) AND jtl_product_id = $2 ORDER BY warehouse_name`,
      [scope.tenantIds, product[0].jtl_product_id],
    );
    return { product: product[0], performance: performance.rows[0] || null, inventory };
  }

  async productChannelMatrix(scope: TenantScope, query: ComparisonQueryDto) {
    this.assertEnabled('COMPARISON_PRODUCT_PERFORMANCE_ENABLED');
    const current = resolvePeriod(query);
    return this.db.query(
      `SELECT p.id AS product_id, p.article_number AS sku, p.name AS product_name,
        COALESCE(cm.canonical_id, 'raw-' || md5(COALESCE(o.channel, 'Unknown'))) AS channel_id,
        COALESCE(cm.display_name, NULLIF(TRIM(o.channel), ''), 'Unknown') AS channel_name,
        SUM(oi.line_total_gross)::float8 AS revenue, SUM(oi.quantity)::float8 AS units
       FROM order_items oi
       JOIN orders o ON o.tenant_id = oi.tenant_id AND o.jtl_order_id = oi.order_id
       JOIN products p ON p.tenant_id = oi.tenant_id AND p.jtl_product_id = oi.product_id
       LEFT JOIN channel_mappings cm ON cm.tenant_id = o.tenant_id AND cm.raw_channel = COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')
       WHERE oi.tenant_id = ANY($1::uuid[]) AND o.order_date BETWEEN $2::date AND $3::date
         AND LOWER(COALESCE(o.status, '')) <> 'cancelled'
       GROUP BY p.id, p.article_number, p.name, 4, 5
       ORDER BY revenue DESC LIMIT 500`,
      [scope.tenantIds, current.start, current.end],
    );
  }

  async inventory(scope: TenantScope, query: ComparisonQueryDto) {
    this.assertEnabled('COMPARISON_INVENTORY_PERFORMANCE_ENABLED');
    const { page, limit, offset } = this.page(query);
    const deadStockDays = query.deadStockDays || 90;
    const performance = query.performance || 'all';
    const sortMap: Record<string, string> = { stock: 'stock', stockValue: 'stock_value', units30d: 'units_30d', coverDays: 'stock_cover_days', name: 'name' };
    const sort = sortMap[query.sort || 'stockValue'] || 'stock_value';
    const order = String(query.order || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const rows = await this.db.query(
      `WITH sales AS (
        SELECT oi.tenant_id, oi.product_id,
          COALESCE(SUM(oi.quantity) FILTER (WHERE o.order_date >= CURRENT_DATE - 30), 0)::float8 AS units_30d,
          COALESCE(SUM(oi.quantity) FILTER (WHERE o.order_date >= CURRENT_DATE - 90), 0)::float8 AS units_90d,
          MAX(o.order_date) AS last_sale_date
        FROM order_items oi JOIN orders o ON o.tenant_id = oi.tenant_id AND o.jtl_order_id = oi.order_id
        WHERE oi.tenant_id = ANY($1::uuid[]) AND LOWER(COALESCE(o.status, '')) <> 'cancelled'
        GROUP BY oi.tenant_id, oi.product_id
      ), current_stock AS (
        SELECT i.tenant_id, i.jtl_product_id, SUM(i.total)::float8 AS stock,
          STRING_AGG(DISTINCT COALESCE(i.warehouse_name, 'Unknown'), ', ' ORDER BY COALESCE(i.warehouse_name, 'Unknown')) AS warehouses
        FROM inventory i WHERE i.tenant_id = ANY($1::uuid[])
          AND ($2 = '' OR i.warehouse_name ILIKE $2)
        GROUP BY i.tenant_id, i.jtl_product_id
      ), base AS (
        SELECT p.id, p.jtl_product_id, p.article_number AS sku, p.name,
          COALESCE(c.name, 'Uncategorised') AS category, cs.warehouses,
          COALESCE(cs.stock, 0) AS stock, COALESCE(p.unit_cost, 0)::float8 AS unit_cost,
          (COALESCE(cs.stock, 0) * COALESCE(p.unit_cost, 0))::float8 AS stock_value,
          COALESCE(s.units_30d, 0) AS units_30d, COALESCE(s.units_90d, 0) AS units_90d, s.last_sale_date,
          CASE WHEN COALESCE(s.units_30d, 0) = 0 THEN 999
            ELSE LEAST(999, ROUND((COALESCE(cs.stock, 0) / (s.units_30d / 30.0))::numeric, 1))::float8 END AS stock_cover_days,
          CASE
            WHEN COALESCE(cs.stock, 0) <= 0 AND COALESCE(s.units_30d, 0) > 0 THEN 'stockout_risk'
            WHEN COALESCE(cs.stock, 0) > 0 AND (s.last_sale_date IS NULL OR s.last_sale_date < CURRENT_DATE - $3::int) THEN 'dead_stock'
            WHEN COALESCE(s.units_30d, 0) >= COALESCE(cs.stock, 0) AND COALESCE(cs.stock, 0) > 0 THEN 'fast_moving'
            WHEN COALESCE(s.units_90d, 0) > 0 AND COALESCE(s.units_30d, 0) = 0 THEN 'slow_moving'
            WHEN COALESCE(cs.stock, 0) > COALESCE(s.units_30d, 0) * 6 AND COALESCE(s.units_30d, 0) > 0 THEN 'overstock'
            ELSE 'normal' END AS classification
        FROM products p
        JOIN current_stock cs ON cs.tenant_id = p.tenant_id AND cs.jtl_product_id = p.jtl_product_id
        LEFT JOIN sales s ON s.tenant_id = p.tenant_id AND s.product_id = p.jtl_product_id
        LEFT JOIN categories c ON c.tenant_id = p.tenant_id AND c.jtl_category_id = p.category_id
        WHERE p.tenant_id = ANY($1::uuid[]) AND p.is_active = true
          AND ($4 = '' OR p.name ILIKE '%' || $4 || '%' OR p.article_number ILIKE '%' || $4 || '%')
      ), filtered AS (
        SELECT *, COUNT(*) OVER()::int AS total_count FROM base
        WHERE $5 = 'all' OR classification = $5
      )
      SELECT * FROM filtered ORDER BY ${sort} ${order} NULLS LAST LIMIT $6 OFFSET $7`,
      [scope.tenantIds, query.warehouse || '', deadStockDays, query.search || '', performance, limit, offset],
    );
    return { rows, total: Number(rows[0]?.total_count || 0), page, limit, deadStockDays, freshness: { lastSyncedAt: await this.freshness(scope) } };
  }

  async customers(scope: TenantScope, query: ComparisonQueryDto) {
    this.assertEnabled('COMPARISON_CUSTOMER_ANALYSIS_ENABLED');
    const current = resolvePeriod(query);
    const { page, limit, offset } = this.page(query);
    const performance = query.performance || 'all';
    const sortMap: Record<string, string> = { ltv: 'ltv', orders: 'total_orders', recency: 'days_since_last_order', name: 'display_name' };
    const sort = sortMap[query.sort || 'ltv'] || 'ltv';
    const order = String(query.order || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const rows = await this.db.query(
      `WITH base AS (
        SELECT c.id, c.jtl_customer_id,
          COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.company, 'Customer ' || c.jtl_customer_id) AS display_name,
          c.company, c.country_code, c.region, c.total_orders, c.total_revenue::float8, c.ltv::float8,
          c.first_order_date, c.last_order_date, c.days_since_last_order, c.segment, c.rfm_score,
          CASE WHEN c.total_orders <= 1 THEN 'new' ELSE 'repeat' END AS customer_type,
          CASE WHEN COALESCE(c.days_since_last_order, 9999) > 90 AND c.total_orders > 1 THEN true ELSE false END AS at_risk
        FROM customers c WHERE c.tenant_id = ANY($1::uuid[])
          AND ($2 = '' OR c.first_name ILIKE '%' || $2 || '%' OR c.last_name ILIKE '%' || $2 || '%' OR c.company ILIKE '%' || $2 || '%')
          AND ($3 = '' OR LOWER(COALESCE(c.segment, '')) = LOWER($3))
          AND ($4 = '' OR LOWER(COALESCE(c.country_code, '')) = LOWER($4))
      ), filtered AS (
        SELECT *, COUNT(*) OVER()::int AS total_count FROM base
        WHERE ($5 = 'all' OR ($5 = 'new' AND first_order_date BETWEEN $6::date AND $7::date)
          OR ($5 = 'repeat' AND customer_type = 'repeat') OR ($5 = 'at_risk' AND at_risk))
      )
      SELECT * FROM filtered ORDER BY ${sort} ${order} NULLS LAST LIMIT $8 OFFSET $9`,
      [scope.tenantIds, query.search || '', query.segment || '', query.country || '', performance, current.start, current.end, limit, offset],
    );
    return { rows, total: Number(rows[0]?.total_count || 0), page, limit, period: current };
  }

  async customerSegments(scope: TenantScope) {
    this.assertEnabled('COMPARISON_CUSTOMER_ANALYSIS_ENABLED');
    return this.db.query(
      `SELECT COALESCE(segment, 'Unclassified') AS segment, COUNT(*)::int AS customers,
        AVG(ltv)::float8 AS average_ltv, SUM(ltv)::float8 AS total_ltv,
        AVG(total_orders)::float8 AS average_orders
       FROM customers WHERE tenant_id = ANY($1::uuid[])
       GROUP BY 1 ORDER BY total_ltv DESC`,
      [scope.tenantIds],
    );
  }

  async orders(scope: TenantScope, query: ComparisonQueryDto) {
    this.assertEnabled('COMPARISON_CHANNEL_DRILLDOWN_ENABLED');
    const current = resolvePeriod(query);
    const { page, limit, offset } = this.page(query);
    const channels = channelIds(query.channels);
    const rows = await this.db.query(
      `SELECT o.jtl_order_id, o.order_number, o.order_date, o.channel AS raw_channel,
        COALESCE(cm.canonical_id, 'raw-' || md5(COALESCE(o.channel, 'Unknown'))) AS channel_id,
        COALESCE(cm.display_name, NULLIF(TRIM(o.channel), ''), 'Unknown') AS channel_name,
        o.status, o.country, o.region, o.city, o.item_count,
        COALESCE(o.net_revenue, o.gross_revenue)::float8 AS revenue,
        COUNT(*) OVER()::int AS total_count
       FROM orders o
       LEFT JOIN channel_mappings cm ON cm.tenant_id = o.tenant_id AND cm.raw_channel = COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')
       WHERE o.tenant_id = ANY($1::uuid[]) AND o.order_date BETWEEN $2::date AND $3::date
         AND (cardinality($4::text[]) = 0 OR COALESCE(cm.canonical_id, 'raw-' || md5(COALESCE(o.channel, 'Unknown'))) = ANY($4::text[]))
         AND ($5 = '' OR LOWER(COALESCE(o.status, '')) = LOWER($5))
       ORDER BY o.order_date DESC, o.jtl_order_id DESC LIMIT $6 OFFSET $7`,
      [scope.tenantIds, current.start, current.end, channels, query.status || '', limit, offset],
    );
    return { rows, total: Number(rows[0]?.total_count || 0), page, limit, period: current };
  }

  metricDefinitions() {
    this.assertEnabled();
    return METRIC_DEFINITIONS;
  }

  async exportCsv(scope: TenantScope, query: ComparisonQueryDto) {
    this.assertEnabled();
    const dataset = query.dataset || 'channels';
    const rows: Record<string, unknown>[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const pageQuery = { ...query, page, limit: 100 };
      const result = dataset === 'products'
        ? await this.products(scope, pageQuery)
        : dataset === 'inventory'
          ? await this.inventory(scope, pageQuery)
          : dataset === 'customers'
            ? await this.customers(scope, pageQuery)
            : dataset === 'orders'
              ? await this.orders(scope, pageQuery)
              : await this.channels(scope, pageQuery);
      rows.push(...result.rows);
      if (rows.length >= result.total || result.rows.length < result.limit) break;
    }
    if (!rows.length) return '';
    const excluded = new Set(['total_count']);
    const columns = Object.keys(rows[0]).filter((column) => !excluded.has(column));
    const escape = (value: unknown) => {
      if (value == null) return '';
      const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    };
    return [columns.map(escape).join(','), ...rows.map((row) => columns.map((column) => escape(row[column])).join(','))].join('\n');
  }

  async listSavedViews(scope: TenantScope, userId: string) {
    this.assertEnabled();
    return this.db.query(
      `SELECT id, name, tab, config, created_at, updated_at FROM analytics_saved_views
       WHERE tenant_id = ANY($1::uuid[]) AND user_id = $2::uuid ORDER BY updated_at DESC`,
      [scope.tenantIds, userId],
    );
  }

  async saveView(scope: TenantScope, userId: string, body: SavedViewDto) {
    this.assertEnabled();
    if (scope.scope !== 'single' || !scope.tenantId) throw new BadRequestException('Saved views require one selected company');
    const [row] = await this.db.query(
      `INSERT INTO analytics_saved_views (tenant_id, user_id, name, tab, config)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)
       RETURNING id, name, tab, config, created_at, updated_at`,
      [scope.tenantId, userId, body.name, body.tab, JSON.stringify(body.config || {})],
    );
    return row;
  }

  async deleteSavedView(scope: TenantScope, userId: string, id: string) {
    this.assertEnabled();
    const result = await this.db.query(
      `DELETE FROM analytics_saved_views WHERE id = $1::uuid AND tenant_id = ANY($2::uuid[]) AND user_id = $3::uuid RETURNING id`,
      [id, scope.tenantIds, userId],
    );
    if (!result[0]) throw new NotFoundException('Saved view not found');
    return { deleted: true };
  }
}
