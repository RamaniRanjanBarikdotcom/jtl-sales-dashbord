import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PlatformConfigService, FeatureFlag } from '../../config/platform-config.service';
import { TenantScope } from '../../common/types/auth-request';
import { CacheService } from '../../cache/cache.service';
import { buildCsv, inferCsvColumns } from '../../common/utils/csv-export';
import { buildPaginatedResult } from '../../common/utils/pagination';
import { ComparisonQueryDto, ProductCompareDto, SavedViewDto } from './comparison.dto';

type Period = { start: string; end: string };

const METRIC_DEFINITIONS = [
  { key: 'revenue', name: 'Gross revenue', formula: 'SUM(orders.gross_revenue)', unit: 'currency', exclusions: 'Cancelled orders and zero-value orders' },
  { key: 'orders', name: 'Orders', formula: 'COUNT(DISTINCT orders.jtl_order_id)', unit: 'count', exclusions: 'Cancelled orders' },
  { key: 'average_order_value', name: 'Average order value', formula: 'Net revenue / orders', unit: 'currency', exclusions: 'Periods without orders' },
  { key: 'gross_margin', name: 'Gross margin', formula: 'Net revenue - cost of goods', unit: 'currency', exclusions: 'Rows without revenue' },
  { key: 'units_sold', name: 'Units sold', formula: 'SUM(order_items.quantity)', unit: 'count', exclusions: 'Cancelled orders' },
  { key: 'stock_cover_days', name: 'Stock cover', formula: 'Current stock / average daily units sold', unit: 'days', exclusions: 'Unavailable when there is no recent demand' },
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
  if (range === 'PREVIOUS_MONTH') return {
    start: isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))),
    end: isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))),
  };
  if (range === 'QUARTER' || range === 'PREVIOUS_QUARTER') {
    const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3 + (range === 'PREVIOUS_QUARTER' ? -3 : 0);
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1));
    return {
      start: isoDate(startDate),
      end: range === 'PREVIOUS_QUARTER' ? isoDate(new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 3, 0))) : end,
    };
  }
  if (range === 'YEAR' || range === 'YTD') return { start: `${now.getUTCFullYear()}-01-01`, end };
  if (range === 'PREVIOUS_YEAR') { const year = now.getUTCFullYear() - 1; return { start: `${year}-01-01`, end: `${year}-12-31` }; }
  if (range === 'ALL') return { start: '2000-01-01', end };
  const days = ({ '7D': 7, '30D': 30, '3M': 90, '6M': 180, '12M': 365, '2Y': 730, '5Y': 1825 } as Record<string, number>)[range] || 30;
  return { start: isoDate(new Date(now.getTime() - days * 86400000)), end };
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

const canonicalChannelEnabledSql = `EXISTS (
  SELECT 1 FROM tenant_channel_payment_settings canonical_settings
  WHERE canonical_settings.tenant_id = o.tenant_id AND canonical_settings.channel_enabled
)`;
const canonicalPaymentEnabledSql = `EXISTS (
  SELECT 1 FROM tenant_channel_payment_settings canonical_settings
  WHERE canonical_settings.tenant_id = o.tenant_id AND canonical_settings.payment_enabled
)`;
const canonicalChannelValueSql = `CASE
  WHEN ${canonicalChannelEnabledSql} THEN CASE
    WHEN o.channel_resolution_status = 'resolved' AND NULLIF(TRIM(o.canonical_marketplace), '') IS NOT NULL
      THEN TRIM(o.canonical_marketplace)
    WHEN o.channel_resolution_status = 'ambiguous' THEN 'Ambiguous'
    ELSE 'Unresolved'
  END
  ELSE COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')
END`;
const canonicalChannelIdSql = `CASE
  WHEN ${canonicalChannelEnabledSql} THEN CASE
    WHEN o.channel_resolution_status = 'resolved' AND NULLIF(TRIM(o.canonical_marketplace), '') IS NOT NULL
      THEN 'canonical-' || md5(LOWER(TRIM(o.canonical_marketplace)))
    WHEN o.channel_resolution_status = 'ambiguous' THEN 'canonical-ambiguous'
    ELSE 'canonical-unresolved'
  END
  ELSE COALESCE(cm.canonical_id, 'raw-' || md5(COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')))
END`;
const canonicalChannelNameSql = `CASE
  WHEN ${canonicalChannelEnabledSql} THEN CASE
    WHEN o.channel_resolution_status = 'resolved' AND NULLIF(TRIM(o.canonical_marketplace), '') IS NOT NULL
      THEN TRIM(o.canonical_marketplace)
    WHEN o.channel_resolution_status = 'ambiguous' THEN 'Ambiguous'
    ELSE 'Unresolved'
  END
  ELSE COALESCE(cm.display_name, NULLIF(TRIM(o.channel), ''), 'Unknown')
END`;
const canonicalPaymentValueSql = `CASE
  WHEN ${canonicalPaymentEnabledSql} THEN CASE
    WHEN o.payment_resolution_status = 'resolved' AND NULLIF(TRIM(o.canonical_payment_method), '') IS NOT NULL
      THEN TRIM(o.canonical_payment_method)
    WHEN o.payment_resolution_status = 'ambiguous' THEN 'Ambiguous'
    ELSE 'Unresolved'
  END
  ELSE COALESCE(NULLIF(TRIM(o.payment_method), ''), 'Unknown')
END`;

function normalizedStatusSql(column: string): string {
  const status = `LOWER(TRIM(COALESCE(${column}, '')))`;
  return `CASE
    WHEN ${status} IN ('cancelled', 'canceled', 'storniert', 'storno', 'annulliert', 'void', 'voided') THEN 'cancelled'
    WHEN ${status} IN ('returned', 'retour', 'retoure', 'retourniert', 'refund', 'refunded') THEN 'returned'
    WHEN ${status} IN ('', 'unknown', 'n/a', '-') THEN 'unknown'
    ELSE ${status}
  END`;
}

const activeOrderSql = `${normalizedStatusSql('o.status')} <> 'cancelled'`;
const orderLineRevenueSql = 'COALESCE(oi.line_total_gross, oi.quantity * oi.unit_price_gross, 0)';

@Injectable()
export class ComparisonService {
  constructor(
    private readonly db: DataSource,
    private readonly config: PlatformConfigService,
    private readonly cache: CacheService,
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

  private page(query: ComparisonQueryDto, maxLimit = 100) {
    const limit = Math.min(maxLimit, Math.max(1, query.limit || 50));
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
        COALESCE(SUM(o.gross_revenue), 0)::float8 AS revenue,
        COUNT(DISTINCT o.jtl_order_id)::int AS orders,
        COALESCE(SUM(o.cost_of_goods), 0)::float8 AS cost_of_goods,
        COALESCE(SUM(o.item_count), 0)::float8 AS units
      FROM orders o
      LEFT JOIN channel_mappings cm
        ON cm.tenant_id = o.tenant_id AND cm.raw_channel = COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')
      WHERE o.tenant_id = ANY($1::uuid[])
        AND o.order_date BETWEEN $2::date AND $3::date
        AND ${activeOrderSql}
        AND COALESCE(o.gross_revenue, 0) > 0
        AND (cardinality($4::text[]) = 0 OR ${canonicalChannelIdSql} = ANY($4::text[]))
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

  private cacheKey(scope: TenantScope, method: string, query: Record<string, unknown> = {}): string {
    const tenantPart = scope.tenantIds.slice().sort().join(',');
    return `jtl:comparison:${tenantPart}:${method}:${JSON.stringify(query)}`;
  }

  async summary(scope: TenantScope, query: ComparisonQueryDto) {
    this.assertEnabled();
    const key = this.cacheKey(scope, 'summary', query as Record<string, unknown>);
    return this.cache.getOrSet(key, 60, async () => {
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
    });
  }

  async salesTrend(scope: TenantScope, query: ComparisonQueryDto) {
    this.assertEnabled('COMPARISON_CHANNEL_DRILLDOWN_ENABLED');
    const key = this.cacheKey(scope, 'salesTrend', query as Record<string, unknown>);
    return this.cache.getOrSet(key, 120, async () => {
    const { current, comparison } = this.periods(query);
    const granularity = ['day', 'week', 'month', 'quarter', 'year'].includes(query.granularity || '') ? query.granularity : 'day';
    const [channels, status, country, region] = this.filters(query);
    const run = (period: Period) => this.db.query(
      `SELECT date_trunc($4, o.order_date)::date AS bucket,
        COALESCE(SUM(o.gross_revenue), 0)::float8 AS revenue,
        COUNT(DISTINCT o.jtl_order_id)::int AS orders
      FROM orders o
      LEFT JOIN channel_mappings cm
        ON cm.tenant_id = o.tenant_id AND cm.raw_channel = COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')
      WHERE o.tenant_id = ANY($1::uuid[]) AND o.order_date BETWEEN $2::date AND $3::date
        AND ${activeOrderSql}
        AND COALESCE(o.gross_revenue, 0) > 0
        AND (cardinality($5::text[]) = 0 OR ${canonicalChannelIdSql} = ANY($5::text[]))
        AND ($6 = '' OR LOWER(COALESCE(o.status, '')) = $6)
        AND ($7 = '' OR LOWER(COALESCE(o.country, '')) = LOWER($7))
        AND ($8 = '' OR LOWER(COALESCE(o.region, '')) = LOWER($8))
      GROUP BY 1 ORDER BY 1`,
      [scope.tenantIds, period.start, period.end, granularity, channels, status, country, region],
    );
    const [currentRows, comparisonRows] = await Promise.all([run(current), comparison ? run(comparison) : Promise.resolve([])]);
    return { periods: { current, comparison }, current: currentRows, comparison: comparisonRows, granularity };
    });
  }

  async channels(scope: TenantScope, query: ComparisonQueryDto, maxLimit = 100) {
    this.assertEnabled('COMPARISON_CHANNEL_DRILLDOWN_ENABLED');
    const key = this.cacheKey(scope, 'channels', query as Record<string, unknown>);
    return this.cache.getOrSet(key, 120, async () => {
    const { current, comparison } = this.periods(query);
    const { page, limit, offset } = this.page(query, maxLimit);
    const sortMap: Record<string, string> = {
      revenue: 'revenue',
      orders: 'orders',
      units: 'units',
      customers: 'customers',
      products: 'products_sold',
      returns: 'returns',
      averageOrderValue: 'average_order_value',
      change: 'revenue_change',
    };
    const sort = sortMap[query.sort || 'revenue'] || 'revenue';
    const order = String(query.order || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const comparisonStart = comparison?.start || current.start;
    const comparisonEnd = comparison?.end || current.end;
    const requestedChannels = channelIds(query.channels);
    const [, status, country, region] = this.filters(query);
    const rows = await this.db.query(
      `WITH sales_products AS (
        SELECT ${canonicalChannelIdSql} AS channel_id,
          COUNT(DISTINCT (oi.tenant_id, oi.product_id))::int AS products_sold
        FROM order_items oi
        JOIN orders o ON o.tenant_id = oi.tenant_id AND o.jtl_order_id = oi.order_id
        LEFT JOIN channel_mappings cm ON cm.tenant_id = o.tenant_id AND cm.raw_channel = COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')
        WHERE oi.tenant_id = ANY($1::uuid[])
          AND o.order_date BETWEEN $2::date AND $3::date
          AND ${activeOrderSql}
          AND ($9 = '' OR ${normalizedStatusSql('o.status')} = $9)
          AND ($10 = '' OR LOWER(COALESCE(o.country, '')) = LOWER($10))
          AND ($11 = '' OR LOWER(COALESCE(o.region, '')) = LOWER($11))
        GROUP BY 1
      ), return_metrics AS (
        SELECT ${canonicalChannelIdSql} AS channel_id,
          COUNT(DISTINCT o.jtl_order_id)::int AS returns
        FROM orders o
        LEFT JOIN channel_mappings cm ON cm.tenant_id = o.tenant_id AND cm.raw_channel = COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')
        WHERE o.tenant_id = ANY($1::uuid[])
          AND o.order_date BETWEEN $2::date AND $3::date
          AND LOWER(COALESCE(o.status, '')) IN ('returned', 'return')
          AND ($10 = '' OR LOWER(COALESCE(o.country, '')) = LOWER($10))
          AND ($11 = '' OR LOWER(COALESCE(o.region, '')) = LOWER($11))
        GROUP BY 1
      ), grouped AS (
        SELECT
          ${canonicalChannelIdSql} AS channel_id,
          ${canonicalChannelNameSql} AS channel_name,
          COALESCE(MIN(cm.channel_type), 'other') AS channel_type,
          ARRAY_AGG(DISTINCT COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')) AS raw_channels,
          COALESCE(SUM(o.gross_revenue) FILTER (WHERE o.order_date BETWEEN $2::date AND $3::date), 0)::float8 AS revenue,
          COUNT(DISTINCT o.jtl_order_id) FILTER (WHERE o.order_date BETWEEN $2::date AND $3::date)::int AS orders,
          COALESCE(SUM(o.item_count) FILTER (WHERE o.order_date BETWEEN $2::date AND $3::date), 0)::float8 AS units,
          COUNT(DISTINCT o.customer_id) FILTER (WHERE o.order_date BETWEEN $2::date AND $3::date AND o.customer_id IS NOT NULL)::int AS customers,
          COALESCE(SUM(o.gross_revenue) FILTER (WHERE o.order_date BETWEEN $4::date AND $5::date), 0)::float8 AS comparison_revenue
        FROM orders o
        LEFT JOIN channel_mappings cm ON cm.tenant_id = o.tenant_id AND cm.raw_channel = COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')
        WHERE o.tenant_id = ANY($1::uuid[])
          AND o.order_date BETWEEN LEAST($2::date, $4::date) AND GREATEST($3::date, $5::date)
          AND ${activeOrderSql}
          AND COALESCE(o.gross_revenue, 0) > 0
          AND ($9 = '' OR LOWER(COALESCE(o.status, '')) = $9)
          AND ($10 = '' OR LOWER(COALESCE(o.country, '')) = LOWER($10))
          AND ($11 = '' OR LOWER(COALESCE(o.region, '')) = LOWER($11))
        GROUP BY 1,2
      ), ranked AS (
        SELECT grouped.*, COALESCE(return_metrics.returns, 0)::int AS returns,
          COALESCE(sales_products.products_sold, 0)::int AS products_sold,
          CASE WHEN orders > 0 THEN revenue / orders ELSE 0 END AS average_order_value,
          CASE WHEN comparison_revenue = 0 THEN NULL ELSE ((revenue - comparison_revenue) / comparison_revenue) * 100 END AS revenue_change,
          COUNT(*) OVER()::int AS total_count
        FROM grouped
        LEFT JOIN return_metrics ON return_metrics.channel_id = grouped.channel_id
        LEFT JOIN sales_products ON sales_products.channel_id = grouped.channel_id
        WHERE cardinality($8::text[]) = 0 OR grouped.channel_id = ANY($8::text[])
      )
      SELECT * FROM ranked ORDER BY ${sort} ${order} NULLS LAST LIMIT $6 OFFSET $7`,
      [scope.tenantIds, current.start, current.end, comparisonStart, comparisonEnd, limit, offset, requestedChannels, status, country, region],
    );
    return { rows, total: Number(rows[0]?.total_count || 0), page, limit, periods: { current, comparison } };
    });
  }

  async channelDetail(scope: TenantScope, channelId: string, query: ComparisonQueryDto) {
    const key = this.cacheKey(scope, `channelDetail:${channelId}`, query as Record<string, unknown>);
    return this.cache.getOrSet(key, 60, async () => {
    const result = await this.channels(scope, { ...query, channels: channelId, page: 1, limit: 1 });
    const channel = result.rows.find((row: Record<string, unknown>) => row.channel_id === channelId);
    if (!channel) throw new NotFoundException('Channel not found');
    const [products, stockedWithoutSales, orders] = await Promise.all([
      this.products(scope, { ...query, channels: channelId, performance: 'with_sales', page: 1, limit: 20 }),
      this.products(scope, { ...query, channels: channelId, performance: 'stock_no_sales', page: 1, limit: 20 }),
      this.orders(scope, { ...query, channels: channelId, page: 1, limit: 20 }),
    ]);
    return { channel, products, stockedWithoutSales, orders, periods: result.periods };
    });
  }

  async compareChannelPair(scope: TenantScope, query: ComparisonQueryDto, maxLimit = 100) {
    this.assertEnabled('COMPARISON_CHANNEL_DRILLDOWN_ENABLED');
    const selectedChannels = channelIds(query.channels);
    if (selectedChannels.length !== 2) {
      throw new BadRequestException('Channel comparison requires exactly two channels');
    }
    const [channelA, channelB] = selectedChannels;
    const current = resolvePeriod(query);
    const { page, limit, offset } = this.page(query, maxLimit);
    const [, status, country, region] = this.filters(query);
    const rows = await this.db.query(
      `WITH sales AS (
        SELECT oi.tenant_id, oi.product_id,
          ${canonicalChannelIdSql} AS channel_id,
          COALESCE(SUM(${orderLineRevenueSql}), 0)::float8 AS revenue,
          COALESCE(SUM(oi.quantity), 0)::float8 AS units,
          COUNT(DISTINCT o.jtl_order_id)::int AS orders
        FROM order_items oi
        JOIN orders o ON o.tenant_id = oi.tenant_id AND o.jtl_order_id = oi.order_id
        LEFT JOIN channel_mappings cm ON cm.tenant_id = o.tenant_id AND cm.raw_channel = COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')
        WHERE oi.tenant_id = ANY($1::uuid[])
          AND o.order_date BETWEEN $2::date AND $3::date
          AND ${activeOrderSql}
          AND ${canonicalChannelIdSql} IN ($4, $5)
          AND ($10 = '' OR LOWER(COALESCE(o.status, '')) = $10)
          AND ($11 = '' OR LOWER(COALESCE(o.country, '')) = LOWER($11))
          AND ($12 = '' OR LOWER(COALESCE(o.region, '')) = LOWER($12))
        GROUP BY oi.tenant_id, oi.product_id, 3
      ), stock AS (
        SELECT tenant_id, jtl_product_id AS product_id,
          COALESCE(SUM(total), 0)::float8 AS total_stock,
          COALESCE(SUM(available), 0)::float8 AS available_stock,
          COALESCE(SUM(reserved), 0)::float8 AS reserved_stock
        FROM inventory
        WHERE tenant_id = ANY($1::uuid[])
        GROUP BY tenant_id, jtl_product_id
      ), base AS (
        SELECT p.id, p.jtl_product_id, p.article_number AS sku, p.name,
          COALESCE(c.name, 'Uncategorized') AS category,
          COALESCE(MAX(s.revenue) FILTER (WHERE s.channel_id = $4), 0)::float8 AS revenue_a,
          COALESCE(MAX(s.revenue) FILTER (WHERE s.channel_id = $5), 0)::float8 AS revenue_b,
          COALESCE(MAX(s.units) FILTER (WHERE s.channel_id = $4), 0)::float8 AS units_a,
          COALESCE(MAX(s.units) FILTER (WHERE s.channel_id = $5), 0)::float8 AS units_b,
          COALESCE(MAX(s.orders) FILTER (WHERE s.channel_id = $4), 0)::int AS orders_a,
          COALESCE(MAX(s.orders) FILTER (WHERE s.channel_id = $5), 0)::int AS orders_b,
          COALESCE(st.total_stock, p.stock_quantity, 0)::float8 AS total_stock,
          COALESCE(st.available_stock, 0)::float8 AS available_stock,
          COALESCE(st.reserved_stock, 0)::float8 AS reserved_stock
        FROM products p
        LEFT JOIN sales s ON s.tenant_id = p.tenant_id AND s.product_id = p.jtl_product_id
        LEFT JOIN stock st ON st.tenant_id = p.tenant_id AND st.product_id = p.jtl_product_id
        LEFT JOIN categories c ON c.tenant_id = p.tenant_id AND c.jtl_category_id = p.category_id
        WHERE p.tenant_id = ANY($1::uuid[]) AND p.is_active = true
          AND ($6 = '' OR c.name ILIKE $6)
          AND ($7 = '' OR p.name ILIKE '%' || $7 || '%' OR p.article_number ILIKE '%' || $7 || '%')
        GROUP BY p.id, p.jtl_product_id, p.article_number, p.name, c.name,
          st.total_stock, st.available_stock, st.reserved_stock, p.stock_quantity
      ), classified AS (
        SELECT *, CASE
          WHEN revenue_a > 0 AND revenue_b > 0 THEN 'common'
          WHEN revenue_a > 0 THEN 'unique_to_a'
          WHEN revenue_b > 0 THEN 'unique_to_b'
          WHEN total_stock > 0 THEN 'stocked_zero_sales'
          ELSE 'neither'
        END AS relationship
        FROM base
      ), filtered AS (
        SELECT *, COUNT(*) OVER()::int AS total_count,
          COUNT(*) FILTER (WHERE relationship = 'common') OVER()::int AS common_count,
          COUNT(*) FILTER (WHERE relationship = 'unique_to_a') OVER()::int AS unique_a_count,
          COUNT(*) FILTER (WHERE relationship = 'unique_to_b') OVER()::int AS unique_b_count,
          COUNT(*) FILTER (WHERE relationship = 'stocked_zero_sales') OVER()::int AS stocked_zero_sales_count
        FROM classified
        WHERE relationship <> 'neither'
      )
      SELECT * FROM filtered
      ORDER BY (revenue_a + revenue_b) DESC, name ASC
      LIMIT $8 OFFSET $9`,
      [scope.tenantIds, current.start, current.end, channelA, channelB, query.category || '', query.search || '', limit, offset, status, country, region],
    );
    return {
      rows,
      total: Number(rows[0]?.total_count || 0),
      page,
      limit,
      period: current,
      channelA,
      channelB,
      counts: {
        common: Number(rows[0]?.common_count || 0),
        uniqueToA: Number(rows[0]?.unique_a_count || 0),
        uniqueToB: Number(rows[0]?.unique_b_count || 0),
        stockedZeroSales: Number(rows[0]?.stocked_zero_sales_count || 0),
      },
    };
  }

  async products(scope: TenantScope, query: ComparisonQueryDto, maxLimit = 100) {
    this.assertEnabled('COMPARISON_PRODUCT_PERFORMANCE_ENABLED');
    const key = this.cacheKey(scope, 'products', query as Record<string, unknown>);
    return this.cache.getOrSet(key, 120, async () => {
    const { current, comparison } = this.periods(query);
    const { page, limit, offset } = this.page(query, maxLimit);
    const sortMap: Record<string, string> = { revenue: 'revenue', units: 'units', stock: 'stock', name: 'name', change: 'revenue_change' };
    const sort = sortMap[query.sort || 'revenue'] || 'revenue';
    const order = String(query.order || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const channels = channelIds(query.channels);
    const [, status, country, region] = this.filters(query);
    const performance = query.performance || 'all';
    const selectedProductIds = String(query.productIds || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map(Number)
      .filter(Number.isFinite)
      .slice(0, 100);
    const comparisonStart = comparison?.start || current.start;
    const comparisonEnd = comparison?.end || current.end;
    const rows = await this.db.query(
      `WITH sales AS (
        SELECT oi.tenant_id, oi.product_id,
          COALESCE(SUM(${orderLineRevenueSql}) FILTER (WHERE o.order_date BETWEEN $2::date AND $3::date), 0)::float8 AS revenue,
          COALESCE(SUM(oi.quantity) FILTER (WHERE o.order_date BETWEEN $2::date AND $3::date), 0)::float8 AS units,
          COUNT(DISTINCT o.jtl_order_id) FILTER (WHERE o.order_date BETWEEN $2::date AND $3::date)::int AS orders,
          COALESCE(SUM(${orderLineRevenueSql}) FILTER (WHERE o.order_date BETWEEN $4::date AND $5::date), 0)::float8 AS comparison_revenue,
          MAX(o.order_date) AS last_sale_date
        FROM order_items oi
        JOIN orders o ON o.tenant_id = oi.tenant_id AND o.jtl_order_id = oi.order_id
        LEFT JOIN channel_mappings cm ON cm.tenant_id = o.tenant_id AND cm.raw_channel = COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')
        WHERE oi.tenant_id = ANY($1::uuid[])
          AND o.order_date BETWEEN LEAST($2::date, $4::date) AND GREATEST($3::date, $5::date)
          AND ${activeOrderSql}
          AND (cardinality($6::text[]) = 0 OR ${canonicalChannelIdSql} = ANY($6::text[]))
          AND ($13 = '' OR ${normalizedStatusSql('o.status')} = $13)
          AND ($14 = '' OR LOWER(COALESCE(o.country, '')) = LOWER($14))
          AND ($15 = '' OR LOWER(COALESCE(o.region, '')) = LOWER($15))
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
          AND (cardinality($12::bigint[]) = 0 OR p.id = ANY($12::bigint[]))
          AND ($9 NOT IN ('with_sales', 'growing', 'declining') OR s.product_id IS NOT NULL)
          AND ($7 = '' OR p.name ILIKE '%' || $7 || '%' OR p.article_number ILIKE '%' || $7 || '%')
          AND ($8 = '' OR c.name ILIKE $8)
      ), filtered AS (
        SELECT *, COUNT(*) OVER()::int AS total_count FROM base
        WHERE ($9 = 'all'
          OR ($9 = 'with_sales' AND revenue > 0)
          OR ($9 = 'zero_sales' AND revenue = 0)
          OR ($9 = 'with_stock' AND stock > 0)
          OR ($9 = 'without_stock' AND stock <= 0)
          OR ($9 = 'stock_no_sales' AND revenue = 0 AND stock > 0)
          OR ($9 = 'growing' AND revenue_change > 0)
          OR ($9 = 'declining' AND revenue_change < 0))
      )
      SELECT * FROM filtered ORDER BY ${sort} ${order} NULLS LAST LIMIT $10 OFFSET $11`,
      [scope.tenantIds, current.start, current.end, comparisonStart, comparisonEnd, channels, query.search || '', query.category || '', performance, limit, offset, selectedProductIds, status, country, region],
    );
    return { rows, total: Number(rows[0]?.total_count || 0), page, limit, periods: { current, comparison } };
    });
  }

  async compareProducts(scope: TenantScope, body: ProductCompareDto) {
    this.assertEnabled('COMPARISON_PRODUCT_PERFORMANCE_ENABLED');
    const ids = [...new Set((body.productIds || []).filter(Number.isFinite))].slice(0, 5);
    if (ids.length < 2) throw new BadRequestException('Select at least two products');
    const period = resolvePeriod({ range: body.range, from: body.from, to: body.to });
    const channels = channelIds(body.channels);
    const status = body.status && body.status !== 'all' ? body.status.toLowerCase() : '';
    const rows = await this.db.query(
      `WITH sales AS (
        SELECT oi.tenant_id, oi.product_id,
          COALESCE(SUM(${orderLineRevenueSql}), 0)::float8 AS revenue,
          COALESCE(SUM(oi.quantity), 0)::float8 AS units,
          COUNT(DISTINCT o.jtl_order_id)::int AS orders,
          COUNT(DISTINCT o.customer_id)::int AS customers,
          COUNT(DISTINCT ${canonicalChannelValueSql})::int AS channels,
          STRING_AGG(DISTINCT ${canonicalChannelValueSql}, ', ' ORDER BY ${canonicalChannelValueSql}) AS channel_names,
          COUNT(DISTINCT o.jtl_order_id) FILTER (WHERE LOWER(COALESCE(o.status, '')) IN ('returned', 'return'))::int AS returns,
          MIN(o.order_date) AS first_sale,
          MAX(o.order_date) AS last_sale,
          CASE WHEN MAX(o.order_date) IS NULL THEN 0
            ELSE COALESCE(SUM(oi.quantity), 0)::float8 / GREATEST(1, (MAX(o.order_date)::date - MIN(o.order_date)::date) + 1) END AS sales_velocity,
          COUNT(*) FILTER (WHERE oi.unit_price_net > 0)::int AS eligible_margin_lines,
          COUNT(*) FILTER (WHERE oi.unit_price_net > 0 AND COALESCE(NULLIF(oi.unit_cost, 0), NULLIF(p2.unit_cost, 0)) > 0)::int AS costed_margin_lines,
          ROUND(AVG(CASE
            WHEN oi.unit_price_net > 0 AND COALESCE(NULLIF(oi.unit_cost, 0), NULLIF(p2.unit_cost, 0)) > 0
            THEN (oi.unit_price_net - COALESCE(NULLIF(oi.unit_cost, 0), NULLIF(p2.unit_cost, 0))) / oi.unit_price_net * 100
            ELSE NULL END)::numeric, 2)::float8 AS calculated_margin
        FROM order_items oi
        JOIN orders o ON o.tenant_id = oi.tenant_id AND o.jtl_order_id = oi.order_id
        LEFT JOIN products p2 ON p2.tenant_id = oi.tenant_id AND p2.jtl_product_id = oi.product_id
        LEFT JOIN channel_mappings cm ON cm.tenant_id = o.tenant_id AND cm.raw_channel = COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')
        WHERE oi.tenant_id = ANY($1::uuid[])
          AND o.order_date BETWEEN $3::date AND $4::date
          AND ${activeOrderSql}
          AND (cardinality($5::text[]) = 0 OR ${canonicalChannelIdSql} = ANY($5::text[]))
          AND ($6 = '' OR ${normalizedStatusSql('o.status')} = $6)
          AND ($7 = '' OR LOWER(COALESCE(o.country, '')) = LOWER($7))
          AND ($8 = '' OR LOWER(COALESCE(o.region, '')) = LOWER($8))
        GROUP BY oi.tenant_id, oi.product_id
      ), stock AS (
        SELECT tenant_id, jtl_product_id,
          COALESCE(SUM(total), 0)::float8 AS stock,
          COALESCE(SUM(available), 0)::float8 AS available,
          COALESCE(SUM(reserved), 0)::float8 AS reserved
        FROM inventory WHERE tenant_id = ANY($1::uuid[]) GROUP BY tenant_id, jtl_product_id
      )
      SELECT p.id, p.jtl_product_id, p.article_number AS sku, p.name,
        COALESCE(s.revenue, 0) AS revenue, COALESCE(s.units, 0) AS units,
        COALESCE(s.orders, 0) AS orders, COALESCE(s.customers, 0) AS customers,
        COALESCE(s.channels, 0) AS channels, COALESCE(s.channel_names, '') AS channel_names,
        COALESCE(s.returns, 0) AS returns, s.last_sale, COALESCE(s.sales_velocity, 0)::float8 AS sales_velocity,
        COALESCE(st.stock, p.stock_quantity, 0)::float8 AS stock,
        COALESCE(st.available, 0)::float8 AS available,
        COALESCE(st.reserved, 0)::float8 AS reserved,
        CASE WHEN COALESCE(s.eligible_margin_lines, 0) > 0
          AND COALESCE(s.costed_margin_lines, 0)::numeric / s.eligible_margin_lines >= 0.8
          THEN s.calculated_margin ELSE NULL END AS margin
      FROM products p
      LEFT JOIN sales s ON s.tenant_id = p.tenant_id AND s.product_id = p.jtl_product_id
      LEFT JOIN stock st ON st.tenant_id = p.tenant_id AND st.jtl_product_id = p.jtl_product_id
      WHERE p.tenant_id = ANY($1::uuid[]) AND p.id = ANY($2::bigint[])
      ORDER BY revenue DESC`,
      [scope.tenantIds, ids, period.start, period.end, channels, status, body.country || '', body.region || ''],
    );
    const trends = await this.db.query(
      `SELECT p.id AS product_id, date_trunc('month', o.order_date)::date AS period,
        COALESCE(SUM(${orderLineRevenueSql}), 0)::float8 AS revenue,
        COALESCE(SUM(oi.quantity), 0)::float8 AS units,
        COUNT(DISTINCT o.jtl_order_id)::int AS orders
       FROM products p
       JOIN order_items oi ON oi.tenant_id = p.tenant_id AND oi.product_id = p.jtl_product_id
       JOIN orders o ON o.tenant_id = oi.tenant_id AND o.jtl_order_id = oi.order_id
       LEFT JOIN channel_mappings cm ON cm.tenant_id = o.tenant_id AND cm.raw_channel = COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')
       WHERE p.tenant_id = ANY($1::uuid[]) AND p.id = ANY($2::bigint[])
         AND o.order_date BETWEEN $3::date AND $4::date
         AND ${activeOrderSql}
         AND (cardinality($5::text[]) = 0 OR ${canonicalChannelIdSql} = ANY($5::text[]))
         AND ($6 = '' OR ${normalizedStatusSql('o.status')} = $6)
         AND ($7 = '' OR LOWER(COALESCE(o.country, '')) = LOWER($7))
         AND ($8 = '' OR LOWER(COALESCE(o.region, '')) = LOWER($8))
       GROUP BY p.id, period ORDER BY period`,
      [scope.tenantIds, ids, period.start, period.end, channels, status, body.country || '', body.region || ''],
    );
    return rows.map((row: Record<string, unknown>) => ({
      ...row,
      period,
      trend: trends.filter((trend: Record<string, unknown>) => String(trend.product_id) === String(row.id)),
    }));
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

  async productChannelMatrix(scope: TenantScope, query: ComparisonQueryDto, maxLimit = 100) {
    this.assertEnabled('COMPARISON_PRODUCT_PERFORMANCE_ENABLED');
    const current = resolvePeriod(query);
    const { page, limit, offset } = this.page(query, maxLimit);
    const channels = channelIds(query.channels);
    const [, status, country, region] = this.filters(query);
    const rows = await this.db.query(
      `WITH matrix AS (
        SELECT p.id AS product_id, p.article_number AS sku, p.name AS product_name,
          ${canonicalChannelIdSql} AS channel_id,
          ${canonicalChannelNameSql} AS channel_name,
          SUM(${orderLineRevenueSql})::float8 AS revenue,
          SUM(oi.quantity)::float8 AS units,
          COUNT(DISTINCT o.jtl_order_id)::int AS orders,
          COUNT(DISTINCT o.customer_id)::int AS customers,
          CASE
            WHEN COUNT(*) FILTER (WHERE oi.unit_price_net > 0) > 0
              AND COUNT(*) FILTER (
                WHERE oi.unit_price_net > 0
                  AND COALESCE(NULLIF(oi.unit_cost, 0), NULLIF(p.unit_cost, 0)) > 0
              )::numeric / COUNT(*) FILTER (WHERE oi.unit_price_net > 0) >= 0.8
            THEN ROUND(AVG(
              CASE
                WHEN oi.unit_price_net > 0
                  AND COALESCE(NULLIF(oi.unit_cost, 0), NULLIF(p.unit_cost, 0)) > 0
                THEN (oi.unit_price_net - COALESCE(NULLIF(oi.unit_cost, 0), NULLIF(p.unit_cost, 0))) / oi.unit_price_net * 100
                ELSE NULL
              END
            )::numeric, 2)::float8
            ELSE NULL
          END AS margin
        FROM order_items oi
        JOIN orders o ON o.tenant_id = oi.tenant_id AND o.jtl_order_id = oi.order_id
        JOIN products p ON p.tenant_id = oi.tenant_id AND p.jtl_product_id = oi.product_id
        LEFT JOIN categories c ON c.tenant_id = p.tenant_id AND c.jtl_category_id = p.category_id
        LEFT JOIN channel_mappings cm ON cm.tenant_id = o.tenant_id AND cm.raw_channel = COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')
        WHERE oi.tenant_id = ANY($1::uuid[]) AND o.order_date BETWEEN $2::date AND $3::date
          AND ${activeOrderSql}
          AND ($4 = '' OR c.name = $4)
          AND ($5 = '' OR p.name ILIKE '%' || $5 || '%' OR p.article_number ILIKE '%' || $5 || '%')
          AND (cardinality($8::text[]) = 0 OR ${canonicalChannelIdSql} = ANY($8::text[]))
          AND ($9 = '' OR ${normalizedStatusSql('o.status')} = $9)
          AND ($10 = '' OR LOWER(COALESCE(o.country, '')) = LOWER($10))
          AND ($11 = '' OR LOWER(COALESCE(o.region, '')) = LOWER($11))
        GROUP BY p.id, p.article_number, p.name, 4, 5
      )
      SELECT matrix.*, COUNT(*) OVER()::int AS total_rows
      FROM matrix
      ORDER BY revenue DESC, product_name ASC, channel_name ASC
      LIMIT $6 OFFSET $7`,
      [scope.tenantIds, current.start, current.end, query.category || '', query.search || '', limit, offset, channels, status, country, region],
    );
    return buildPaginatedResult(
      rows.map(({ total_rows: _totalRows, ...row }: Record<string, unknown>) => row),
      rows[0]?.total_rows ?? 0,
      page,
      limit,
    );
  }

  async inventory(scope: TenantScope, query: ComparisonQueryDto, maxLimit = 100) {
    this.assertEnabled('COMPARISON_INVENTORY_PERFORMANCE_ENABLED');
    const key = this.cacheKey(scope, 'inventory', query as Record<string, unknown>);
    return this.cache.getOrSet(key, 180, async () => {
    const { page, limit, offset } = this.page(query, maxLimit);
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
        WHERE oi.tenant_id = ANY($1::uuid[]) AND ${activeOrderSql}
        GROUP BY oi.tenant_id, oi.product_id
      ), current_stock AS (
        SELECT i.tenant_id, i.jtl_product_id, SUM(i.total)::float8 AS stock,
          STRING_AGG(DISTINCT COALESCE(i.warehouse_name, 'Unknown'), ', ' ORDER BY COALESCE(i.warehouse_name, 'Unknown')) AS warehouses
        FROM inventory i WHERE i.tenant_id = ANY($1::uuid[])
          AND ($2 = '' OR i.warehouse_name ILIKE '%' || $2 || '%')
        GROUP BY i.tenant_id, i.jtl_product_id
      ), base AS (
        SELECT p.id, p.jtl_product_id, p.article_number AS sku, p.name,
          COALESCE(c.name, 'Uncategorised') AS category, cs.warehouses,
          COALESCE(cs.stock, 0) AS stock, COALESCE(p.unit_cost, 0)::float8 AS unit_cost,
          (COALESCE(cs.stock, 0) * COALESCE(p.unit_cost, 0))::float8 AS stock_value,
          COALESCE(s.units_30d, 0) AS units_30d, COALESCE(s.units_90d, 0) AS units_90d, s.last_sale_date,
          CASE WHEN COALESCE(s.units_30d, 0) = 0 THEN NULL
            ELSE ROUND((COALESCE(cs.stock, 0) / (s.units_30d / 30.0))::numeric, 1)::float8 END AS stock_cover_days,
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
        WHERE ($5 = 'all' OR classification = $5)
          AND ($8::numeric IS NULL OR stock >= $8::numeric)
          AND ($9::numeric IS NULL OR stock <= $9::numeric)
      )
      SELECT * FROM filtered
      ORDER BY ${sort} ${order} NULLS LAST LIMIT $6 OFFSET $7`,
      [scope.tenantIds, query.warehouse || '', deadStockDays, query.search || '', performance, limit, offset, query.minStock ?? null, query.maxStock ?? null],
    );
    return { rows, total: Number(rows[0]?.total_count || 0), page, limit, deadStockDays, freshness: { lastSyncedAt: await this.freshness(scope) } };
    });
  }

  async customers(scope: TenantScope, query: ComparisonQueryDto, maxLimit = 100) {
    this.assertEnabled('COMPARISON_CUSTOMER_ANALYSIS_ENABLED');
    const key = this.cacheKey(scope, 'customers', query as Record<string, unknown>);
    return this.cache.getOrSet(key, 120, async () => {
    const current = resolvePeriod(query);
    const { page, limit, offset } = this.page(query, maxLimit);
    const performance = query.performance || 'all';
    const sortMap: Record<string, string> = { ltv: 'ltv', orders: 'total_orders', recency: 'days_since_last_order', name: 'display_name' };
    const sort = sortMap[query.sort || 'ltv'] || 'ltv';
    const order = String(query.order || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const rows = await this.db.query(
      `WITH activity AS (
        SELECT o.tenant_id, o.customer_id,
          COUNT(DISTINCT o.jtl_order_id) FILTER (WHERE o.order_date BETWEEN $6::date AND $7::date)::int AS period_orders,
          COUNT(DISTINCT ${canonicalChannelValueSql}) FILTER (WHERE o.order_date BETWEEN $6::date AND $7::date)::int AS channel_count,
          MAX(o.order_date) FILTER (WHERE o.order_date < $6::date) AS previous_order_date,
          MIN(o.order_date) FILTER (WHERE o.order_date BETWEEN $6::date AND $7::date) AS first_period_order
        FROM orders o
        WHERE o.tenant_id = ANY($1::uuid[]) AND o.customer_id IS NOT NULL
          AND ${activeOrderSql}
        GROUP BY o.tenant_id, o.customer_id
      ), base AS (
        SELECT c.id, c.jtl_customer_id,
          COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.company, 'Customer ' || c.jtl_customer_id) AS display_name,
          c.company, c.country_code, c.region, c.total_orders, c.total_revenue::float8, c.ltv::float8,
          c.first_order_date, c.last_order_date, c.days_since_last_order, c.segment, c.rfm_score,
          CASE WHEN c.total_orders <= 1 THEN 'one_time' ELSE 'repeat' END AS customer_type,
          CASE WHEN COALESCE(c.days_since_last_order, 9999) > 90 AND c.total_orders > 1 THEN true ELSE false END AS at_risk,
          COALESCE(a.period_orders, 0) AS period_orders,
          COALESCE(a.channel_count, 0) AS channel_count,
          CASE WHEN a.first_period_order IS NOT NULL AND a.previous_order_date < $6::date - 90 THEN true ELSE false END AS reactivated,
          AVG(c.ltv) OVER()::float8 AS average_ltv
        FROM customers c
        LEFT JOIN activity a ON a.tenant_id = c.tenant_id AND a.customer_id = c.jtl_customer_id
        WHERE c.tenant_id = ANY($1::uuid[])
          AND ($2 = '' OR c.first_name ILIKE '%' || $2 || '%' OR c.last_name ILIKE '%' || $2 || '%' OR c.company ILIKE '%' || $2 || '%')
          AND ($3 = '' OR LOWER(COALESCE(c.segment, '')) = LOWER($3))
          AND ($4 = '' OR LOWER(COALESCE(c.country_code, '')) = LOWER($4))
          AND ($10 = '' OR LOWER(COALESCE(c.region, '')) = LOWER($10))
      ), filtered AS (
        SELECT *, COUNT(*) OVER()::int AS total_count FROM base
        WHERE ($5 = 'all' OR ($5 = 'new' AND first_order_date BETWEEN $6::date AND $7::date)
          OR ($5 = 'repeat' AND customer_type = 'repeat')
          OR ($5 = 'one_time' AND customer_type = 'one_time')
          OR ($5 = 'high_value' AND ltv >= average_ltv)
          OR ($5 = 'at_risk' AND at_risk)
          OR ($5 = 'inactive' AND COALESCE(days_since_last_order, 9999) > 180)
          OR ($5 = 'reactivated' AND reactivated)
          OR ($5 = 'single_channel' AND channel_count = 1)
          OR ($5 = 'multi_channel' AND channel_count > 1))
      )
      SELECT * FROM filtered ORDER BY ${sort} ${order} NULLS LAST LIMIT $8 OFFSET $9`,
      [scope.tenantIds, query.search || '', query.segment || '', query.country || '', performance, current.start, current.end, limit, offset, query.region || ''],
    );
    return { rows, total: Number(rows[0]?.total_count || 0), page, limit, period: current };
    });
  }

  async customerSegments(scope: TenantScope) {
    this.assertEnabled('COMPARISON_CUSTOMER_ANALYSIS_ENABLED');
    const key = this.cacheKey(scope, 'customerSegments');
    return this.cache.getOrSet(key, 300, () => this.db.query(
      `SELECT COALESCE(segment, 'Unclassified') AS segment, COUNT(*)::int AS customers,
        AVG(ltv)::float8 AS average_ltv, SUM(ltv)::float8 AS total_ltv,
        AVG(total_orders)::float8 AS average_orders
       FROM customers WHERE tenant_id = ANY($1::uuid[])
       GROUP BY 1 ORDER BY total_ltv DESC`,
      [scope.tenantIds],
    ));
  }

  async orders(scope: TenantScope, query: ComparisonQueryDto, maxLimit = 100) {
    this.assertEnabled('COMPARISON_CHANNEL_DRILLDOWN_ENABLED');
    const current = resolvePeriod(query);
    const { page, limit, offset } = this.page(query, maxLimit);
    const channels = channelIds(query.channels);
    const rows = await this.db.query(
      `SELECT o.jtl_order_id, o.order_number, o.order_date, o.channel AS raw_channel,
        o.payment_method AS raw_payment_method,
        ${canonicalChannelIdSql} AS channel_id,
        ${canonicalChannelNameSql} AS channel_name,
        ${canonicalPaymentValueSql} AS payment_method,
        o.status, o.country, o.region, o.city, o.item_count,
        COALESCE(o.gross_revenue, 0)::float8 AS revenue,
        COUNT(*) OVER()::int AS total_count
       FROM orders o
       LEFT JOIN channel_mappings cm ON cm.tenant_id = o.tenant_id AND cm.raw_channel = COALESCE(NULLIF(TRIM(o.channel), ''), 'Unknown')
       WHERE o.tenant_id = ANY($1::uuid[]) AND o.order_date BETWEEN $2::date AND $3::date
         AND (cardinality($4::text[]) = 0 OR ${canonicalChannelIdSql} = ANY($4::text[]))
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
    // Bounded so a large tenant cannot spin this loop indefinitely. When the cap
    // is reached the metadata reports complete=false rather than truncating silently.
    const maxRows = this.config.integer('COMPARISON_EXPORT_MAX_ROWS', 50_000, 100, 500_000);
    const pageSize = maxRows;
    const rows: Record<string, unknown>[] = [];
    let total = 0;
    for (let page = 1; rows.length < maxRows; page += 1) {
      const pageQuery = { ...query, page, limit: pageSize };
      const result = dataset === 'product_channel_matrix'
        ? await this.productChannelMatrix(scope, pageQuery, maxRows)
        : dataset === 'channel_pair'
          ? await this.compareChannelPair(scope, pageQuery, maxRows)
        : dataset === 'products'
        ? await this.products(scope, pageQuery, maxRows)
        : dataset === 'inventory'
          ? await this.inventory(scope, pageQuery, maxRows)
          : dataset === 'customers'
            ? await this.customers(scope, pageQuery, maxRows)
            : dataset === 'orders'
              ? await this.orders(scope, pageQuery, maxRows)
              : await this.channels(scope, pageQuery, maxRows);
      rows.push(...result.rows);
      total = result.total;
      if (rows.length >= result.total || result.rows.length < result.limit) break;
    }
    const truncated = rows.length > maxRows;
    if (truncated) rows.length = maxRows;
    return buildCsv(rows, inferCsvColumns(rows), {
      metadata: {
        module: 'comparison',
        dataset,
        total_matching_rows: total,
        exported_rows: rows.length,
        complete: !truncated && rows.length >= total,
        row_limit: maxRows,
        generated_at: new Date().toISOString(),
      },
    });
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
