import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService } from '../../cache/cache.service';
import { applyMasking } from '../../common/utils/masking';
import { buildPaginatedResult } from '../../common/utils/pagination';

type SalesFilters = {
  range?: string;
  from?: string;
  to?: string;
  platform?: string;
  channel?: string;
  locationDimension?: string;
  location?: string;
  orderNumber?: string;
  sku?: string;
  status?: string;
  invoice?: string;
  paymentMethod?: string;
  page?: string | number;
  limit?: string | number;
};

type RevenueRow = Record<string, unknown>;
type RegionalRow = {
  region_name: string;
  revenue: string;
  orders: string;
  customers?: string;
  cancelled_orders?: string;
  returned_orders?: string;
};
type CityRow = { city: string; country: string; orders: string; revenue: string };
type LocationInsightRow = {
  location_label: string;
  orders: string;
  good_orders: string;
  bad_orders: string;
  revenue: string;
  avg_order_value: string;
};
type PlatformMixRow = {
  platform: string;
  orders: string;
  good_orders: string;
  bad_orders: string;
  revenue: string;
  avg_order_value: string;
};
type ProductDemandRow = {
  product_id: string;
  product_name: string;
  sku: string;
  quantity: string;
  orders: string;
  revenue: string;
};
type ProductRouteRow = {
  platform: string;
  shipping_method: string;
  orders: string;
  quantity: string;
  revenue: string;
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

  if (range === 'TODAY') {
    return { start: todayStr, end: todayStr };
  }
  if (range === 'DAY') {
    return { start: todayStr, end: todayStr };
  }
  if (range === 'YESTERDAY') {
    const y = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
    return { start: y, end: y };
  }
  if (range === 'MONTH') {
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
    return { start: startOfMonth, end };
  }
  if (range === 'YEAR') {
    return { start: `${now.getUTCFullYear()}-01-01`, end };
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

type InvoiceScope = 'all' | 'with_invoice' | 'without_invoice';

function normalizeInvoiceScope(value?: string): InvoiceScope {
  const normalized = String(value || '').trim().toLowerCase();
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
  const v = String(value || '').trim();
  if (!v || v.toLowerCase() === 'all') return '';
  return v;
}

function paymentMethodPredicate(column: string, paramIndex: number): string {
  return `(
    $${paramIndex} = ''
    OR ${paymentMethodLabelExpr(column)} = $${paramIndex}
  )`;
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
  const v = String(value || '').trim();
  if (!v || v.toLowerCase() === 'all') return '';
  return v;
}

function salesChannelPredicate(column: string, paramIndex: number): string {
  return `(
    $${paramIndex} = ''
    OR ${salesChannelLabelExpr(column)} = $${paramIndex}
  )`;
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
  const v = String(value || '').trim();
  if (!v || v.toLowerCase() === 'all') return '';
  return v;
}

function platformPredicate(column: string, paramIndex: number): string {
  return `(
    $${paramIndex} = ''
    OR ${platformLabelExpr(column)} = $${paramIndex}
  )`;
}

function shippingMethodLabelExpr(column = 'shipping_method'): string {
  return `
    CASE
      WHEN LOWER(TRIM(COALESCE(${column}, ''))) IN ('', 'unknown', 'n/a', '-') THEN 'Unknown'
      WHEN LOWER(TRIM(${column})) LIKE '%dhl%' THEN 'DHL'
      WHEN LOWER(TRIM(${column})) LIKE '%dpd%' THEN 'DPD'
      WHEN LOWER(TRIM(${column})) LIKE '%ups%' THEN 'UPS'
      WHEN LOWER(TRIM(${column})) LIKE '%hermes%' THEN 'Hermes'
      WHEN LOWER(TRIM(${column})) LIKE '%fedex%' THEN 'FedEx'
      WHEN LOWER(TRIM(${column})) LIKE '%pickup%' OR LOWER(TRIM(${column})) LIKE '%abholung%' THEN 'Pickup'
      ELSE INITCAP(TRIM(${column}))
    END
  `;
}

type LocationDimension = 'region' | 'city' | 'country';

function normalizeLocationDimension(value?: string): LocationDimension {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'city') return 'city';
  if (v === 'country') return 'country';
  return 'region';
}

function normalizeLocationFilter(value?: string): string {
  const v = String(value || '').trim();
  if (!v || v.toLowerCase() === 'all') return '';
  return v;
}

function locationColumnForDimension(dim: LocationDimension): string {
  if (dim === 'city') return 'city';
  if (dim === 'country') return 'country';
  return 'region';
}

function locationLabelExpr(column: string): string {
  return `COALESCE(NULLIF(TRIM(${column}), ''), 'Unknown')`;
}

function locationPredicate(column: string, paramIndex: number): string {
  return `(
    $${paramIndex} = ''
    OR ${locationLabelExpr(column)} = $${paramIndex}
  )`;
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
    const { range = 'ALL', from, to, status = '', invoice, paymentMethod, channel, platform } = filters;
    const { start, end } = dateRange(range, from, to);
    const { prevStart, prevEnd } = prevPeriod(start, end);
    const statusFilter = String(status).trim();
    const invoiceScope = normalizeInvoiceScope(invoice);
    const paymentMethodFilter = normalizePaymentMethodFilter(paymentMethod);
    const channelFilter = normalizeSalesChannelFilter(channel);
    const platformFilter = normalizePlatformFilter(platform);
    const key = `jtl:${tenantId}:sales:kpis:${range}:${start}:${end}:${statusFilter}:${invoiceScope}:${paymentMethodFilter}:${channelFilter}:${platformFilter}`;
    return this.cache.getOrSet(key, 60, async () => {

      if (statusFilter || invoiceScope !== 'all' || paymentMethodFilter || channelFilter || platformFilter) {
        // Status/invoice/payment/channel filter specified — query orders table directly, bypass matview
        const kpiSql = `
          SELECT
            COALESCE(SUM(gross_revenue), 0)                                           AS total_revenue,
            COUNT(*)                                                                   AS total_orders,
            COALESCE(ROUND(AVG(gross_revenue)::numeric, 2), 0)                       AS avg_order_value,
            COUNT(*) FILTER (WHERE status = 'returned')::int                           AS total_returns,
            COALESCE(
              ROUND((COUNT(*) FILTER (WHERE status = 'returned'))::numeric / NULLIF(COUNT(*), 0) * 100, 2),
              0
            )                                                                          AS return_rate
          FROM orders
          WHERE tenant_id = $1 AND order_date BETWEEN $2 AND $3
            AND ($4 = '' OR status = $4)
            AND ${invoicePredicate('payment_method', 5)}
            AND ${paymentMethodPredicate('payment_method', 6)}
            AND ${salesChannelPredicate('channel', 7)}
            AND ${platformPredicate('channel', 8)}`;
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
              AND ($4 = '' OR o.status = $4)
              AND ${invoicePredicate('o.payment_method', 5)}
              AND ${paymentMethodPredicate('o.payment_method', 6)}
              AND ${salesChannelPredicate('o.channel', 7)}
              AND ${platformPredicate('o.channel', 8)}
              AND oi.unit_price_net > 0
          ),
          order_margin AS (
            SELECT AVG(NULLIF(o.gross_margin, 0)) AS v
            FROM orders o
            WHERE o.tenant_id = $1 AND o.order_date BETWEEN $2 AND $3
              AND ($4 = '' OR o.status = $4)
              AND ${invoicePredicate('o.payment_method', 5)}
              AND ${paymentMethodPredicate('o.payment_method', 6)}
              AND ${salesChannelPredicate('o.channel', 7)}
              AND ${platformPredicate('o.channel', 8)}
          )
          SELECT ROUND(COALESCE(NULLIF((SELECT v FROM item_margin), 0), NULLIF((SELECT v FROM order_margin), 0), 0)::numeric, 2) AS avg_margin`;
        const statusSql = `
          SELECT
            COUNT(*) FILTER (WHERE status = 'cancelled')::int  AS cancelled_orders,
            COALESCE(SUM(gross_revenue) FILTER (WHERE status = 'cancelled'), 0) AS cancelled_revenue,
            COUNT(*) FILTER (WHERE status = 'returned')::int   AS returned_orders,
            COALESCE(SUM(gross_revenue) FILTER (WHERE status = 'returned'), 0)  AS returned_revenue
          FROM orders
          WHERE tenant_id = $1 AND order_date BETWEEN $2 AND $3
            AND ($4 = '' OR status = $4)
            AND ${invoicePredicate('payment_method', 5)}
            AND ${paymentMethodPredicate('payment_method', 6)}
            AND ${salesChannelPredicate('channel', 7)}
            AND ${platformPredicate('channel', 8)}`;

        const [kpiRow, prevKpiRow, marginRow, prevMarginRow, statusRow] = await Promise.all([
          this.db.query(kpiSql,    [tenantId, start,     end,     statusFilter, invoiceScope, paymentMethodFilter, channelFilter, platformFilter]),
          this.db.query(kpiSql,    [tenantId, prevStart, prevEnd, statusFilter, invoiceScope, paymentMethodFilter, channelFilter, platformFilter]),
          this.db.query(marginSql, [tenantId, start,     end,     statusFilter, invoiceScope, paymentMethodFilter, channelFilter, platformFilter]),
          this.db.query(marginSql, [tenantId, prevStart, prevEnd, statusFilter, invoiceScope, paymentMethodFilter, channelFilter, platformFilter]),
          this.db.query(statusSql, [tenantId, start,     end,     statusFilter, invoiceScope, paymentMethodFilter, channelFilter, platformFilter]),
        ]);
        const cur = kpiRow[0] || {};
        const prev = prevKpiRow[0] || {};
        const stat = statusRow[0] || {};
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
          cancelled_orders:  parseInt(stat.cancelled_orders, 10) || 0,
          cancelled_revenue: parseFloat(stat.cancelled_revenue) || 0,
          returned_orders:   parseInt(stat.returned_orders, 10) || 0,
          returned_revenue:  parseFloat(stat.returned_revenue) || 0,
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
    const { range = 'ALL', from, to, status = '', invoice, paymentMethod, channel, platform } = filters;
    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const invoiceScope = normalizeInvoiceScope(invoice);
    const paymentMethodFilter = normalizePaymentMethodFilter(paymentMethod);
    const channelFilter = normalizeSalesChannelFilter(channel);
    const platformFilter = normalizePlatformFilter(platform);
    const key = `jtl:${tenantId}:sales:revenue:${range}:${start}:${end}:${statusFilter}:${invoiceScope}:${paymentMethodFilter}:${channelFilter}:${platformFilter}`;
    return this.cache.getOrSet(key, 900, async () => {
      if (statusFilter || invoiceScope !== 'all' || paymentMethodFilter || channelFilter || platformFilter) {
        const rows = await this.db.query(
          `SELECT DATE_TRUNC('month', order_date)::date AS year_month,
                  COALESCE(SUM(gross_revenue), 0)                       AS total_revenue,
                  COUNT(*)                                               AS total_orders,
                  COALESCE(ROUND(AVG(gross_revenue)::numeric, 2), 0)    AS avg_order_value,
                  0 AS avg_margin, 0 AS total_returns,
                  COUNT(DISTINCT customer_number)                        AS unique_customers
           FROM orders
           WHERE tenant_id = $1 AND order_date BETWEEN $2 AND $3
             AND ($4 = '' OR status = $4)
             AND ${invoicePredicate('payment_method', 5)}
             AND ${paymentMethodPredicate('payment_method', 6)}
             AND ${salesChannelPredicate('channel', 7)}
             AND ${platformPredicate('channel', 8)}
           GROUP BY year_month ORDER BY year_month LIMIT 1200`,
          [tenantId, start, end, statusFilter, invoiceScope, paymentMethodFilter, channelFilter, platformFilter],
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
    const { range = '30D', from, to, status = '', invoice, paymentMethod, channel, platform } = filters;
    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const invoiceScope = normalizeInvoiceScope(invoice);
    const paymentMethodFilter = normalizePaymentMethodFilter(paymentMethod);
    const channelFilter = normalizeSalesChannelFilter(channel);
    const platformFilter = normalizePlatformFilter(platform);
    const key = `jtl:${tenantId}:sales:daily:${range}:${start}:${end}:${statusFilter}:${invoiceScope}:${paymentMethodFilter}:${channelFilter}:${platformFilter}`;
    return this.cache.getOrSet(key, 300, async () => {
      const rows = await this.db.query(
        `
        SELECT
          order_date AS summary_date,
          COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS total_orders,
          COALESCE(SUM(gross_revenue) FILTER (WHERE status <> 'cancelled'), 0)::numeric AS total_revenue,
          COALESCE(ROUND(AVG(gross_revenue) FILTER (WHERE status <> 'cancelled')::numeric, 2), 0)::numeric AS avg_order_value,
          COUNT(*) FILTER (WHERE status = 'returned')::int AS total_returns,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_orders,
          COALESCE(SUM(gross_revenue) FILTER (WHERE status = 'cancelled'), 0)::numeric AS cancelled_revenue
        FROM orders
        WHERE tenant_id = $1
          AND order_date BETWEEN $2 AND $3
          AND ($4 = '' OR status = $4)
          AND ${invoicePredicate('payment_method', 5)}
          AND ${paymentMethodPredicate('payment_method', 6)}
          AND ${salesChannelPredicate('channel', 7)}
          AND ${platformPredicate('channel', 8)}
        GROUP BY order_date
        ORDER BY order_date
        LIMIT 5000
        `,
        [tenantId, start, end, statusFilter, invoiceScope, paymentMethodFilter, channelFilter, platformFilter],
      );
      return applyMasking(rows as Record<string, unknown>[], userLevel, role);
    });
  }

  async getHeatmap(tenantId: string, filters: SalesFilters) {
    const { range = 'ALL', from, to, status = '', invoice, paymentMethod, channel, platform } = filters;
    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const invoiceScope = normalizeInvoiceScope(invoice);
    const paymentMethodFilter = normalizePaymentMethodFilter(paymentMethod);
    const channelFilter = normalizeSalesChannelFilter(channel);
    const platformFilter = normalizePlatformFilter(platform);
    const key = `jtl:${tenantId}:sales:heatmap:${range}:${start}:${end}:${statusFilter}:${invoiceScope}:${paymentMethodFilter}:${channelFilter}:${platformFilter}`;
    return this.cache.getOrSet(key, 1800, async () => {
      return this.db.query(
        `SELECT
           EXTRACT(DOW FROM order_date)::int AS day_of_week,
           EXTRACT(HOUR FROM jtl_modified_at)::int AS hour_of_day,
           COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS order_count,
           COALESCE(SUM(gross_revenue) FILTER (WHERE status <> 'cancelled'), 0)::numeric AS total_revenue
         FROM orders
         WHERE tenant_id = $1 AND order_date BETWEEN $2 AND $3
           AND ($4 = '' OR status = $4)
           AND ($4 <> '' OR status <> 'cancelled')
           AND ${invoicePredicate('payment_method', 5)}
           AND ${paymentMethodPredicate('payment_method', 6)}
           AND ${salesChannelPredicate('channel', 7)}
           AND ${platformPredicate('channel', 8)}
           AND jtl_modified_at IS NOT NULL
         GROUP BY day_of_week, hour_of_day
         ORDER BY day_of_week, hour_of_day`,
        [tenantId, start, end, statusFilter, invoiceScope, paymentMethodFilter, channelFilter, platformFilter],
      );
    });
  }

  async getOrders(tenantId: string, filters: SalesFilters) {
    const { range = '12M', from, to, orderNumber = '', sku = '', status = '', invoice, paymentMethod, channel, platform, page = 1, limit = 50 } = filters;
    const parsedLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    const parsedPage = Math.max(1, Number(page) || 1);
    const skuFilter    = String(sku).trim();
    const orderFilter  = String(orderNumber).trim();
    const statusFilter = String(status).trim();
    const invoiceScope = normalizeInvoiceScope(invoice);
    const paymentMethodFilter = normalizePaymentMethodFilter(paymentMethod);
    const channelFilter = normalizeSalesChannelFilter(channel);
    const platformFilter = normalizePlatformFilter(platform);
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
        AND ${invoicePredicate('o.payment_method', 8)}
        AND ${paymentMethodPredicate('o.payment_method', 9)}
        AND ${salesChannelPredicate('o.channel', 10)}
        AND ${platformPredicate('o.channel', 11)}
    `;
    const baseParams = [tenantId, start, end, orderFilter, skuFilter, skipDate, statusFilter, invoiceScope, paymentMethodFilter, channelFilter, platformFilter];
    // Keep pagination parameter slots derived from current filter count so
    // future filter additions cannot break LIMIT/OFFSET placeholder indices.
    const limitParamIndex = baseParams.length + 1;
    const offsetParamIndex = baseParams.length + 2;

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
        LIMIT $${limitParamIndex}::int OFFSET $${offsetParamIndex}::int
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
    const { range = '12M', from, to, status = '', invoice, paymentMethod, channel, platform } = filters;
    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const invoiceScope = normalizeInvoiceScope(invoice);
    const paymentMethodFilter = normalizePaymentMethodFilter(paymentMethod);
    const channelFilter = normalizeSalesChannelFilter(channel);
    const platformFilter = normalizePlatformFilter(platform);
    const key = `jtl:${tenantId}:sales:channels:${range}:${start}:${end}:${statusFilter}:${invoiceScope}:${paymentMethodFilter}:${channelFilter}:${platformFilter}`;
    return this.cache.getOrSet(key, 300, async () => {
      return this.db.query(
        `
        WITH normalized AS (
          SELECT
            ${salesChannelLabelExpr('channel')} AS channel_group,
            status,
            gross_revenue
          FROM orders
          WHERE tenant_id = $1
            AND order_date BETWEEN $2 AND $3
            AND ($4 = '' OR status = $4)
            AND ${invoicePredicate('payment_method', 5)}
            AND ${paymentMethodPredicate('payment_method', 6)}
            AND ${salesChannelPredicate('channel', 7)}
            AND ${platformPredicate('channel', 8)}
        )
        SELECT
          channel_group AS channel,
          COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS orders,
          COALESCE(SUM(gross_revenue) FILTER (WHERE status <> 'cancelled'), 0)::numeric AS revenue,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_orders,
          COALESCE(SUM(gross_revenue) FILTER (WHERE status = 'cancelled'), 0)::numeric AS cancelled_revenue,
          COUNT(*) FILTER (WHERE status = 'returned')::int AS returned_orders,
          COALESCE(SUM(gross_revenue) FILTER (WHERE status = 'returned'), 0)::numeric AS returned_revenue
        FROM normalized
        GROUP BY channel_group
        ORDER BY revenue DESC
        LIMIT 100
        `,
        [tenantId, start, end, statusFilter, invoiceScope, paymentMethodFilter, channelFilter, platformFilter],
      );
    });
  }

  async getRegional(tenantId: string, filters: SalesFilters) {
    const { range = '12M', from, to, invoice, paymentMethod, channel, platform, locationDimension, location } = filters;
    const { start, end } = dateRange(range, from, to);
    const invoiceScope = normalizeInvoiceScope(invoice);
    const paymentMethodFilter = normalizePaymentMethodFilter(paymentMethod);
    const channelFilter = normalizeSalesChannelFilter(channel);
    const platformFilter = normalizePlatformFilter(platform);
    const locationDimensionFilter = normalizeLocationDimension(locationDimension);
    const locationFilter = normalizeLocationFilter(location);
    const locationColumn = locationColumnForDimension(locationDimensionFilter);
    const key = `jtl:${tenantId}:sales:regional:${range}:${start}:${end}:${invoiceScope}:${paymentMethodFilter}:${channelFilter}:${platformFilter}:${locationDimensionFilter}:${locationFilter}`;
    return this.cache.getOrSet(key, 600, async () => {
      // Use true region labels; if region is missing, fall back to country, then Unknown.
      const regionExpr = `
        COALESCE(
          NULLIF(TRIM(region), ''),
          NULLIF(TRIM(country), ''),
          'Unknown'
        )`;
      const locationExpr = locationLabelExpr(locationColumn);

      const [
        cyRows,
        pyRows,
        cityRows,
        locationRows,
        platformRows,
        locationOptionsRows,
        topProductRows,
        leastProductRows,
      ] = await Promise.all([
        // Current period — revenue/orders/customers by region (net: excludes cancelled + returned)
        this.db.query(
          `SELECT ${regionExpr} AS region_name,
                  COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'returned'))::int                   AS orders,
                  COALESCE(SUM(gross_revenue) FILTER (WHERE status NOT IN ('cancelled', 'returned')), 0)::numeric AS revenue,
                  COUNT(DISTINCT customer_id) FILTER (WHERE status NOT IN ('cancelled', 'returned'))::int AS customers,
                  COUNT(*) FILTER (WHERE status = 'cancelled')::int   AS cancelled_orders,
                  COALESCE(SUM(gross_revenue) FILTER (WHERE status = 'cancelled'), 0)::numeric AS cancelled_revenue,
                  COUNT(*) FILTER (WHERE status = 'returned')::int    AS returned_orders,
                  COALESCE(SUM(gross_revenue) FILTER (WHERE status = 'returned'), 0)::numeric  AS returned_revenue
           FROM orders
           WHERE tenant_id=$1 AND order_date BETWEEN $2 AND $3
             AND ${invoicePredicate('payment_method', 4)}
             AND ${paymentMethodPredicate('payment_method', 5)}
             AND ${salesChannelPredicate('channel', 6)}
             AND ${platformPredicate('channel', 7)}
             AND ${locationPredicate(locationColumn, 8)}
           GROUP BY region_name ORDER BY revenue DESC`,
          [tenantId, start, end, invoiceScope, paymentMethodFilter, channelFilter, platformFilter, locationFilter],
        ),
        // Prior-year same window — for growth % (net: excludes cancelled + returned)
        this.db.query(
          `SELECT ${regionExpr} AS region_name,
                  COALESCE(SUM(gross_revenue) FILTER (WHERE status NOT IN ('cancelled', 'returned')), 0)::numeric AS revenue,
                  COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'returned'))::int AS orders
           FROM orders
           WHERE tenant_id=$1
             AND order_date BETWEEN $2::date - INTERVAL '1 year'
             AND $3::date - INTERVAL '1 year'
             AND ${invoicePredicate('payment_method', 4)}
             AND ${paymentMethodPredicate('payment_method', 5)}
             AND ${salesChannelPredicate('channel', 6)}
             AND ${platformPredicate('channel', 7)}
             AND ${locationPredicate(locationColumn, 8)}
           GROUP BY region_name`,
          [tenantId, start, end, invoiceScope, paymentMethodFilter, channelFilter, platformFilter, locationFilter],
        ),
        // Top cities (net: excludes cancelled + returned)
        this.db.query(
          `SELECT COALESCE(NULLIF(TRIM(city),''), 'Unknown') AS city,
                  COALESCE(NULLIF(TRIM(country),''), 'Unknown') AS country,
                  COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'returned'))::int AS orders,
                  COALESCE(SUM(gross_revenue) FILTER (WHERE status NOT IN ('cancelled', 'returned')), 0)::numeric AS revenue
           FROM orders
           WHERE tenant_id=$1 AND order_date BETWEEN $2 AND $3
             AND ${invoicePredicate('payment_method', 4)}
             AND ${paymentMethodPredicate('payment_method', 5)}
             AND ${salesChannelPredicate('channel', 6)}
             AND ${platformPredicate('channel', 7)}
             AND ${locationPredicate(locationColumn, 8)}
           GROUP BY city, country ORDER BY revenue DESC LIMIT 20`,
          [tenantId, start, end, invoiceScope, paymentMethodFilter, channelFilter, platformFilter, locationFilter],
        ),
        // Location-level quality and value summary by selected dimension.
        this.db.query(
          `SELECT
             ${locationExpr} AS location_label,
             COUNT(*)::int AS orders,
             COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'returned'))::int AS good_orders,
             COUNT(*) FILTER (WHERE status IN ('cancelled', 'returned'))::int AS bad_orders,
             COALESCE(SUM(gross_revenue) FILTER (WHERE status NOT IN ('cancelled', 'returned')), 0)::numeric AS revenue,
             COALESCE(ROUND(AVG(gross_revenue) FILTER (WHERE status NOT IN ('cancelled', 'returned'))::numeric, 2), 0)::numeric AS avg_order_value
           FROM orders
           WHERE tenant_id=$1 AND order_date BETWEEN $2 AND $3
             AND ${invoicePredicate('payment_method', 4)}
             AND ${paymentMethodPredicate('payment_method', 5)}
             AND ${salesChannelPredicate('channel', 6)}
             AND ${platformPredicate('channel', 7)}
             AND ${locationPredicate(locationColumn, 8)}
           GROUP BY location_label
           ORDER BY orders DESC, revenue DESC
           LIMIT 40`,
          [tenantId, start, end, invoiceScope, paymentMethodFilter, channelFilter, platformFilter, locationFilter],
        ),
        // Platform performance inside current location scope.
        this.db.query(
          `SELECT
             ${platformLabelExpr('channel')} AS platform,
             COUNT(*)::int AS orders,
             COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'returned'))::int AS good_orders,
             COUNT(*) FILTER (WHERE status IN ('cancelled', 'returned'))::int AS bad_orders,
             COALESCE(SUM(gross_revenue) FILTER (WHERE status NOT IN ('cancelled', 'returned')), 0)::numeric AS revenue,
             COALESCE(ROUND(AVG(gross_revenue) FILTER (WHERE status NOT IN ('cancelled', 'returned'))::numeric, 2), 0)::numeric AS avg_order_value
           FROM orders
           WHERE tenant_id=$1 AND order_date BETWEEN $2 AND $3
             AND ${invoicePredicate('payment_method', 4)}
             AND ${paymentMethodPredicate('payment_method', 5)}
             AND ${salesChannelPredicate('channel', 6)}
             AND ${platformPredicate('channel', 7)}
             AND ${locationPredicate(locationColumn, 8)}
           GROUP BY platform
           ORDER BY orders DESC, revenue DESC
           LIMIT 20`,
          [tenantId, start, end, invoiceScope, paymentMethodFilter, channelFilter, platformFilter, locationFilter],
        ),
        // All selectable locations for current high-level filter scope (ignoring current location selection).
        this.db.query(
          `SELECT
             ${locationExpr} AS location_label,
             COUNT(*)::int AS orders
           FROM orders
           WHERE tenant_id=$1 AND order_date BETWEEN $2 AND $3
             AND ${invoicePredicate('payment_method', 4)}
             AND ${paymentMethodPredicate('payment_method', 5)}
             AND ${salesChannelPredicate('channel', 6)}
             AND ${platformPredicate('channel', 7)}
           GROUP BY location_label
           ORDER BY orders DESC, location_label ASC
           LIMIT 120`,
          [tenantId, start, end, invoiceScope, paymentMethodFilter, channelFilter, platformFilter],
        ),
        // Most ordered products in the selected location scope.
        this.db.query(
          `SELECT
             oi.product_id::text AS product_id,
             COALESCE(NULLIF(TRIM(p.name), ''), CONCAT('Product #', oi.product_id::text)) AS product_name,
             COALESCE(NULLIF(TRIM(p.article_number), ''), '-') AS sku,
             COALESCE(SUM(oi.quantity) FILTER (WHERE o.status NOT IN ('cancelled', 'returned')), 0)::numeric AS quantity,
             COUNT(DISTINCT o.jtl_order_id) FILTER (WHERE o.status NOT IN ('cancelled', 'returned'))::int AS orders,
             COALESCE(
               SUM(COALESCE(oi.line_total_gross, oi.quantity * oi.unit_price_gross, 0)) FILTER (WHERE o.status NOT IN ('cancelled', 'returned')),
               0
             )::numeric AS revenue
           FROM orders o
           JOIN order_items oi
             ON oi.tenant_id = o.tenant_id
            AND oi.order_id = o.jtl_order_id
           LEFT JOIN products p
             ON p.tenant_id = oi.tenant_id
            AND p.jtl_product_id = oi.product_id
           WHERE o.tenant_id=$1
             AND o.order_date BETWEEN $2 AND $3
             AND ${invoicePredicate('o.payment_method', 4)}
             AND ${paymentMethodPredicate('o.payment_method', 5)}
             AND ${salesChannelPredicate('o.channel', 6)}
             AND ${platformPredicate('o.channel', 7)}
             AND ${locationPredicate(`o.${locationColumn}`, 8)}
           GROUP BY oi.product_id, p.name, p.article_number
           HAVING COALESCE(SUM(oi.quantity) FILTER (WHERE o.status NOT IN ('cancelled', 'returned')), 0) > 0
           ORDER BY quantity DESC, orders DESC, revenue DESC
           LIMIT 12`,
          [tenantId, start, end, invoiceScope, paymentMethodFilter, channelFilter, platformFilter, locationFilter],
        ),
        // Least ordered products in the selected location scope (excluding zero-quantity products).
        this.db.query(
          `SELECT
             oi.product_id::text AS product_id,
             COALESCE(NULLIF(TRIM(p.name), ''), CONCAT('Product #', oi.product_id::text)) AS product_name,
             COALESCE(NULLIF(TRIM(p.article_number), ''), '-') AS sku,
             COALESCE(SUM(oi.quantity) FILTER (WHERE o.status NOT IN ('cancelled', 'returned')), 0)::numeric AS quantity,
             COUNT(DISTINCT o.jtl_order_id) FILTER (WHERE o.status NOT IN ('cancelled', 'returned'))::int AS orders,
             COALESCE(
               SUM(COALESCE(oi.line_total_gross, oi.quantity * oi.unit_price_gross, 0)) FILTER (WHERE o.status NOT IN ('cancelled', 'returned')),
               0
             )::numeric AS revenue
           FROM orders o
           JOIN order_items oi
             ON oi.tenant_id = o.tenant_id
            AND oi.order_id = o.jtl_order_id
           LEFT JOIN products p
             ON p.tenant_id = oi.tenant_id
            AND p.jtl_product_id = oi.product_id
           WHERE o.tenant_id=$1
             AND o.order_date BETWEEN $2 AND $3
             AND ${invoicePredicate('o.payment_method', 4)}
             AND ${paymentMethodPredicate('o.payment_method', 5)}
             AND ${salesChannelPredicate('o.channel', 6)}
             AND ${platformPredicate('o.channel', 7)}
             AND ${locationPredicate(`o.${locationColumn}`, 8)}
           GROUP BY oi.product_id, p.name, p.article_number
           HAVING COALESCE(SUM(oi.quantity) FILTER (WHERE o.status NOT IN ('cancelled', 'returned')), 0) > 0
           ORDER BY quantity ASC, orders ASC, revenue ASC
           LIMIT 12`,
          [tenantId, start, end, invoiceScope, paymentMethodFilter, channelFilter, platformFilter, locationFilter],
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
        const goodOrders = Math.max(parseInt(r.orders, 10) || 0, 0);
        const badOrders = (parseInt(r.cancelled_orders || '0', 10) || 0)
          + (parseInt(r.returned_orders || '0', 10) || 0);
        const goodRate = goodOrders + badOrders > 0
          ? Math.round((goodOrders / (goodOrders + badOrders)) * 1000) / 10
          : 0;
        return {
          name:      r.region_name,
          revenue:   cy,
          orders:    goodOrders,
          customers: parseInt(String(r.customers ?? 0), 10) || 0,
          py_revenue: py,
          py_orders:  pyMap[r.region_name]?.orders || 0,
          growth_pct: growth,
          share_pct:  totalRevenue > 0 ? Math.round(cy / totalRevenue * 1000) / 10 : 0,
          good_orders: goodOrders,
          bad_orders: badOrders,
          good_rate_pct: goodRate,
          avg_order_value: goodOrders > 0 ? Math.round((cy / goodOrders) * 100) / 100 : 0,
        };
      });

      const locationInsights = (locationRows as LocationInsightRow[]).map((r) => {
        const orders = parseInt(r.orders, 10) || 0;
        const goodOrders = parseInt(r.good_orders, 10) || 0;
        const badOrders = parseInt(r.bad_orders, 10) || 0;
        return {
          location: r.location_label,
          orders,
          good_orders: goodOrders,
          bad_orders: badOrders,
          good_rate_pct: orders > 0 ? Math.round((goodOrders / orders) * 1000) / 10 : 0,
          revenue: parseFloat(r.revenue) || 0,
          avg_order_value: parseFloat(r.avg_order_value) || 0,
        };
      });

      const totalPlatformOrders = (platformRows as PlatformMixRow[]).reduce(
        (sum, r) => sum + (parseInt(r.orders, 10) || 0),
        0,
      );
      const platformMix = (platformRows as PlatformMixRow[]).map((r) => {
        const orders = parseInt(r.orders, 10) || 0;
        const goodOrders = parseInt(r.good_orders, 10) || 0;
        const badOrders = parseInt(r.bad_orders, 10) || 0;
        return {
          platform: r.platform,
          orders,
          good_orders: goodOrders,
          bad_orders: badOrders,
          good_rate_pct: orders > 0 ? Math.round((goodOrders / orders) * 1000) / 10 : 0,
          revenue: parseFloat(r.revenue) || 0,
          avg_order_value: parseFloat(r.avg_order_value) || 0,
          share_pct: totalPlatformOrders > 0 ? Math.round((orders / totalPlatformOrders) * 1000) / 10 : 0,
        };
      });

      const locationOptions = (locationOptionsRows as Array<{ location_label: string }>).map((r) => r.location_label);

      const topProducts = (topProductRows as ProductDemandRow[]).map((r) => ({
        product_id: r.product_id,
        product_name: r.product_name,
        sku: r.sku,
        quantity: parseFloat(r.quantity) || 0,
        orders: parseInt(r.orders, 10) || 0,
        revenue: parseFloat(r.revenue) || 0,
      }));
      const leastProducts = (leastProductRows as ProductDemandRow[]).map((r) => ({
        product_id: r.product_id,
        product_name: r.product_name,
        sku: r.sku,
        quantity: parseFloat(r.quantity) || 0,
        orders: parseInt(r.orders, 10) || 0,
        revenue: parseFloat(r.revenue) || 0,
      }));

      const topProductId = topProducts[0]?.product_id || null;
      const leastProductId = leastProducts[0]?.product_id || null;

      const productRouteSql = `
        SELECT
          ${platformLabelExpr('o.channel')} AS platform,
          ${shippingMethodLabelExpr('o.shipping_method')} AS shipping_method,
          COUNT(DISTINCT o.jtl_order_id)::int AS orders,
          COALESCE(SUM(oi.quantity), 0)::numeric AS quantity,
          COALESCE(SUM(COALESCE(oi.line_total_gross, oi.quantity * oi.unit_price_gross, 0)), 0)::numeric AS revenue
        FROM orders o
        JOIN order_items oi
          ON oi.tenant_id = o.tenant_id
         AND oi.order_id = o.jtl_order_id
         AND oi.product_id = $9
        WHERE o.tenant_id=$1
          AND o.order_date BETWEEN $2 AND $3
          AND ${invoicePredicate('o.payment_method', 4)}
          AND ${paymentMethodPredicate('o.payment_method', 5)}
          AND ${salesChannelPredicate('o.channel', 6)}
          AND ${platformPredicate('o.channel', 7)}
          AND ${locationPredicate(`o.${locationColumn}`, 8)}
          AND o.status NOT IN ('cancelled', 'returned')
        GROUP BY platform, shipping_method
        ORDER BY orders DESC, revenue DESC
        LIMIT 14`;

      const [topRoutesRows, leastRoutesRows] = await Promise.all([
        topProductId
          ? this.db.query(productRouteSql, [tenantId, start, end, invoiceScope, paymentMethodFilter, channelFilter, platformFilter, locationFilter, topProductId])
          : Promise.resolve([]),
        leastProductId
          ? this.db.query(productRouteSql, [tenantId, start, end, invoiceScope, paymentMethodFilter, channelFilter, platformFilter, locationFilter, leastProductId])
          : Promise.resolve([]),
      ]);

      const topProductRoutes = (topRoutesRows as ProductRouteRow[]).map((r) => ({
        platform: r.platform,
        shipping_method: r.shipping_method,
        orders: parseInt(r.orders, 10) || 0,
        quantity: parseFloat(r.quantity) || 0,
        revenue: parseFloat(r.revenue) || 0,
      }));
      const leastProductRoutes = (leastRoutesRows as ProductRouteRow[]).map((r) => ({
        platform: r.platform,
        shipping_method: r.shipping_method,
        orders: parseInt(r.orders, 10) || 0,
        quantity: parseFloat(r.quantity) || 0,
        revenue: parseFloat(r.revenue) || 0,
      }));

      return {
        regions,
        cities: (cityRows as CityRow[]).map((r) => ({
          city:    r.city,
          country: r.country,
          orders:  parseInt(r.orders, 10) || 0,
          revenue: parseFloat(r.revenue) || 0,
        })),
        total_revenue: totalRevenue,
        location_dimension: locationDimensionFilter,
        active_location: locationFilter || null,
        location_options: locationOptions,
        location_insights: locationInsights,
        platform_mix: platformMix,
        top_products: topProducts,
        least_products: leastProducts,
        top_product_routes: topProductRoutes,
        least_product_routes: leastProductRoutes,
      };
    });
  }

  async getPaymentMethodOptions(tenantId: string, filters: SalesFilters) {
    const { range = 'ALL', from, to, status = '', invoice, channel, platform } = filters;
    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const invoiceScope = normalizeInvoiceScope(invoice);
    const channelFilter = normalizeSalesChannelFilter(channel);
    const platformFilter = normalizePlatformFilter(platform);
    const key = `jtl:${tenantId}:sales:payment-method-options:${range}:${start}:${end}:${statusFilter}:${invoiceScope}:${channelFilter}:${platformFilter}`;
    return this.cache.getOrSet(key, 300, async () => {
      return this.db.query(
        `SELECT
           ${paymentMethodLabelExpr('payment_method')} AS label,
           COUNT(*)::int AS count
         FROM orders
         WHERE tenant_id = $1
           AND order_date BETWEEN $2 AND $3
           AND ($4 = '' OR status = $4)
           AND ${invoicePredicate('payment_method', 5)}
           AND ${salesChannelPredicate('channel', 6)}
           AND ${platformPredicate('channel', 7)}
         GROUP BY label
         ORDER BY count DESC, label ASC
         LIMIT 60`,
        [tenantId, start, end, statusFilter, invoiceScope, channelFilter, platformFilter],
      );
    });
  }

  async getSalesChannelOptions(tenantId: string, filters: SalesFilters) {
    const { range = 'ALL', from, to, status = '', invoice, paymentMethod, platform } = filters;
    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const invoiceScope = normalizeInvoiceScope(invoice);
    const paymentMethodFilter = normalizePaymentMethodFilter(paymentMethod);
    const platformFilter = normalizePlatformFilter(platform);
    const key = `jtl:${tenantId}:sales:channel-options:${range}:${start}:${end}:${statusFilter}:${invoiceScope}:${paymentMethodFilter}:${platformFilter}`;
    return this.cache.getOrSet(key, 300, async () => {
      return this.db.query(
        `SELECT
           ${salesChannelLabelExpr('channel')} AS label,
           COUNT(*)::int AS count
         FROM orders
         WHERE tenant_id = $1
           AND order_date BETWEEN $2 AND $3
           AND ($4 = '' OR status = $4)
           AND ${invoicePredicate('payment_method', 5)}
           AND ${paymentMethodPredicate('payment_method', 6)}
           AND ${platformPredicate('channel', 7)}
         GROUP BY label
         ORDER BY count DESC, label ASC
         LIMIT 60`,
        [tenantId, start, end, statusFilter, invoiceScope, paymentMethodFilter, platformFilter],
      );
    });
  }

  async getPlatformOptions(tenantId: string, filters: SalesFilters) {
    const { range = 'ALL', from, to, status = '', invoice, paymentMethod, channel } = filters;
    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const invoiceScope = normalizeInvoiceScope(invoice);
    const paymentMethodFilter = normalizePaymentMethodFilter(paymentMethod);
    const channelFilter = normalizeSalesChannelFilter(channel);
    const key = `jtl:${tenantId}:sales:platform-options:${range}:${start}:${end}:${statusFilter}:${invoiceScope}:${paymentMethodFilter}:${channelFilter}`;
    return this.cache.getOrSet(key, 300, async () => {
      return this.db.query(
        `SELECT
           ${platformLabelExpr('channel')} AS label,
           COUNT(*)::int AS count
         FROM orders
         WHERE tenant_id = $1
           AND order_date BETWEEN $2 AND $3
           AND ($4 = '' OR status = $4)
           AND ${invoicePredicate('payment_method', 5)}
           AND ${paymentMethodPredicate('payment_method', 6)}
           AND ${salesChannelPredicate('channel', 7)}
         GROUP BY label
         ORDER BY count DESC, label ASC
         LIMIT 120`,
        [tenantId, start, end, statusFilter, invoiceScope, paymentMethodFilter, channelFilter],
      );
    });
  }

  async getPaymentShipping(tenantId: string, filters: SalesFilters) {
    const { range = 'ALL', from, to, status = '', invoice, paymentMethod, channel, platform } = filters;
    const { start, end } = dateRange(range, from, to);
    const statusFilter = String(status).trim();
    const invoiceScope = normalizeInvoiceScope(invoice);
    const paymentMethodFilter = normalizePaymentMethodFilter(paymentMethod);
    const channelFilter = normalizeSalesChannelFilter(channel);
    const platformFilter = normalizePlatformFilter(platform);
    const key = `jtl:${tenantId}:sales:pay-ship:${range}:${start}:${end}:${statusFilter}:${invoiceScope}:${paymentMethodFilter}:${channelFilter}:${platformFilter}`;
    return this.cache.getOrSet(key, 300, async () => {
      const sql = `
        SELECT
          ${paymentMethodLabelExpr('payment_method')} AS label,
          COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS orders,
          COALESCE(SUM(gross_revenue) FILTER (WHERE status <> 'cancelled'), 0)::numeric AS revenue
        FROM orders
        WHERE tenant_id = $1 AND order_date BETWEEN $2 AND $3
          AND ($4 = '' OR status = $4)
          AND ${invoicePredicate('payment_method', 5)}
          AND ${paymentMethodPredicate('payment_method', 6)}
          AND ${salesChannelPredicate('channel', 7)}
          AND ${platformPredicate('channel', 8)}
        GROUP BY label ORDER BY revenue DESC LIMIT 12`;

      const sql2 = `
        SELECT
          CASE
            WHEN LOWER(TRIM(COALESCE(shipping_method, ''))) IN ('', 'unknown', 'n/a', '-') THEN 'Unknown'
            WHEN LOWER(TRIM(shipping_method)) LIKE '%dhl%' THEN 'DHL'
            WHEN LOWER(TRIM(shipping_method)) LIKE '%dpd%' THEN 'DPD'
            WHEN LOWER(TRIM(shipping_method)) LIKE '%ups%' THEN 'UPS'
            WHEN LOWER(TRIM(shipping_method)) LIKE '%hermes%' THEN 'Hermes'
            WHEN LOWER(TRIM(shipping_method)) LIKE '%fedex%' THEN 'FedEx'
            WHEN LOWER(TRIM(shipping_method)) LIKE '%pickup%' OR LOWER(TRIM(shipping_method)) LIKE '%abholung%' THEN 'Pickup'
            ELSE INITCAP(TRIM(shipping_method))
          END AS label,
          COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS orders,
          COALESCE(SUM(gross_revenue) FILTER (WHERE status <> 'cancelled'), 0)::numeric AS revenue,
          COALESCE(SUM(shipping_cost) FILTER (WHERE status <> 'cancelled'), 0)::numeric AS total_shipping_cost,
          COALESCE(AVG(shipping_cost) FILTER (WHERE status <> 'cancelled' AND shipping_cost > 0), 0)::numeric AS avg_shipping_cost
        FROM orders
        WHERE tenant_id = $1 AND order_date BETWEEN $2 AND $3
          AND ($4 = '' OR status = $4)
          AND ${invoicePredicate('payment_method', 5)}
          AND ${paymentMethodPredicate('payment_method', 6)}
          AND ${salesChannelPredicate('channel', 7)}
          AND ${platformPredicate('channel', 8)}
        GROUP BY label ORDER BY revenue DESC LIMIT 12`;

      const [payRows, shipRows] = await Promise.all([
        this.db.query(sql,  [tenantId, start, end, statusFilter, invoiceScope, paymentMethodFilter, channelFilter, platformFilter]),
        this.db.query(sql2, [tenantId, start, end, statusFilter, invoiceScope, paymentMethodFilter, channelFilter, platformFilter]),
      ]);

      const toItem = (r: Record<string, string>) => ({
        label:   r.label,
        orders:  parseInt(r.orders, 10) || 0,
        revenue: parseFloat(r.revenue) || 0,
      });

      const payItems  = (payRows  as Record<string, string>[]).map(toItem);
      const shipItems = (shipRows as Record<string, string>[]).map((r) => ({
        ...toItem(r),
        total_shipping_cost: parseFloat(r.total_shipping_cost) || 0,
        avg_shipping_cost:   parseFloat(r.avg_shipping_cost)   || 0,
      }));

      const totalPayRev  = payItems.reduce((s, r) => s + r.revenue, 0);
      const totalShipRev = shipItems.reduce((s, r) => s + r.revenue, 0);

      return {
        payment_methods: payItems.map(r => ({
          ...r,
          share_pct: totalPayRev > 0 ? Math.round(r.revenue / totalPayRev * 1000) / 10 : 0,
        })),
        shipping_methods: shipItems.map(r => ({
          ...r,
          share_pct: totalShipRev > 0 ? Math.round(r.revenue / totalShipRev * 1000) / 10 : 0,
        })),
      };
    });
  }
}
