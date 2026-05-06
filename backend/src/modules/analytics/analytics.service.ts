import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService } from '../../cache/cache.service';
import { applyMasking } from '../../common/utils/masking';
import {
  RevenueTrendCompare,
  RevenueTrendGranularity,
  RevenueTrendQueryDto,
} from './dto/revenue-trend-query.dto';

type RevenueTrendRow = {
  period_start: string | Date;
  period_end: string | Date;
  revenue: string | number;
  prior_revenue: string | number;
  orders: string | number;
  customers: string | number;
  average_order_value: string | number;
  change_percent: string | number | null;
};

type OrdersTrendRow = {
  period_start: string | Date;
  period_end: string | Date;
  orders: string | number;
  prior_orders: string | number;
  revenue: string | number;
  customers: string | number;
  average_order_value: string | number;
  change_percent: string | number | null;
};

type ActiveProductsTrendRow = {
  period_start: string | Date;
  period_end: string | Date;
  active_products: string | number;
  prior_active_products: string | number;
  units_sold: string | number;
  revenue: string | number;
  orders: string | number;
  avg_revenue_per_active_product: string | number;
  change_percent: string | number | null;
};

type CustomersTrendRow = {
  period_start: string | Date;
  period_end: string | Date;
  customers: string | number;
  prior_customers: string | number;
  orders: string | number;
  revenue: string | number;
  average_order_value: string | number;
  average_revenue_per_customer: string | number;
  change_percent: string | number | null;
};

type CancelledTrendRow = {
  period_start: string | Date;
  period_end: string | Date;
  cancelled_orders: string | number;
  prior_cancelled_orders: string | number;
  cancelled_revenue: string | number;
  prior_cancelled_revenue: string | number;
  total_orders: string | number;
  change_percent: string | number | null;
};

type CancelledInsightRow = {
  label: string;
  cancelled_orders: string | number;
  cancelled_revenue: string | number;
  share_pct: string | number;
};

type CategoryBreakdownCategoryRow = {
  name: string;
  revenue: string | number;
  orders: string | number;
  products: string | number;
  avg_order_value: string | number;
  share_percent: string | number;
};

type CategoryBreakdownDimRow = {
  name: string;
  revenue: string | number;
  orders: string | number;
};

type CategoryBreakdownProductRow = {
  product_name: string;
  article_number: string;
  category_name: string;
  revenue: string | number;
  units: string | number;
  orders: string | number;
};

type RevenueTrendPoint = {
  periodStart: string;
  periodEnd: string;
  label: string;
  revenue: number;
  priorRevenue: number;
  changePercent: number | null;
  orders: number;
  customers: number;
  averageOrderValue: number;
};

function dateRange(
  range: string,
  from?: string,
  to?: string,
): { start: string; end: string } {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const end = to || todayStr;
  if (from) return { start: from, end };

  if (range === 'TODAY' || range === 'DAY') {
    return { start: todayStr, end: todayStr };
  }
  if (range === 'YESTERDAY') {
    const y = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    return { start: y, end: y };
  }
  if (range === 'MONTH') {
    const startOfMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    )
      .toISOString()
      .slice(0, 10);
    return { start: startOfMonth, end };
  }
  if (range === 'YEAR') {
    return { start: `${now.getUTCFullYear()}-01-01`, end };
  }
  if (range === 'YTD') {
    return { start: `${now.getUTCFullYear()}-01-01`, end };
  }
  if (range === 'ALL') {
    return { start: '2000-01-01', end };
  }

  const map: Record<string, number> = {
    '7D': 7,
    '30D': 30,
    '3M': 90,
    '6M': 180,
    '12M': 365,
    '2Y': 730,
    '5Y': 1825,
  };
  const days = map[range] ?? 365;
  const start = new Date(now.getTime() - days * 86400000)
    .toISOString()
    .slice(0, 10);
  return { start, end };
}

type InvoiceScope = 'all' | 'with_invoice' | 'without_invoice';

function normalizeInvoiceScope(value?: string): InvoiceScope {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'with_invoice') return 'with_invoice';
  if (normalized === 'without_invoice') return 'without_invoice';
  return 'all';
}

function invoicePredicate(column: string, paramIndex: number): string {
  const payment = `LOWER(TRIM(COALESCE(${column}, '')))`;
  const hasInvoice = `(${payment} LIKE '%invoice%' OR ${payment} LIKE '%rechnung%')`;
  return `(
    $${paramIndex} = 'all'
    OR ($${paramIndex} = 'with_invoice' AND ${hasInvoice})
    OR ($${paramIndex} = 'without_invoice' AND NOT ${hasInvoice})
  )`;
}

function paymentMethodLabelExpr(column = 'payment_method'): string {
  return `
    CASE
      WHEN LOWER(TRIM(COALESCE(${column}, ''))) IN ('', 'unknown', 'n/a', '-') THEN 'Unknown'
      WHEN LOWER(TRIM(${column})) LIKE '%paypal%' THEN 'PayPal'
      WHEN LOWER(TRIM(${column})) LIKE '%klarna%' THEN 'Klarna'
      WHEN LOWER(TRIM(${column})) LIKE '%stripe%' THEN 'Stripe'
      WHEN LOWER(TRIM(${column})) LIKE '%amazon%' THEN 'Amazon Pay'
      WHEN LOWER(TRIM(${column})) LIKE '%card%' OR LOWER(TRIM(${column})) LIKE '%kredit%' THEN 'Card'
      WHEN LOWER(TRIM(${column})) LIKE '%bank%' OR LOWER(TRIM(${column})) LIKE '%wire%' OR LOWER(TRIM(${column})) LIKE '%überweisung%' THEN 'Bank Transfer'
      WHEN LOWER(TRIM(${column})) LIKE '%invoice%' OR LOWER(TRIM(${column})) LIKE '%rechnung%' THEN 'Invoice'
      ELSE INITCAP(TRIM(${column}))
    END
  `;
}

function normalizePaymentMethodFilter(value?: string): string {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.toLowerCase() === 'all') return '';
  return normalized;
}

function paymentMethodPredicate(column: string, paramIndex: number): string {
  return `($${paramIndex} = '' OR ${paymentMethodLabelExpr(column)} = $${paramIndex})`;
}

function salesChannelLabelExpr(column = 'channel'): string {
  return `
    CASE
      WHEN LOWER(TRIM(COALESCE(${column}, ''))) IN ('', 'unknown', 'n/a', '-') THEN 'Unknown'
      WHEN LOWER(TRIM(${column})) IN ('direct', 'shop', 'onlineshop', 'online shop', 'webshop', 'website') THEN 'Direct'
      WHEN LOWER(TRIM(${column})) LIKE '%amazon%' THEN 'Amazon'
      WHEN LOWER(TRIM(${column})) LIKE '%ebay%' THEN 'eBay'
      WHEN LOWER(TRIM(${column})) LIKE '%marketplace%' THEN 'Marketplace'
      WHEN LOWER(TRIM(${column})) LIKE '%email%' OR LOWER(TRIM(${column})) LIKE '%newsletter%' THEN 'Email'
      WHEN LOWER(TRIM(${column})) LIKE '%referral%' OR LOWER(TRIM(${column})) LIKE '%affiliate%' THEN 'Referral'
      ELSE INITCAP(TRIM(${column}))
    END
  `;
}

function normalizeSalesChannelFilter(value?: string): string {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.toLowerCase() === 'all') return '';
  return normalized;
}

function salesChannelPredicate(column: string, paramIndex: number): string {
  return `($${paramIndex} = '' OR ${salesChannelLabelExpr(column)} = $${paramIndex})`;
}

function platformLabelExpr(column = 'channel'): string {
  return `
    CASE
      WHEN LOWER(TRIM(COALESCE(${column}, ''))) IN ('', 'unknown', 'n/a', '-') THEN 'Unknown'
      ELSE TRIM(${column})
    END
  `;
}

function normalizePlatformFilter(value?: string): string {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.toLowerCase() === 'all') return '';
  return normalized;
}

function platformPredicate(column: string, paramIndex: number): string {
  return `($${paramIndex} = '' OR ${platformLabelExpr(column)} = $${paramIndex})`;
}

function normalizedStatusExpr(column: string): string {
  const status = `LOWER(TRIM(COALESCE(${column}, '')))`;
  return `
    CASE
      WHEN ${status} IN ('cancelled', 'canceled', 'storniert', 'storno', 'annulliert', 'void', 'voided') THEN 'cancelled'
      WHEN ${status} IN ('returned', 'retour', 'retoure', 'retourniert', 'refund', 'refunded') THEN 'returned'
      WHEN ${status} IN ('', 'unknown', 'n/a', '-') THEN 'unknown'
      ELSE ${status}
    END
  `;
}

function toDateOnly(input: string | Date): string {
  if (typeof input === 'string') return input.slice(0, 10);
  return input.toISOString().slice(0, 10);
}

function monthLabel(periodStart: string): string {
  const [yearRaw, monthRaw] = periodStart.split('-');
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return periodStart;
  }
  return `${names[month - 1]} ${year}`;
}

function dayLabel(periodStart: string): string {
  const [yearRaw, monthRaw, dayRaw] = periodStart.split('-');
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const day = Number.parseInt(dayRaw, 10);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12
  ) {
    return periodStart;
  }
  return `${String(day).padStart(2, '0')} ${names[month - 1]}`;
}

function labelForPeriod(granularity: RevenueTrendGranularity, periodStart: string): string {
  if (granularity === 'year') return periodStart.slice(0, 4);
  if (granularity === 'month') return monthLabel(periodStart);
  return dayLabel(periodStart);
}

function parseAmount(value: string | number): number {
  const n = Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

function parseCount(value: string | number): number {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : 0;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly db: DataSource,
    private readonly cache: CacheService,
  ) {}

  async getRevenueTrend(
    tenantId: string,
    filters: RevenueTrendQueryDto,
    role: string,
    userLevel: string,
  ) {
    const {
      range = 'ALL',
      from,
      to,
      status = '',
      invoice,
      paymentMethod,
      channel,
      platform,
      granularity = 'year',
      compare = 'prior_year',
    } = filters;

    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const invoiceScope = normalizeInvoiceScope(invoice);
    const paymentMethodFilter = normalizePaymentMethodFilter(paymentMethod);
    const channelFilter = normalizeSalesChannelFilter(channel);
    const platformFilter = normalizePlatformFilter(platform);
    const compareMode: RevenueTrendCompare = compare === 'prior_year' ? 'prior_year' : 'none';
    const unit: RevenueTrendGranularity =
      granularity === 'day' || granularity === 'month' ? granularity : 'year';

    const key = [
      'jtl',
      tenantId,
      'analytics',
      'revenue-trend',
      start,
      end,
      unit,
      compareMode,
      statusFilter,
      invoiceScope,
      paymentMethodFilter,
      channelFilter,
      platformFilter,
    ].join(':');

    return this.cache.getOrSet(key, 120, async () => {
      const rows = (await this.db.query(
        `
        WITH series AS (
          SELECT
            gs::date AS period_start,
            CASE
              WHEN $4 = 'year' THEN (gs + INTERVAL '1 year - 1 day')::date
              WHEN $4 = 'month' THEN (gs + INTERVAL '1 month - 1 day')::date
              ELSE gs::date
            END AS period_end
          FROM generate_series(
            DATE_TRUNC($4, $2::date)::date,
            DATE_TRUNC($4, $3::date)::date,
            CASE
              WHEN $4 = 'year' THEN INTERVAL '1 year'
              WHEN $4 = 'month' THEN INTERVAL '1 month'
              ELSE INTERVAL '1 day'
            END
          ) AS gs
        ),
        current_data AS (
          SELECT
            DATE_TRUNC($4, o.order_date)::date AS period_start,
            COALESCE(SUM(o.gross_revenue), 0)::numeric AS revenue,
            COUNT(*)::int AS orders,
            COUNT(DISTINCT o.customer_id)::int AS customers
          FROM orders o
          WHERE o.tenant_id = $1
            AND o.order_date BETWEEN $2 AND $3
            AND ($5 = '' OR o.status = $5)
            AND ${invoicePredicate('o.payment_method', 6)}
            AND ${paymentMethodPredicate('o.payment_method', 7)}
            AND ${salesChannelPredicate('o.channel', 8)}
            AND ${platformPredicate('o.channel', 9)}
          GROUP BY 1
        ),
        prior_aligned AS (
          SELECT
            DATE_TRUNC($4, o.order_date + INTERVAL '1 year')::date AS period_start,
            COALESCE(SUM(o.gross_revenue), 0)::numeric AS prior_revenue
          FROM orders o
          WHERE o.tenant_id = $1
            AND o.order_date BETWEEN ($2::date - INTERVAL '1 year') AND ($3::date - INTERVAL '1 year')
            AND ($5 = '' OR o.status = $5)
            AND ${invoicePredicate('o.payment_method', 6)}
            AND ${paymentMethodPredicate('o.payment_method', 7)}
            AND ${salesChannelPredicate('o.channel', 8)}
            AND ${platformPredicate('o.channel', 9)}
          GROUP BY 1
        ),
        merged AS (
          SELECT
            s.period_start,
            LEAST(s.period_end, $3::date) AS period_end,
            COALESCE(c.revenue, 0)::numeric AS revenue,
            COALESCE(c.orders, 0)::int AS orders,
            COALESCE(c.customers, 0)::int AS customers,
            CASE WHEN $10 = 'prior_year' THEN COALESCE(p.prior_revenue, 0)::numeric ELSE 0::numeric END AS prior_revenue
          FROM series s
          LEFT JOIN current_data c ON c.period_start = s.period_start
          LEFT JOIN prior_aligned p ON p.period_start = s.period_start
        )
        SELECT
          period_start,
          period_end,
          revenue,
          prior_revenue,
          orders,
          customers,
          CASE WHEN orders > 0 THEN ROUND((revenue / orders)::numeric, 2) ELSE 0::numeric END AS average_order_value,
          CASE
            WHEN $10 <> 'prior_year' THEN NULL
            WHEN prior_revenue = 0 THEN NULL
            ELSE ROUND(((revenue - prior_revenue) / prior_revenue * 100)::numeric, 2)
          END AS change_percent
        FROM merged
        ORDER BY period_start ASC
        `,
        [
          tenantId,
          start,
          end,
          unit,
          statusFilter,
          invoiceScope,
          paymentMethodFilter,
          channelFilter,
          platformFilter,
          compareMode,
        ],
      )) as RevenueTrendRow[];

      const points: RevenueTrendPoint[] = rows.map((row) => {
        const periodStart = toDateOnly(row.period_start);
        const periodEnd = toDateOnly(row.period_end);
        return {
          periodStart,
          periodEnd,
          label: labelForPeriod(unit, periodStart),
          revenue: parseAmount(row.revenue),
          priorRevenue: parseAmount(row.prior_revenue),
          changePercent:
            row.change_percent == null ? null : parseAmount(row.change_percent),
          orders: parseCount(row.orders),
          customers: parseCount(row.customers),
          averageOrderValue: parseAmount(row.average_order_value),
        };
      });

      const summary = points.reduce(
        (acc, point) => {
          acc.revenue += point.revenue;
          acc.priorRevenue += point.priorRevenue;
          acc.orders += point.orders;
          acc.customers += point.customers;
          return acc;
        },
        { revenue: 0, priorRevenue: 0, orders: 0, customers: 0 },
      );

      const payload = {
        granularity: unit,
        range: {
          from: start,
          to: end,
        },
        summary: {
          revenue: Number(summary.revenue.toFixed(2)),
          priorRevenue: Number(summary.priorRevenue.toFixed(2)),
          changePercent:
            compareMode === 'prior_year' && summary.priorRevenue > 0
              ? Number((((summary.revenue - summary.priorRevenue) / summary.priorRevenue) * 100).toFixed(2))
              : null,
          orders: summary.orders,
          customers: summary.customers,
          averageOrderValue:
            summary.orders > 0
              ? Number((summary.revenue / summary.orders).toFixed(2))
              : 0,
        },
        points,
      };

      return applyMasking(payload, userLevel, role);
    });
  }

  async getOrdersTrend(
    tenantId: string,
    filters: RevenueTrendQueryDto,
    role: string,
    userLevel: string,
  ) {
    const {
      range = 'ALL',
      from,
      to,
      status = '',
      invoice,
      paymentMethod,
      channel,
      platform,
      granularity = 'year',
      compare = 'prior_year',
    } = filters;

    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const invoiceScope = normalizeInvoiceScope(invoice);
    const paymentMethodFilter = normalizePaymentMethodFilter(paymentMethod);
    const channelFilter = normalizeSalesChannelFilter(channel);
    const platformFilter = normalizePlatformFilter(platform);
    const compareMode: RevenueTrendCompare =
      compare === 'prior_year' ? 'prior_year' : 'none';
    const unit: RevenueTrendGranularity =
      granularity === 'day' || granularity === 'month' ? granularity : 'year';

    const key = [
      'jtl',
      tenantId,
      'analytics',
      'orders-trend',
      start,
      end,
      unit,
      compareMode,
      statusFilter,
      invoiceScope,
      paymentMethodFilter,
      channelFilter,
      platformFilter,
    ].join(':');

    return this.cache.getOrSet(key, 120, async () => {
      const rows = (await this.db.query(
        `
        WITH series AS (
          SELECT
            gs::date AS period_start,
            CASE
              WHEN $4 = 'year' THEN (gs + INTERVAL '1 year - 1 day')::date
              WHEN $4 = 'month' THEN (gs + INTERVAL '1 month - 1 day')::date
              ELSE gs::date
            END AS period_end
          FROM generate_series(
            DATE_TRUNC($4, $2::date)::date,
            DATE_TRUNC($4, $3::date)::date,
            CASE
              WHEN $4 = 'year' THEN INTERVAL '1 year'
              WHEN $4 = 'month' THEN INTERVAL '1 month'
              ELSE INTERVAL '1 day'
            END
          ) AS gs
        ),
        current_data AS (
          SELECT
            DATE_TRUNC($4, o.order_date)::date AS period_start,
            COUNT(*)::int AS orders,
            COALESCE(SUM(o.gross_revenue), 0)::numeric AS revenue,
            COUNT(DISTINCT o.customer_id)::int AS customers
          FROM orders o
          WHERE o.tenant_id = $1
            AND o.order_date BETWEEN $2 AND $3
            AND ($5 = '' OR o.status = $5)
            AND ${invoicePredicate('o.payment_method', 6)}
            AND ${paymentMethodPredicate('o.payment_method', 7)}
            AND ${salesChannelPredicate('o.channel', 8)}
            AND ${platformPredicate('o.channel', 9)}
          GROUP BY 1
        ),
        prior_aligned AS (
          SELECT
            DATE_TRUNC($4, o.order_date + INTERVAL '1 year')::date AS period_start,
            COUNT(*)::int AS prior_orders
          FROM orders o
          WHERE o.tenant_id = $1
            AND o.order_date BETWEEN ($2::date - INTERVAL '1 year') AND ($3::date - INTERVAL '1 year')
            AND ($5 = '' OR o.status = $5)
            AND ${invoicePredicate('o.payment_method', 6)}
            AND ${paymentMethodPredicate('o.payment_method', 7)}
            AND ${salesChannelPredicate('o.channel', 8)}
            AND ${platformPredicate('o.channel', 9)}
          GROUP BY 1
        ),
        merged AS (
          SELECT
            s.period_start,
            LEAST(s.period_end, $3::date) AS period_end,
            COALESCE(c.orders, 0)::int AS orders,
            CASE WHEN $10 = 'prior_year' THEN COALESCE(p.prior_orders, 0)::int ELSE 0::int END AS prior_orders,
            COALESCE(c.revenue, 0)::numeric AS revenue,
            COALESCE(c.customers, 0)::int AS customers
          FROM series s
          LEFT JOIN current_data c ON c.period_start = s.period_start
          LEFT JOIN prior_aligned p ON p.period_start = s.period_start
        )
        SELECT
          period_start,
          period_end,
          orders,
          prior_orders,
          revenue,
          customers,
          CASE WHEN orders > 0 THEN ROUND((revenue / orders)::numeric, 2) ELSE 0::numeric END AS average_order_value,
          CASE
            WHEN $10 <> 'prior_year' THEN NULL
            WHEN prior_orders = 0 THEN NULL
            ELSE ROUND(((orders - prior_orders)::numeric / prior_orders::numeric * 100)::numeric, 2)
          END AS change_percent
        FROM merged
        ORDER BY period_start ASC
        `,
        [
          tenantId,
          start,
          end,
          unit,
          statusFilter,
          invoiceScope,
          paymentMethodFilter,
          channelFilter,
          platformFilter,
          compareMode,
        ],
      )) as OrdersTrendRow[];

      const points = rows.map((row) => {
        const periodStart = toDateOnly(row.period_start);
        const periodEnd = toDateOnly(row.period_end);
        return {
          periodStart,
          periodEnd,
          label: labelForPeriod(unit, periodStart),
          orders: parseCount(row.orders),
          priorOrders: parseCount(row.prior_orders),
          changePercent:
            row.change_percent == null ? null : parseAmount(row.change_percent),
          revenue: parseAmount(row.revenue),
          customers: parseCount(row.customers),
          averageOrderValue: parseAmount(row.average_order_value),
        };
      });

      const summary = points.reduce(
        (acc, point) => {
          acc.orders += point.orders;
          acc.priorOrders += point.priorOrders;
          acc.revenue += point.revenue;
          acc.customers += point.customers;
          return acc;
        },
        { orders: 0, priorOrders: 0, revenue: 0, customers: 0 },
      );

      const payload = {
        granularity: unit,
        range: {
          from: start,
          to: end,
        },
        summary: {
          orders: summary.orders,
          priorOrders: summary.priorOrders,
          changePercent:
            compareMode === 'prior_year' && summary.priorOrders > 0
              ? Number((((summary.orders - summary.priorOrders) / summary.priorOrders) * 100).toFixed(2))
              : null,
          revenue: Number(summary.revenue.toFixed(2)),
          customers: summary.customers,
          averageOrderValue:
            summary.orders > 0 ? Number((summary.revenue / summary.orders).toFixed(2)) : 0,
        },
        points,
      };

      return applyMasking(payload, userLevel, role);
    });
  }

  async getCategoryRevenueTrend(
    tenantId: string,
    filters: RevenueTrendQueryDto,
    role: string,
    userLevel: string,
  ) {
    const {
      range = 'ALL',
      from,
      to,
      status = '',
      invoice,
      paymentMethod,
      channel,
      platform,
      category = '',
      granularity = 'year',
      compare = 'prior_year',
    } = filters;

    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const invoiceScope = normalizeInvoiceScope(invoice);
    const paymentMethodFilter = normalizePaymentMethodFilter(paymentMethod);
    const channelFilter = normalizeSalesChannelFilter(channel);
    const platformFilter = normalizePlatformFilter(platform);
    const categoryFilter = String(category || '').trim();
    const compareMode: RevenueTrendCompare =
      compare === 'prior_year' ? 'prior_year' : 'none';
    const unit: RevenueTrendGranularity =
      granularity === 'day' || granularity === 'month' ? granularity : 'year';

    const key = [
      'jtl',
      tenantId,
      'analytics',
      'category-revenue-trend',
      start,
      end,
      unit,
      compareMode,
      statusFilter,
      invoiceScope,
      paymentMethodFilter,
      channelFilter,
      platformFilter,
      categoryFilter,
    ].join(':');

    return this.cache.getOrSet(key, 120, async () => {
      const rows = (await this.db.query(
        `
        WITH series AS (
          SELECT
            gs::date AS period_start,
            CASE
              WHEN $4 = 'year' THEN (gs + INTERVAL '1 year - 1 day')::date
              WHEN $4 = 'month' THEN (gs + INTERVAL '1 month - 1 day')::date
              ELSE gs::date
            END AS period_end
          FROM generate_series(
            DATE_TRUNC($4, $2::date)::date,
            DATE_TRUNC($4, $3::date)::date,
            CASE
              WHEN $4 = 'year' THEN INTERVAL '1 year'
              WHEN $4 = 'month' THEN INTERVAL '1 month'
              ELSE INTERVAL '1 day'
            END
          ) AS gs
        ),
        current_data AS (
          SELECT
            DATE_TRUNC($4, o.order_date)::date AS period_start,
            COALESCE(SUM(COALESCE(oi.line_total_gross, oi.quantity * oi.unit_price_gross, 0)), 0)::numeric AS revenue,
            COUNT(DISTINCT o.jtl_order_id)::int AS orders,
            COUNT(DISTINCT COALESCE(NULLIF(TRIM(COALESCE(o.customer_number, '')), ''), NULLIF(o.customer_id::text, ''), 'order:' || o.jtl_order_id::text))::int AS customers
          FROM orders o
          JOIN order_items oi
            ON oi.tenant_id = o.tenant_id
           AND oi.order_id = o.jtl_order_id
          LEFT JOIN products p
            ON p.tenant_id = oi.tenant_id
           AND p.jtl_product_id = oi.product_id
          LEFT JOIN categories c
            ON c.tenant_id = p.tenant_id
           AND c.jtl_category_id = p.category_id
          WHERE o.tenant_id = $1
            AND o.order_date BETWEEN $2 AND $3
            AND ($5 = '' OR o.status = $5)
            AND ${invoicePredicate('o.payment_method', 6)}
            AND ${paymentMethodPredicate('o.payment_method', 7)}
            AND ${salesChannelPredicate('o.channel', 8)}
            AND ${platformPredicate('o.channel', 9)}
            AND ($10 = '' OR COALESCE(c.name, 'Uncategorized') = $10)
          GROUP BY 1
        ),
        prior_aligned AS (
          SELECT
            DATE_TRUNC($4, o.order_date + INTERVAL '1 year')::date AS period_start,
            COALESCE(SUM(COALESCE(oi.line_total_gross, oi.quantity * oi.unit_price_gross, 0)), 0)::numeric AS prior_revenue
          FROM orders o
          JOIN order_items oi
            ON oi.tenant_id = o.tenant_id
           AND oi.order_id = o.jtl_order_id
          LEFT JOIN products p
            ON p.tenant_id = oi.tenant_id
           AND p.jtl_product_id = oi.product_id
          LEFT JOIN categories c
            ON c.tenant_id = p.tenant_id
           AND c.jtl_category_id = p.category_id
          WHERE o.tenant_id = $1
            AND o.order_date BETWEEN ($2::date - INTERVAL '1 year') AND ($3::date - INTERVAL '1 year')
            AND ($5 = '' OR o.status = $5)
            AND ${invoicePredicate('o.payment_method', 6)}
            AND ${paymentMethodPredicate('o.payment_method', 7)}
            AND ${salesChannelPredicate('o.channel', 8)}
            AND ${platformPredicate('o.channel', 9)}
            AND ($10 = '' OR COALESCE(c.name, 'Uncategorized') = $10)
          GROUP BY 1
        ),
        merged AS (
          SELECT
            s.period_start,
            LEAST(s.period_end, $3::date) AS period_end,
            COALESCE(c.revenue, 0)::numeric AS revenue,
            CASE WHEN $11 = 'prior_year' THEN COALESCE(p.prior_revenue, 0)::numeric ELSE 0::numeric END AS prior_revenue,
            COALESCE(c.orders, 0)::int AS orders,
            COALESCE(c.customers, 0)::int AS customers
          FROM series s
          LEFT JOIN current_data c ON c.period_start = s.period_start
          LEFT JOIN prior_aligned p ON p.period_start = s.period_start
        )
        SELECT
          period_start,
          period_end,
          revenue,
          prior_revenue,
          orders,
          customers,
          CASE WHEN orders > 0 THEN ROUND((revenue / orders)::numeric, 2) ELSE 0::numeric END AS average_order_value,
          CASE
            WHEN $11 <> 'prior_year' THEN NULL
            WHEN prior_revenue = 0 THEN NULL
            ELSE ROUND(((revenue - prior_revenue) / prior_revenue * 100)::numeric, 2)
          END AS change_percent
        FROM merged
        ORDER BY period_start ASC
        `,
        [
          tenantId,
          start,
          end,
          unit,
          statusFilter,
          invoiceScope,
          paymentMethodFilter,
          channelFilter,
          platformFilter,
          categoryFilter,
          compareMode,
        ],
      )) as RevenueTrendRow[];

      const points = rows.map((row) => {
        const periodStart = toDateOnly(row.period_start);
        const periodEnd = toDateOnly(row.period_end);
        return {
          periodStart,
          periodEnd,
          label: labelForPeriod(unit, periodStart),
          revenue: parseAmount(row.revenue),
          priorRevenue: parseAmount(row.prior_revenue),
          changePercent:
            row.change_percent == null ? null : parseAmount(row.change_percent),
          orders: parseCount(row.orders),
          customers: parseCount(row.customers),
          averageOrderValue: parseAmount(row.average_order_value),
        };
      });

      const summary = points.reduce(
        (acc, point) => {
          acc.revenue += point.revenue;
          acc.priorRevenue += point.priorRevenue;
          acc.orders += point.orders;
          acc.customers += point.customers;
          return acc;
        },
        { revenue: 0, priorRevenue: 0, orders: 0, customers: 0 },
      );

      const payload = {
        granularity: unit,
        range: {
          from: start,
          to: end,
        },
        category: categoryFilter || 'all',
        summary: {
          revenue: Number(summary.revenue.toFixed(2)),
          priorRevenue: Number(summary.priorRevenue.toFixed(2)),
          changePercent:
            compareMode === 'prior_year' && summary.priorRevenue > 0
              ? Number((((summary.revenue - summary.priorRevenue) / summary.priorRevenue) * 100).toFixed(2))
              : null,
          orders: summary.orders,
          customers: summary.customers,
          averageOrderValue:
            summary.orders > 0
              ? Number((summary.revenue / summary.orders).toFixed(2))
              : 0,
        },
        points,
      };

      return applyMasking(payload, userLevel, role);
    });
  }

  async getCategoryBreakdown(
    tenantId: string,
    filters: RevenueTrendQueryDto,
    role: string,
    userLevel: string,
  ) {
    const {
      range = 'ALL',
      from,
      to,
      status = '',
      invoice,
      paymentMethod,
      channel,
      platform,
      category = '',
    } = filters;

    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const invoiceScope = normalizeInvoiceScope(invoice);
    const paymentMethodFilter = normalizePaymentMethodFilter(paymentMethod);
    const channelFilter = normalizeSalesChannelFilter(channel);
    const platformFilter = normalizePlatformFilter(platform);
    const categoryFilter = String(category || '').trim();

    const key = [
      'jtl',
      tenantId,
      'analytics',
      'category-breakdown',
      start,
      end,
      statusFilter,
      invoiceScope,
      paymentMethodFilter,
      channelFilter,
      platformFilter,
      categoryFilter,
    ].join(':');

    return this.cache.getOrSet(key, 120, async () => {
      const params = [
        tenantId,
        start,
        end,
        statusFilter,
        invoiceScope,
        paymentMethodFilter,
        channelFilter,
        platformFilter,
        categoryFilter,
      ];

      const categoriesRows = (await this.db.query(
        `
        WITH grouped AS (
          SELECT
            COALESCE(c.name, 'Uncategorized') AS name,
            COALESCE(SUM(COALESCE(oi.line_total_gross, oi.quantity * oi.unit_price_gross, 0)), 0)::numeric AS revenue,
            COUNT(DISTINCT o.jtl_order_id)::int AS orders,
            COUNT(DISTINCT oi.product_id)::int AS products,
            CASE
              WHEN COUNT(DISTINCT o.jtl_order_id) > 0
                THEN ROUND((SUM(COALESCE(oi.line_total_gross, oi.quantity * oi.unit_price_gross, 0))
                  / COUNT(DISTINCT o.jtl_order_id))::numeric, 2)
              ELSE 0::numeric
            END AS avg_order_value
          FROM orders o
          JOIN order_items oi
            ON oi.tenant_id = o.tenant_id
           AND oi.order_id = o.jtl_order_id
          LEFT JOIN products p
            ON p.tenant_id = oi.tenant_id
           AND p.jtl_product_id = oi.product_id
          LEFT JOIN categories c
            ON c.tenant_id = p.tenant_id
           AND c.jtl_category_id = p.category_id
          WHERE o.tenant_id = $1
            AND o.order_date BETWEEN $2 AND $3
            AND ($4 = '' OR o.status = $4)
            AND ${invoicePredicate('o.payment_method', 5)}
            AND ${paymentMethodPredicate('o.payment_method', 6)}
            AND ${salesChannelPredicate('o.channel', 7)}
            AND ${platformPredicate('o.channel', 8)}
          GROUP BY 1
        )
        SELECT
          name,
          revenue,
          orders,
          products,
          avg_order_value,
          CASE
            WHEN SUM(revenue) OVER() > 0
              THEN ROUND((revenue * 100 / SUM(revenue) OVER())::numeric, 2)
            ELSE 0::numeric
          END AS share_percent
        FROM grouped
        ORDER BY revenue DESC, name ASC
        `,
        params.slice(0, 8),
      )) as CategoryBreakdownCategoryRow[];

      const dimensionQuery = async (
        labelExpr: string,
        columnAlias: string,
      ): Promise<CategoryBreakdownDimRow[]> =>
        (await this.db.query(
          `
          SELECT
            ${labelExpr} AS ${columnAlias},
            COALESCE(SUM(COALESCE(oi.line_total_gross, oi.quantity * oi.unit_price_gross, 0)), 0)::numeric AS revenue,
            COUNT(DISTINCT o.jtl_order_id)::int AS orders
          FROM orders o
          JOIN order_items oi
            ON oi.tenant_id = o.tenant_id
           AND oi.order_id = o.jtl_order_id
          LEFT JOIN products p
            ON p.tenant_id = oi.tenant_id
           AND p.jtl_product_id = oi.product_id
          LEFT JOIN categories c
            ON c.tenant_id = p.tenant_id
           AND c.jtl_category_id = p.category_id
          WHERE o.tenant_id = $1
            AND o.order_date BETWEEN $2 AND $3
            AND ($4 = '' OR o.status = $4)
            AND ${invoicePredicate('o.payment_method', 5)}
            AND ${paymentMethodPredicate('o.payment_method', 6)}
            AND ${salesChannelPredicate('o.channel', 7)}
            AND ${platformPredicate('o.channel', 8)}
            AND ($9 = '' OR COALESCE(c.name, 'Uncategorized') = $9)
          GROUP BY 1
          ORDER BY revenue DESC, ${columnAlias} ASC
          LIMIT 20
          `,
          params,
        )) as CategoryBreakdownDimRow[];

      const [channelsRows, platformsRows, paymentsRows, shippingRows, countriesRows, topProductsRows, leastProductsRows] =
        await Promise.all([
          dimensionQuery(salesChannelLabelExpr('o.channel'), 'name'),
          dimensionQuery(platformLabelExpr('o.channel'), 'name'),
          dimensionQuery(paymentMethodLabelExpr('o.payment_method'), 'name'),
          dimensionQuery(`COALESCE(NULLIF(TRIM(o.shipping_method), ''), 'Unknown')`, 'name'),
          dimensionQuery(`COALESCE(NULLIF(TRIM(o.country), ''), 'Unknown')`, 'name'),
          this.db.query(
            `
            SELECT
              COALESCE(NULLIF(TRIM(p.name), ''), 'Unknown Product') AS product_name,
              COALESCE(NULLIF(TRIM(p.article_number), ''), '-') AS article_number,
              COALESCE(c.name, 'Uncategorized') AS category_name,
              COALESCE(SUM(COALESCE(oi.line_total_gross, oi.quantity * oi.unit_price_gross, 0)), 0)::numeric AS revenue,
              COALESCE(SUM(COALESCE(oi.quantity, 0)), 0)::numeric AS units,
              COUNT(DISTINCT o.jtl_order_id)::int AS orders
            FROM orders o
            JOIN order_items oi
              ON oi.tenant_id = o.tenant_id
             AND oi.order_id = o.jtl_order_id
            LEFT JOIN products p
              ON p.tenant_id = oi.tenant_id
             AND p.jtl_product_id = oi.product_id
            LEFT JOIN categories c
              ON c.tenant_id = p.tenant_id
             AND c.jtl_category_id = p.category_id
            WHERE o.tenant_id = $1
              AND o.order_date BETWEEN $2 AND $3
              AND ($4 = '' OR o.status = $4)
              AND ${invoicePredicate('o.payment_method', 5)}
              AND ${paymentMethodPredicate('o.payment_method', 6)}
              AND ${salesChannelPredicate('o.channel', 7)}
              AND ${platformPredicate('o.channel', 8)}
              AND ($9 = '' OR COALESCE(c.name, 'Uncategorized') = $9)
            GROUP BY 1, 2, 3
            ORDER BY revenue DESC, product_name ASC
            LIMIT 20
            `,
            params,
          ) as Promise<CategoryBreakdownProductRow[]>,
          this.db.query(
            `
            SELECT
              COALESCE(NULLIF(TRIM(p.name), ''), 'Unknown Product') AS product_name,
              COALESCE(NULLIF(TRIM(p.article_number), ''), '-') AS article_number,
              COALESCE(c.name, 'Uncategorized') AS category_name,
              COALESCE(SUM(COALESCE(oi.line_total_gross, oi.quantity * oi.unit_price_gross, 0)), 0)::numeric AS revenue,
              COALESCE(SUM(COALESCE(oi.quantity, 0)), 0)::numeric AS units,
              COUNT(DISTINCT o.jtl_order_id)::int AS orders
            FROM orders o
            JOIN order_items oi
              ON oi.tenant_id = o.tenant_id
             AND oi.order_id = o.jtl_order_id
            LEFT JOIN products p
              ON p.tenant_id = oi.tenant_id
             AND p.jtl_product_id = oi.product_id
            LEFT JOIN categories c
              ON c.tenant_id = p.tenant_id
             AND c.jtl_category_id = p.category_id
            WHERE o.tenant_id = $1
              AND o.order_date BETWEEN $2 AND $3
              AND ($4 = '' OR o.status = $4)
              AND ${invoicePredicate('o.payment_method', 5)}
              AND ${paymentMethodPredicate('o.payment_method', 6)}
              AND ${salesChannelPredicate('o.channel', 7)}
              AND ${platformPredicate('o.channel', 8)}
              AND ($9 = '' OR COALESCE(c.name, 'Uncategorized') = $9)
            GROUP BY 1, 2, 3
            HAVING COALESCE(SUM(COALESCE(oi.line_total_gross, oi.quantity * oi.unit_price_gross, 0)), 0) > 0
            ORDER BY revenue ASC, product_name ASC
            LIMIT 20
            `,
            params,
          ) as Promise<CategoryBreakdownProductRow[]>,
        ]);

      const totals = categoriesRows.reduce(
        (acc, row) => {
          acc.revenue += parseAmount(row.revenue);
          acc.orders += parseCount(row.orders);
          return acc;
        },
        { revenue: 0, orders: 0 },
      );

      const payload = {
        range: { from: start, to: end },
        selectedCategory: categoryFilter || 'all',
        summary: {
          totalCategories: categoriesRows.length,
          totalRevenue: Number(totals.revenue.toFixed(2)),
          totalOrders: totals.orders,
          avgOrderValue:
            totals.orders > 0 ? Number((totals.revenue / totals.orders).toFixed(2)) : 0,
        },
        categories: categoriesRows.map((row) => ({
          name: row.name,
          revenue: parseAmount(row.revenue),
          orders: parseCount(row.orders),
          products: parseCount(row.products),
          averageOrderValue: parseAmount(row.avg_order_value),
          sharePercent: parseAmount(row.share_percent),
        })),
        breakdown: {
          channels: channelsRows.map((row) => ({
            name: row.name,
            revenue: parseAmount(row.revenue),
            orders: parseCount(row.orders),
          })),
          platforms: platformsRows.map((row) => ({
            name: row.name,
            revenue: parseAmount(row.revenue),
            orders: parseCount(row.orders),
          })),
          paymentMethods: paymentsRows.map((row) => ({
            name: row.name,
            revenue: parseAmount(row.revenue),
            orders: parseCount(row.orders),
          })),
          shippingMethods: shippingRows.map((row) => ({
            name: row.name,
            revenue: parseAmount(row.revenue),
            orders: parseCount(row.orders),
          })),
          countries: countriesRows.map((row) => ({
            name: row.name,
            revenue: parseAmount(row.revenue),
            orders: parseCount(row.orders),
          })),
        },
        products: {
          top: topProductsRows.map((row) => ({
            name: row.product_name,
            articleNumber: row.article_number,
            category: row.category_name,
            revenue: parseAmount(row.revenue),
            units: parseAmount(row.units),
            orders: parseCount(row.orders),
          })),
          least: leastProductsRows.map((row) => ({
            name: row.product_name,
            articleNumber: row.article_number,
            category: row.category_name,
            revenue: parseAmount(row.revenue),
            units: parseAmount(row.units),
            orders: parseCount(row.orders),
          })),
        },
      };

      return applyMasking(payload, userLevel, role);
    });
  }

  async getCustomersTrend(
    tenantId: string,
    filters: RevenueTrendQueryDto,
    role: string,
    userLevel: string,
  ) {
    const {
      range = 'ALL',
      from,
      to,
      status = '',
      invoice,
      paymentMethod,
      channel,
      platform,
      granularity = 'year',
      compare = 'prior_year',
    } = filters;

    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const invoiceScope = normalizeInvoiceScope(invoice);
    const paymentMethodFilter = normalizePaymentMethodFilter(paymentMethod);
    const channelFilter = normalizeSalesChannelFilter(channel);
    const platformFilter = normalizePlatformFilter(platform);
    const compareMode: RevenueTrendCompare =
      compare === 'prior_year' ? 'prior_year' : 'none';
    const unit: RevenueTrendGranularity =
      granularity === 'day' || granularity === 'month' ? granularity : 'year';

    const key = [
      'jtl',
      tenantId,
      'analytics',
      'customers-trend',
      start,
      end,
      unit,
      compareMode,
      statusFilter,
      invoiceScope,
      paymentMethodFilter,
      channelFilter,
      platformFilter,
    ].join(':');

    return this.cache.getOrSet(key, 120, async () => {
      const rows = (await this.db.query(
        `
        WITH series AS (
          SELECT
            gs::date AS period_start,
            CASE
              WHEN $4 = 'year' THEN (gs + INTERVAL '1 year - 1 day')::date
              WHEN $4 = 'month' THEN (gs + INTERVAL '1 month - 1 day')::date
              ELSE gs::date
            END AS period_end
          FROM generate_series(
            DATE_TRUNC($4, $2::date)::date,
            DATE_TRUNC($4, $3::date)::date,
            CASE
              WHEN $4 = 'year' THEN INTERVAL '1 year'
              WHEN $4 = 'month' THEN INTERVAL '1 month'
              ELSE INTERVAL '1 day'
            END
          ) AS gs
        ),
        current_data AS (
          SELECT
            DATE_TRUNC($4, o.order_date)::date AS period_start,
            COUNT(
              DISTINCT COALESCE(
                NULLIF(TRIM(COALESCE(o.customer_number, '')), ''),
                NULLIF(o.customer_id::text, ''),
                'order:' || o.jtl_order_id::text
              )
            )::int AS customers,
            COUNT(*)::int AS orders,
            COALESCE(SUM(o.gross_revenue), 0)::numeric AS revenue
          FROM orders o
          WHERE o.tenant_id = $1
            AND o.order_date BETWEEN $2 AND $3
            AND ($5 = '' OR o.status = $5)
            AND ${invoicePredicate('o.payment_method', 6)}
            AND ${paymentMethodPredicate('o.payment_method', 7)}
            AND ${salesChannelPredicate('o.channel', 8)}
            AND ${platformPredicate('o.channel', 9)}
          GROUP BY 1
        ),
        prior_aligned AS (
          SELECT
            DATE_TRUNC($4, o.order_date + INTERVAL '1 year')::date AS period_start,
            COUNT(
              DISTINCT COALESCE(
                NULLIF(TRIM(COALESCE(o.customer_number, '')), ''),
                NULLIF(o.customer_id::text, ''),
                'order:' || o.jtl_order_id::text
              )
            )::int AS prior_customers
          FROM orders o
          WHERE o.tenant_id = $1
            AND o.order_date BETWEEN ($2::date - INTERVAL '1 year') AND ($3::date - INTERVAL '1 year')
            AND ($5 = '' OR o.status = $5)
            AND ${invoicePredicate('o.payment_method', 6)}
            AND ${paymentMethodPredicate('o.payment_method', 7)}
            AND ${salesChannelPredicate('o.channel', 8)}
            AND ${platformPredicate('o.channel', 9)}
          GROUP BY 1
        ),
        merged AS (
          SELECT
            s.period_start,
            LEAST(s.period_end, $3::date) AS period_end,
            COALESCE(c.customers, 0)::int AS customers,
            CASE WHEN $10 = 'prior_year' THEN COALESCE(p.prior_customers, 0)::int ELSE 0::int END AS prior_customers,
            COALESCE(c.orders, 0)::int AS orders,
            COALESCE(c.revenue, 0)::numeric AS revenue
          FROM series s
          LEFT JOIN current_data c ON c.period_start = s.period_start
          LEFT JOIN prior_aligned p ON p.period_start = s.period_start
        )
        SELECT
          period_start,
          period_end,
          customers,
          prior_customers,
          orders,
          revenue,
          CASE WHEN orders > 0 THEN ROUND((revenue / orders)::numeric, 2) ELSE 0::numeric END AS average_order_value,
          CASE WHEN customers > 0 THEN ROUND((revenue / customers)::numeric, 2) ELSE 0::numeric END AS average_revenue_per_customer,
          CASE
            WHEN $10 <> 'prior_year' THEN NULL
            WHEN prior_customers = 0 THEN NULL
            ELSE ROUND(((customers - prior_customers)::numeric / prior_customers::numeric * 100)::numeric, 2)
          END AS change_percent
        FROM merged
        ORDER BY period_start ASC
        `,
        [
          tenantId,
          start,
          end,
          unit,
          statusFilter,
          invoiceScope,
          paymentMethodFilter,
          channelFilter,
          platformFilter,
          compareMode,
        ],
      )) as CustomersTrendRow[];

      const points = rows.map((row) => {
        const periodStart = toDateOnly(row.period_start);
        const periodEnd = toDateOnly(row.period_end);
        return {
          periodStart,
          periodEnd,
          label: labelForPeriod(unit, periodStart),
          customers: parseCount(row.customers),
          priorCustomers: parseCount(row.prior_customers),
          changePercent:
            row.change_percent == null ? null : parseAmount(row.change_percent),
          orders: parseCount(row.orders),
          revenue: parseAmount(row.revenue),
          averageOrderValue: parseAmount(row.average_order_value),
          averageRevenuePerCustomer: parseAmount(row.average_revenue_per_customer),
        };
      });

      const summary = points.reduce(
        (acc, point) => {
          acc.customers += point.customers;
          acc.priorCustomers += point.priorCustomers;
          acc.orders += point.orders;
          acc.revenue += point.revenue;
          return acc;
        },
        { customers: 0, priorCustomers: 0, orders: 0, revenue: 0 },
      );

      const payload = {
        granularity: unit,
        range: {
          from: start,
          to: end,
        },
        summary: {
          customers: summary.customers,
          priorCustomers: summary.priorCustomers,
          changePercent:
            compareMode === 'prior_year' && summary.priorCustomers > 0
              ? Number((((summary.customers - summary.priorCustomers) / summary.priorCustomers) * 100).toFixed(2))
              : null,
          orders: summary.orders,
          revenue: Number(summary.revenue.toFixed(2)),
          averageOrderValue:
            summary.orders > 0 ? Number((summary.revenue / summary.orders).toFixed(2)) : 0,
          averageRevenuePerCustomer:
            summary.customers > 0 ? Number((summary.revenue / summary.customers).toFixed(2)) : 0,
        },
        points,
      };

      return applyMasking(payload, userLevel, role);
    });
  }

  async getCustomersTrendRecords(
    tenantId: string,
    filters: RevenueTrendQueryDto,
    role: string,
    userLevel: string,
  ) {
    const {
      range = 'ALL',
      from,
      to,
      status = '',
      invoice,
      paymentMethod,
      channel,
      platform,
      page = 1,
      limit = 20,
    } = filters;

    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const invoiceScope = normalizeInvoiceScope(invoice);
    const paymentMethodFilter = normalizePaymentMethodFilter(paymentMethod);
    const channelFilter = normalizeSalesChannelFilter(channel);
    const platformFilter = normalizePlatformFilter(platform);
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 20));
    const offset = (safePage - 1) * safeLimit;

    const key = [
      'jtl',
      tenantId,
      'analytics',
      'customers-trend-records',
      start,
      end,
      statusFilter,
      invoiceScope,
      paymentMethodFilter,
      channelFilter,
      platformFilter,
      safePage,
      safeLimit,
    ].join(':');

    return this.cache.getOrSet(key, 90, async () => {
      const baseCte = `
        WITH filtered_orders AS (
          SELECT
            o.*,
            COALESCE(
              NULLIF(TRIM(COALESCE(o.customer_number, '')), ''),
              NULLIF(o.customer_id::text, ''),
              'order:' || o.jtl_order_id::text
            ) AS customer_key
          FROM orders o
          WHERE o.tenant_id = $1
            AND o.order_date BETWEEN $2 AND $3
            AND ($4 = '' OR o.status = $4)
            AND ${invoicePredicate('o.payment_method', 5)}
            AND ${paymentMethodPredicate('o.payment_method', 6)}
            AND ${salesChannelPredicate('o.channel', 7)}
            AND ${platformPredicate('o.channel', 8)}
        )
      `;

      const baseParams = [
        tenantId,
        start,
        end,
        statusFilter,
        invoiceScope,
        paymentMethodFilter,
        channelFilter,
        platformFilter,
      ];

      const [rows, countRows] = await Promise.all([
        this.db.query(
          `
          ${baseCte}
          SELECT
            fo.customer_key,
            COALESCE(
              NULLIF(TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))), ''),
              NULLIF(TRIM(COALESCE(c.company, '')), ''),
              'Unknown Customer'
            ) AS customer_name,
            COALESCE(NULLIF(TRIM(c.email), ''), '-') AS email,
            COALESCE(NULLIF(TRIM(c.segment), ''), 'Unknown') AS segment,
            COALESCE(NULLIF(TRIM(c.country_code), ''), COALESCE(NULLIF(TRIM(fo.country), ''), 'Unknown')) AS country,
            COUNT(*)::int AS orders,
            COALESCE(SUM(fo.gross_revenue), 0)::numeric AS revenue,
            CASE WHEN COUNT(*) > 0 THEN ROUND((SUM(fo.gross_revenue) / COUNT(*))::numeric, 2) ELSE 0::numeric END AS average_order_value,
            MIN(fo.order_date)::date AS first_order_date,
            MAX(fo.order_date)::date AS last_order_date
          FROM filtered_orders fo
          LEFT JOIN customers c
            ON c.tenant_id = fo.tenant_id
           AND c.jtl_customer_id = fo.customer_id
          GROUP BY fo.customer_key, customer_name, email, segment, country
          ORDER BY revenue DESC, orders DESC, customer_name ASC
          LIMIT $9::int OFFSET $10::int
          `,
          [...baseParams, safeLimit, offset],
        ),
        this.db.query(
          `
          ${baseCte}
          SELECT COUNT(DISTINCT customer_key)::int AS total
          FROM filtered_orders
          `,
          baseParams,
        ),
      ]);

      const payload = {
        rows: rows.map((row: Record<string, unknown>) => ({
          customerKey: String(row.customer_key ?? ''),
          customerName: String(row.customer_name ?? 'Unknown Customer'),
          email: String(row.email ?? '-'),
          segment: String(row.segment ?? 'Unknown'),
          country: String(row.country ?? 'Unknown'),
          orders: parseCount(row.orders as string | number),
          revenue: parseAmount(row.revenue as string | number),
          averageOrderValue: parseAmount(
            row.average_order_value as string | number,
          ),
          firstOrderDate: String(row.first_order_date ?? '').slice(0, 10),
          lastOrderDate: String(row.last_order_date ?? '').slice(0, 10),
        })),
        total: parseCount(countRows[0]?.total as string | number),
        page: safePage,
        limit: safeLimit,
      };

      return applyMasking(payload, userLevel, role);
    });
  }

  async getActiveProductsTrend(
    tenantId: string,
    filters: RevenueTrendQueryDto,
    role: string,
    userLevel: string,
  ) {
    const {
      range = 'ALL',
      from,
      to,
      status = '',
      invoice,
      paymentMethod,
      channel,
      platform,
      granularity = 'year',
      compare = 'prior_year',
    } = filters;

    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const invoiceScope = normalizeInvoiceScope(invoice);
    const paymentMethodFilter = normalizePaymentMethodFilter(paymentMethod);
    const channelFilter = normalizeSalesChannelFilter(channel);
    const platformFilter = normalizePlatformFilter(platform);
    const compareMode: RevenueTrendCompare =
      compare === 'prior_year' ? 'prior_year' : 'none';
    const unit: RevenueTrendGranularity =
      granularity === 'day' || granularity === 'month' ? granularity : 'year';

    const key = [
      'jtl',
      tenantId,
      'analytics',
      'active-products-trend',
      start,
      end,
      unit,
      compareMode,
      statusFilter,
      invoiceScope,
      paymentMethodFilter,
      channelFilter,
      platformFilter,
    ].join(':');

    return this.cache.getOrSet(key, 120, async () => {
      const rows = (await this.db.query(
        `
        WITH series AS (
          SELECT
            gs::date AS period_start,
            CASE
              WHEN $4 = 'year' THEN (gs + INTERVAL '1 year - 1 day')::date
              WHEN $4 = 'month' THEN (gs + INTERVAL '1 month - 1 day')::date
              ELSE gs::date
            END AS period_end
          FROM generate_series(
            DATE_TRUNC($4, $2::date)::date,
            DATE_TRUNC($4, $3::date)::date,
            CASE
              WHEN $4 = 'year' THEN INTERVAL '1 year'
              WHEN $4 = 'month' THEN INTERVAL '1 month'
              ELSE INTERVAL '1 day'
            END
          ) AS gs
        ),
        current_data AS (
          SELECT
            DATE_TRUNC($4, o.order_date)::date AS period_start,
            COUNT(DISTINCT oi.product_id) FILTER (WHERE oi.product_id IS NOT NULL)::int AS active_products,
            COALESCE(SUM(COALESCE(oi.quantity, 0)), 0)::numeric AS units_sold,
            COALESCE(SUM(COALESCE(oi.line_total_gross, 0)), 0)::numeric AS revenue,
            COUNT(DISTINCT o.jtl_order_id)::int AS orders
          FROM orders o
          JOIN order_items oi
            ON oi.tenant_id = o.tenant_id
           AND oi.order_id = o.jtl_order_id
          WHERE o.tenant_id = $1
            AND o.order_date BETWEEN $2 AND $3
            AND ($5 = '' OR o.status = $5)
            AND ${invoicePredicate('o.payment_method', 6)}
            AND ${paymentMethodPredicate('o.payment_method', 7)}
            AND ${salesChannelPredicate('o.channel', 8)}
            AND ${platformPredicate('o.channel', 9)}
          GROUP BY 1
        ),
        prior_aligned AS (
          SELECT
            DATE_TRUNC($4, o.order_date + INTERVAL '1 year')::date AS period_start,
            COUNT(DISTINCT oi.product_id) FILTER (WHERE oi.product_id IS NOT NULL)::int AS prior_active_products
          FROM orders o
          JOIN order_items oi
            ON oi.tenant_id = o.tenant_id
           AND oi.order_id = o.jtl_order_id
          WHERE o.tenant_id = $1
            AND o.order_date BETWEEN ($2::date - INTERVAL '1 year') AND ($3::date - INTERVAL '1 year')
            AND ($5 = '' OR o.status = $5)
            AND ${invoicePredicate('o.payment_method', 6)}
            AND ${paymentMethodPredicate('o.payment_method', 7)}
            AND ${salesChannelPredicate('o.channel', 8)}
            AND ${platformPredicate('o.channel', 9)}
          GROUP BY 1
        ),
        merged AS (
          SELECT
            s.period_start,
            LEAST(s.period_end, $3::date) AS period_end,
            COALESCE(c.active_products, 0)::int AS active_products,
            CASE WHEN $10 = 'prior_year' THEN COALESCE(p.prior_active_products, 0)::int ELSE 0::int END AS prior_active_products,
            COALESCE(c.units_sold, 0)::numeric AS units_sold,
            COALESCE(c.revenue, 0)::numeric AS revenue,
            COALESCE(c.orders, 0)::int AS orders
          FROM series s
          LEFT JOIN current_data c ON c.period_start = s.period_start
          LEFT JOIN prior_aligned p ON p.period_start = s.period_start
        )
        SELECT
          period_start,
          period_end,
          active_products,
          prior_active_products,
          units_sold,
          revenue,
          orders,
          CASE
            WHEN active_products > 0 THEN ROUND((revenue / active_products)::numeric, 2)
            ELSE 0::numeric
          END AS avg_revenue_per_active_product,
          CASE
            WHEN $10 <> 'prior_year' THEN NULL
            WHEN prior_active_products = 0 THEN NULL
            ELSE ROUND(((active_products - prior_active_products)::numeric / prior_active_products::numeric * 100)::numeric, 2)
          END AS change_percent
        FROM merged
        ORDER BY period_start ASC
        `,
        [
          tenantId,
          start,
          end,
          unit,
          statusFilter,
          invoiceScope,
          paymentMethodFilter,
          channelFilter,
          platformFilter,
          compareMode,
        ],
      )) as ActiveProductsTrendRow[];

      const points = rows.map((row) => {
        const periodStart = toDateOnly(row.period_start);
        const periodEnd = toDateOnly(row.period_end);
        return {
          periodStart,
          periodEnd,
          label: labelForPeriod(unit, periodStart),
          activeProducts: parseCount(row.active_products),
          priorActiveProducts: parseCount(row.prior_active_products),
          changePercent:
            row.change_percent == null ? null : parseAmount(row.change_percent),
          unitsSold: parseAmount(row.units_sold),
          revenue: parseAmount(row.revenue),
          orders: parseCount(row.orders),
          averageRevenuePerActiveProduct: parseAmount(
            row.avg_revenue_per_active_product,
          ),
        };
      });

      const summary = points.reduce(
        (acc, point) => {
          acc.activeProducts += point.activeProducts;
          acc.priorActiveProducts += point.priorActiveProducts;
          acc.unitsSold += point.unitsSold;
          acc.revenue += point.revenue;
          acc.orders += point.orders;
          return acc;
        },
        {
          activeProducts: 0,
          priorActiveProducts: 0,
          unitsSold: 0,
          revenue: 0,
          orders: 0,
        },
      );

      const payload = {
        granularity: unit,
        range: {
          from: start,
          to: end,
        },
        summary: {
          activeProducts: summary.activeProducts,
          priorActiveProducts: summary.priorActiveProducts,
          changePercent:
            compareMode === 'prior_year' && summary.priorActiveProducts > 0
              ? Number(
                  (
                    ((summary.activeProducts - summary.priorActiveProducts) /
                      summary.priorActiveProducts) *
                    100
                  ).toFixed(2),
                )
              : null,
          unitsSold: Number(summary.unitsSold.toFixed(2)),
          revenue: Number(summary.revenue.toFixed(2)),
          orders: summary.orders,
          averageRevenuePerActiveProduct:
            summary.activeProducts > 0
              ? Number((summary.revenue / summary.activeProducts).toFixed(2))
              : 0,
        },
        points,
      };

      return applyMasking(payload, userLevel, role);
    });
  }

  async getCancelledTrend(
    tenantId: string,
    filters: RevenueTrendQueryDto,
    role: string,
    userLevel: string,
  ) {
    const {
      range = 'ALL',
      from,
      to,
      status = '',
      invoice,
      paymentMethod,
      channel,
      platform,
      orderNumber = '',
      sku = '',
      granularity = 'year',
      compare = 'prior_year',
    } = filters;

    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const invoiceScope = normalizeInvoiceScope(invoice);
    const paymentMethodFilter = normalizePaymentMethodFilter(paymentMethod);
    const channelFilter = normalizeSalesChannelFilter(channel);
    const platformFilter = normalizePlatformFilter(platform);
    const orderFilter = String(orderNumber || '').trim();
    const skuFilter = String(sku || '').trim();
    const compareMode: RevenueTrendCompare =
      compare === 'prior_year' ? 'prior_year' : 'none';
    const unit: RevenueTrendGranularity =
      granularity === 'day' || granularity === 'month' ? granularity : 'year';

    const key = [
      'jtl',
      tenantId,
      'analytics',
      'cancelled-trend',
      start,
      end,
      unit,
      compareMode,
      statusFilter,
      invoiceScope,
      paymentMethodFilter,
      channelFilter,
      platformFilter,
      orderFilter,
      skuFilter,
    ].join(':');

    return this.cache.getOrSet(key, 120, async () => {
      const rows = (await this.db.query(
        `
        WITH series AS (
          SELECT
            gs::date AS period_start,
            CASE
              WHEN $4 = 'year' THEN (gs + INTERVAL '1 year - 1 day')::date
              WHEN $4 = 'month' THEN (gs + INTERVAL '1 month - 1 day')::date
              ELSE gs::date
            END AS period_end
          FROM generate_series(
            DATE_TRUNC($4, $2::date)::date,
            DATE_TRUNC($4, $3::date)::date,
            CASE
              WHEN $4 = 'year' THEN INTERVAL '1 year'
              WHEN $4 = 'month' THEN INTERVAL '1 month'
              ELSE INTERVAL '1 day'
            END
          ) AS gs
        ),
        current_data AS (
          SELECT
            DATE_TRUNC($4, o.order_date)::date AS period_start,
            COUNT(*)::int AS total_orders,
            COUNT(*) FILTER (WHERE ${normalizedStatusExpr('o.status')} = 'cancelled')::int AS cancelled_orders,
            COALESCE(SUM(o.gross_revenue) FILTER (WHERE ${normalizedStatusExpr('o.status')} = 'cancelled'), 0)::numeric AS cancelled_revenue
          FROM orders o
          WHERE o.tenant_id = $1
            AND o.order_date BETWEEN $2 AND $3
            AND ($5 = '' OR ${normalizedStatusExpr('o.status')} = LOWER(TRIM($5)))
            AND ${invoicePredicate('o.payment_method', 6)}
            AND ${paymentMethodPredicate('o.payment_method', 7)}
            AND ${salesChannelPredicate('o.channel', 8)}
            AND ${platformPredicate('o.channel', 9)}
            AND ($11 = '' OR o.order_number ILIKE '%' || $11 || '%' OR o.external_order_number ILIKE '%' || $11 || '%')
            AND ($12 = '' OR EXISTS (
              SELECT 1
              FROM order_items oi
              LEFT JOIN products p ON p.tenant_id = oi.tenant_id AND p.jtl_product_id = oi.product_id
              WHERE oi.tenant_id = o.tenant_id
                AND oi.order_id = o.jtl_order_id
                AND p.article_number ILIKE '%' || $12 || '%'
            ))
          GROUP BY 1
        ),
        prior_aligned AS (
          SELECT
            DATE_TRUNC($4, o.order_date + INTERVAL '1 year')::date AS period_start,
            COUNT(*) FILTER (WHERE ${normalizedStatusExpr('o.status')} = 'cancelled')::int AS prior_cancelled_orders,
            COALESCE(SUM(o.gross_revenue) FILTER (WHERE ${normalizedStatusExpr('o.status')} = 'cancelled'), 0)::numeric AS prior_cancelled_revenue
          FROM orders o
          WHERE o.tenant_id = $1
            AND o.order_date BETWEEN ($2::date - INTERVAL '1 year') AND ($3::date - INTERVAL '1 year')
            AND ($5 = '' OR ${normalizedStatusExpr('o.status')} = LOWER(TRIM($5)))
            AND ${invoicePredicate('o.payment_method', 6)}
            AND ${paymentMethodPredicate('o.payment_method', 7)}
            AND ${salesChannelPredicate('o.channel', 8)}
            AND ${platformPredicate('o.channel', 9)}
            AND ($11 = '' OR o.order_number ILIKE '%' || $11 || '%' OR o.external_order_number ILIKE '%' || $11 || '%')
            AND ($12 = '' OR EXISTS (
              SELECT 1
              FROM order_items oi
              LEFT JOIN products p ON p.tenant_id = oi.tenant_id AND p.jtl_product_id = oi.product_id
              WHERE oi.tenant_id = o.tenant_id
                AND oi.order_id = o.jtl_order_id
                AND p.article_number ILIKE '%' || $12 || '%'
            ))
          GROUP BY 1
        ),
        merged AS (
          SELECT
            s.period_start,
            LEAST(s.period_end, $3::date) AS period_end,
            COALESCE(c.total_orders, 0)::int AS total_orders,
            COALESCE(c.cancelled_orders, 0)::int AS cancelled_orders,
            COALESCE(c.cancelled_revenue, 0)::numeric AS cancelled_revenue,
            CASE WHEN $10 = 'prior_year' THEN COALESCE(p.prior_cancelled_orders, 0)::int ELSE 0::int END AS prior_cancelled_orders,
            CASE WHEN $10 = 'prior_year' THEN COALESCE(p.prior_cancelled_revenue, 0)::numeric ELSE 0::numeric END AS prior_cancelled_revenue
          FROM series s
          LEFT JOIN current_data c ON c.period_start = s.period_start
          LEFT JOIN prior_aligned p ON p.period_start = s.period_start
        )
        SELECT
          period_start,
          period_end,
          total_orders,
          cancelled_orders,
          prior_cancelled_orders,
          cancelled_revenue,
          prior_cancelled_revenue,
          CASE
            WHEN $10 <> 'prior_year' THEN NULL
            WHEN prior_cancelled_orders = 0 THEN NULL
            ELSE ROUND(((cancelled_orders - prior_cancelled_orders)::numeric / prior_cancelled_orders::numeric * 100)::numeric, 2)
          END AS change_percent
        FROM merged
        ORDER BY period_start ASC
        `,
        [
          tenantId,
          start,
          end,
          unit,
          statusFilter,
          invoiceScope,
          paymentMethodFilter,
          channelFilter,
          platformFilter,
          compareMode,
          orderFilter,
          skuFilter,
        ],
      )) as CancelledTrendRow[];

      const cancelledBaseCte = `
        WITH filtered_cancelled AS (
          SELECT o.*
          FROM orders o
          WHERE o.tenant_id = $1
            AND o.order_date BETWEEN $2 AND $3
            AND ($4 = '' OR ${normalizedStatusExpr('o.status')} = LOWER(TRIM($4)))
            AND ${invoicePredicate('o.payment_method', 5)}
            AND ${paymentMethodPredicate('o.payment_method', 6)}
            AND ${salesChannelPredicate('o.channel', 7)}
            AND ${platformPredicate('o.channel', 8)}
            AND ($9 = '' OR o.order_number ILIKE '%' || $9 || '%' OR o.external_order_number ILIKE '%' || $9 || '%')
            AND ($10 = '' OR EXISTS (
              SELECT 1
              FROM order_items oi
              LEFT JOIN products p ON p.tenant_id = oi.tenant_id AND p.jtl_product_id = oi.product_id
              WHERE oi.tenant_id = o.tenant_id
                AND oi.order_id = o.jtl_order_id
                AND p.article_number ILIKE '%' || $10 || '%'
            ))
            AND ${normalizedStatusExpr('o.status')} = 'cancelled'
        ),
        totals AS (
          SELECT COUNT(*)::numeric AS total_cancelled FROM filtered_cancelled
        )
      `;
      const cancelledBaseParams = [
        tenantId,
        start,
        end,
        statusFilter,
        invoiceScope,
        paymentMethodFilter,
        channelFilter,
        platformFilter,
        orderFilter,
        skuFilter,
      ];

      const [reasonRows, platformRows, channelRows, paymentRows, shippingRows, countryRows, skuRows] = await Promise.all([
        this.db.query(
          `
          ${cancelledBaseCte}
          SELECT
            reason_label AS label,
            COUNT(*)::int AS cancelled_orders,
            COALESCE(SUM(gross_revenue), 0)::numeric AS cancelled_revenue,
            CASE WHEN totals.total_cancelled > 0 THEN ROUND((COUNT(*)::numeric / totals.total_cancelled) * 100, 2) ELSE 0 END::numeric AS share_pct
          FROM (
            SELECT
              CASE
                WHEN LOWER(TRIM(COALESCE(status, ''))) ~ '(fraud|chargeback|risk)' THEN 'Fraud / Risk'
                WHEN LOWER(TRIM(COALESCE(status, ''))) ~ '(payment|zahl|invoice|rechnung|unpaid)' OR LOWER(TRIM(COALESCE(payment_method, ''))) LIKE '%invoice%' THEN 'Payment Issue'
                WHEN LOWER(TRIM(COALESCE(status, ''))) ~ '(stock|out.?of.?stock|lager)' THEN 'Stock Unavailable'
                WHEN LOWER(TRIM(COALESCE(status, ''))) ~ '(address|undeliverable|invalid)' THEN 'Address / Delivery Issue'
                WHEN LOWER(TRIM(COALESCE(status, ''))) ~ '(duplicate|test)' THEN 'Duplicate / Test'
                ELSE 'Unspecified'
              END AS reason_label,
              gross_revenue
            FROM filtered_cancelled
          ) x
          CROSS JOIN totals
          GROUP BY reason_label, totals.total_cancelled
          ORDER BY cancelled_orders DESC, cancelled_revenue DESC
          LIMIT 8
          `,
          cancelledBaseParams,
        ),
        this.db.query(
          `
          ${cancelledBaseCte}
          SELECT
            ${platformLabelExpr('channel')} AS label,
            COUNT(*)::int AS cancelled_orders,
            COALESCE(SUM(gross_revenue), 0)::numeric AS cancelled_revenue,
            CASE WHEN totals.total_cancelled > 0 THEN ROUND((COUNT(*)::numeric / totals.total_cancelled) * 100, 2) ELSE 0 END::numeric AS share_pct
          FROM filtered_cancelled
          CROSS JOIN totals
          GROUP BY label, totals.total_cancelled
          ORDER BY cancelled_orders DESC, cancelled_revenue DESC
          LIMIT 8
          `,
          cancelledBaseParams,
        ),
        this.db.query(
          `
          ${cancelledBaseCte}
          SELECT
            ${salesChannelLabelExpr('channel')} AS label,
            COUNT(*)::int AS cancelled_orders,
            COALESCE(SUM(gross_revenue), 0)::numeric AS cancelled_revenue,
            CASE WHEN totals.total_cancelled > 0 THEN ROUND((COUNT(*)::numeric / totals.total_cancelled) * 100, 2) ELSE 0 END::numeric AS share_pct
          FROM filtered_cancelled
          CROSS JOIN totals
          GROUP BY label, totals.total_cancelled
          ORDER BY cancelled_orders DESC, cancelled_revenue DESC
          LIMIT 8
          `,
          cancelledBaseParams,
        ),
        this.db.query(
          `
          ${cancelledBaseCte}
          SELECT
            ${paymentMethodLabelExpr('payment_method')} AS label,
            COUNT(*)::int AS cancelled_orders,
            COALESCE(SUM(gross_revenue), 0)::numeric AS cancelled_revenue,
            CASE WHEN totals.total_cancelled > 0 THEN ROUND((COUNT(*)::numeric / totals.total_cancelled) * 100, 2) ELSE 0 END::numeric AS share_pct
          FROM filtered_cancelled
          CROSS JOIN totals
          GROUP BY label, totals.total_cancelled
          ORDER BY cancelled_orders DESC, cancelled_revenue DESC
          LIMIT 8
          `,
          cancelledBaseParams,
        ),
        this.db.query(
          `
          ${cancelledBaseCte}
          SELECT
            CASE
              WHEN LOWER(TRIM(COALESCE(shipping_method, ''))) IN ('', 'unknown', 'n/a', '-') THEN 'Unknown'
              ELSE INITCAP(TRIM(shipping_method))
            END AS label,
            COUNT(*)::int AS cancelled_orders,
            COALESCE(SUM(gross_revenue), 0)::numeric AS cancelled_revenue,
            CASE WHEN totals.total_cancelled > 0 THEN ROUND((COUNT(*)::numeric / totals.total_cancelled) * 100, 2) ELSE 0 END::numeric AS share_pct
          FROM filtered_cancelled
          CROSS JOIN totals
          GROUP BY label, totals.total_cancelled
          ORDER BY cancelled_orders DESC, cancelled_revenue DESC
          LIMIT 8
          `,
          cancelledBaseParams,
        ),
        this.db.query(
          `
          ${cancelledBaseCte}
          SELECT
            CASE
              WHEN LOWER(TRIM(COALESCE(country, ''))) IN ('', 'unknown', 'n/a', '-') THEN 'Unknown'
              ELSE INITCAP(TRIM(country))
            END AS label,
            COUNT(*)::int AS cancelled_orders,
            COALESCE(SUM(gross_revenue), 0)::numeric AS cancelled_revenue,
            CASE WHEN totals.total_cancelled > 0 THEN ROUND((COUNT(*)::numeric / totals.total_cancelled) * 100, 2) ELSE 0 END::numeric AS share_pct
          FROM filtered_cancelled
          CROSS JOIN totals
          GROUP BY label, totals.total_cancelled
          ORDER BY cancelled_orders DESC, cancelled_revenue DESC
          LIMIT 8
          `,
          cancelledBaseParams,
        ),
        this.db.query(
          `
          ${cancelledBaseCte}
          SELECT
            COALESCE(NULLIF(TRIM(p.article_number), ''), 'Unknown SKU') AS label,
            COUNT(DISTINCT fc.jtl_order_id)::int AS cancelled_orders,
            COALESCE(SUM(COALESCE(oi.line_total_gross, oi.quantity * oi.unit_price_gross, 0)), 0)::numeric AS cancelled_revenue,
            CASE
              WHEN totals.total_cancelled > 0
                THEN ROUND((COUNT(DISTINCT fc.jtl_order_id)::numeric / totals.total_cancelled) * 100, 2)
              ELSE 0
            END::numeric AS share_pct
          FROM filtered_cancelled fc
          JOIN order_items oi
            ON oi.tenant_id = fc.tenant_id
           AND oi.order_id = fc.jtl_order_id
          LEFT JOIN products p
            ON p.tenant_id = oi.tenant_id
           AND p.jtl_product_id = oi.product_id
          CROSS JOIN totals
          GROUP BY label, totals.total_cancelled
          ORDER BY cancelled_orders DESC, cancelled_revenue DESC
          LIMIT 8
          `,
          cancelledBaseParams,
        ),
      ]);

      const mapInsightRows = (rowsIn: unknown[]): Array<{ label: string; cancelledOrders: number; cancelledRevenue: number; sharePct: number }> => {
        return (rowsIn as CancelledInsightRow[]).map((row) => ({
          label: String(row.label || 'Unknown'),
          cancelledOrders: parseCount(row.cancelled_orders),
          cancelledRevenue: parseAmount(row.cancelled_revenue),
          sharePct: parseAmount(row.share_pct),
        }));
      };

      const points = rows.map((row) => {
        const periodStart = toDateOnly(row.period_start);
        const periodEnd = toDateOnly(row.period_end);
        const totalOrders = parseCount(row.total_orders);
        const cancelledOrders = parseCount(row.cancelled_orders);
        const cancellationRate =
          totalOrders > 0
            ? Number(((cancelledOrders / totalOrders) * 100).toFixed(2))
            : 0;
        return {
          periodStart,
          periodEnd,
          label: labelForPeriod(unit, periodStart),
          totalOrders,
          cancelledOrders,
          priorCancelledOrders: parseCount(row.prior_cancelled_orders),
          cancelledRevenue: parseAmount(row.cancelled_revenue),
          priorCancelledRevenue: parseAmount(row.prior_cancelled_revenue),
          changePercent:
            row.change_percent == null ? null : parseAmount(row.change_percent),
          cancellationRate,
        };
      });

      const summary = points.reduce(
        (acc, point) => {
          acc.totalOrders += point.totalOrders;
          acc.cancelledOrders += point.cancelledOrders;
          acc.priorCancelledOrders += point.priorCancelledOrders;
          acc.cancelledRevenue += point.cancelledRevenue;
          acc.priorCancelledRevenue += point.priorCancelledRevenue;
          return acc;
        },
        {
          totalOrders: 0,
          cancelledOrders: 0,
          priorCancelledOrders: 0,
          cancelledRevenue: 0,
          priorCancelledRevenue: 0,
        },
      );

      const payload = {
        granularity: unit,
        range: {
          from: start,
          to: end,
        },
        summary: {
          totalOrders: summary.totalOrders,
          cancelledOrders: summary.cancelledOrders,
          priorCancelledOrders: summary.priorCancelledOrders,
          cancelledRevenue: Number(summary.cancelledRevenue.toFixed(2)),
          priorCancelledRevenue: Number(
            summary.priorCancelledRevenue.toFixed(2),
          ),
          changePercent:
            compareMode === 'prior_year' && summary.priorCancelledOrders > 0
              ? Number(
                  (
                    ((summary.cancelledOrders - summary.priorCancelledOrders) /
                      summary.priorCancelledOrders) *
                    100
                  ).toFixed(2),
                )
              : null,
          cancellationRate:
            summary.totalOrders > 0
              ? Number(
                  (
                    (summary.cancelledOrders / summary.totalOrders) *
                    100
                  ).toFixed(2),
                )
              : 0,
        },
        points,
        reasonBreakdown: mapInsightRows(reasonRows),
        topRiskSegments: {
          platforms: mapInsightRows(platformRows),
          channels: mapInsightRows(channelRows),
          paymentMethods: mapInsightRows(paymentRows),
          shippingMethods: mapInsightRows(shippingRows),
          countries: mapInsightRows(countryRows),
          skus: mapInsightRows(skuRows),
        },
      };

      return applyMasking(payload, userLevel, role);
    });
  }
}
