import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CacheService } from '../../cache/cache.service';
import { applyMasking } from '../../common/utils/masking';
import { buildPaginatedResult } from '../../common/utils/pagination';
import { TenantScope } from '../../common/types/auth-request';
import { buildCsv, CsvColumn, CSV_EXPORT_MAX_ROWS } from '../../common/utils/csv-export';
import {
  canonicalCacheNamespace,
  canonicalOrderColumn,
} from '../../common/utils/canonical-channel-payment';

type ProductFilters = {
  range?: string;
  from?: string;
  to?: string;
  platform?: string;
  channel?: string;
  status?: string;
  invoice?: string;
  paymentMethod?: string;
  productId?: string | number;
  page?: string | number;
  limit?: string | number;
  sort?: string;
  order?: string;
  search?: string;
  category?: string;
  channels?: string[] | string;
  model?: string;
  sku?: string;
  brand?: string;
  productIds?: string;
  catalogStatus?: string;
  salesStatus?: string;
  minRevenue?: string | number;
  maxRevenue?: string | number;
  minStock?: string | number;
  maxStock?: string | number;
};

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
  if (range === 'PREVIOUS_MONTH') {
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 10),
      end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10),
    };
  }
  if (range === 'QUARTER' || range === 'PREVIOUS_QUARTER') {
    const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3 + (range === 'PREVIOUS_QUARTER' ? -3 : 0);
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1));
    return {
      start: startDate.toISOString().slice(0, 10),
      end: range === 'PREVIOUS_QUARTER' ? new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 3, 0)).toISOString().slice(0, 10) : end,
    };
  }
  if (range === 'YEAR') return { start: `${now.getUTCFullYear()}-01-01`, end };
  if (range === 'PREVIOUS_YEAR') { const year = now.getUTCFullYear() - 1; return { start: `${year}-01-01`, end: `${year}-12-31` }; }
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

type InvoiceScope = 'all' | 'with_invoice' | 'without_invoice';

function normalizeInvoiceScope(value?: string): InvoiceScope {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'with_invoice') return 'with_invoice';
  if (normalized === 'without_invoice') return 'without_invoice';
  return 'all';
}

function normalizeStatusFilter(value?: string): string {
  const v = String(value || '').trim().toLowerCase();
  if (!v || v === 'all') return '';
  return v;
}

function normalizeGenericFilter(value?: string): string {
  const v = String(value || '').trim();
  if (!v || v.toLowerCase() === 'all') return '';
  return v;
}

function invoicePredicate(column: string, paramIndex: number): string {
  const source = canonicalOrderColumn(column, 'canonical_payment_method');
  const payment = `LOWER(TRIM(COALESCE(${source}, '')))`;
  const hasInvoice = `(${payment} LIKE '%invoice%' OR ${payment} LIKE '%rechnung%')`;
  return `(
    $${paramIndex} = 'all'
    OR ($${paramIndex} = 'with_invoice' AND ${hasInvoice})
    OR ($${paramIndex} = 'without_invoice' AND NOT ${hasInvoice})
  )`;
}

function paymentMethodLabelExpr(column = 'payment_method'): string {
  const source = canonicalOrderColumn(column, 'canonical_payment_method');
  return `
    CASE
      WHEN LOWER(TRIM(COALESCE(${source}, ''))) IN ('', 'unknown', 'n/a', '-') THEN 'Unknown'
      WHEN LOWER(TRIM(${source})) LIKE '%paypal%' THEN 'PayPal'
      WHEN LOWER(TRIM(${source})) LIKE '%klarna%' THEN 'Klarna'
      WHEN LOWER(TRIM(${source})) LIKE '%stripe%' THEN 'Stripe'
      WHEN LOWER(TRIM(${source})) IN ('amazon pay', 'amazonpay') THEN 'Amazon Pay'
      WHEN LOWER(TRIM(${source})) LIKE '%card%' OR LOWER(TRIM(${source})) LIKE '%kredit%' THEN 'Card'
      WHEN LOWER(TRIM(${source})) LIKE '%bank%' OR LOWER(TRIM(${source})) LIKE '%wire%' OR LOWER(TRIM(${source})) LIKE '%überweisung%' THEN 'Bank Transfer'
      WHEN LOWER(TRIM(${source})) LIKE '%invoice%' OR LOWER(TRIM(${source})) LIKE '%rechnung%' THEN 'Invoice'
      ELSE INITCAP(TRIM(${source}))
    END
  `;
}

function paymentMethodPredicate(column: string, paramIndex: number): string {
  return `(
    $${paramIndex} = ''
    OR ${paymentMethodLabelExpr(column)} = $${paramIndex}
  )`;
}

function salesChannelLabelExpr(column = 'channel'): string {
  const source = canonicalOrderColumn(column, 'canonical_marketplace');
  return `
    CASE
      WHEN LOWER(TRIM(COALESCE(${source}, ''))) IN ('', 'unknown', 'n/a', '-') THEN 'Unknown'
      WHEN LOWER(TRIM(${source})) IN ('direct', 'shop', 'onlineshop', 'online shop', 'webshop', 'website') THEN 'Direct'
      WHEN LOWER(TRIM(${source})) LIKE '%amazon%' THEN 'Amazon'
      WHEN LOWER(TRIM(${source})) LIKE '%ebay%' THEN 'eBay'
      WHEN LOWER(TRIM(${source})) = 'mediamarktsaturn' THEN 'MediaMarktSaturn'
      WHEN LOWER(TRIM(${source})) LIKE '%marketplace%' THEN 'Marketplace'
      WHEN LOWER(TRIM(${source})) LIKE '%email%' OR LOWER(TRIM(${source})) LIKE '%newsletter%' THEN 'Email'
      WHEN LOWER(TRIM(${source})) LIKE '%referral%' OR LOWER(TRIM(${source})) LIKE '%affiliate%' THEN 'Referral'
      ELSE INITCAP(TRIM(${source}))
    END
  `;
}

function salesChannelPredicate(column: string, paramIndex: number): string {
  return `(
    $${paramIndex} = ''
    OR ${salesChannelLabelExpr(column)} = $${paramIndex}
  )`;
}

function platformLabelExpr(column = 'channel'): string {
  const source = canonicalOrderColumn(column, 'canonical_marketplace');
  return `
    CASE
      WHEN LOWER(TRIM(COALESCE(${source}, ''))) IN ('', 'unknown', 'n/a', '-') THEN 'Unknown'
      ELSE TRIM(${source})
    END
  `;
}

function platformPredicate(column: string, paramIndex: number): string {
  return `(
    $${paramIndex} = ''
    OR ${platformLabelExpr(column)} = $${paramIndex}
  )`;
}

function statusPredicate(column: string, paramIndex: number): string {
  return `(
    ($${paramIndex} = '' AND ${column} NOT IN ('cancelled', 'returned'))
    OR ($${paramIndex} <> '' AND LOWER(${column}) = LOWER($${paramIndex}))
  )`;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly db: DataSource,
    private readonly cache: CacheService,
  ) {}

  async getKpis(scope: TenantScope, filters: ProductFilters, role: string, userLevel: string) {
    const tenantId = scope.tenantIds;
    const { range = 'ALL', from, to, status, invoice, paymentMethod, channel, platform } = filters || {};
    const { start, end } = dateRange(range, from, to);
    const { prevStart, prevEnd } = prevPeriod(start, end);
    const statusFilter = normalizeStatusFilter(status);
    const invoiceScope = normalizeInvoiceScope(invoice);
    const paymentMethodFilter = normalizeGenericFilter(paymentMethod);
    const channelFilter = normalizeGenericFilter(channel);
    const platformFilter = normalizeGenericFilter(platform);
    const key = `jtl:${tenantId}:${await canonicalCacheNamespace(this.db, tenantId)}:products:kpis:${range}:${start}:${end}:${statusFilter}:${invoiceScope}:${paymentMethodFilter}:${channelFilter}:${platformFilter}`;
    return this.cache.getOrSet(key, 300, async () => {
      const rows = await this.db.query(
        `WITH catalog AS (
           SELECT
             COUNT(*)                                                                   AS total_products,
             COUNT(*) FILTER (WHERE is_active = true)                                  AS active_products,
             ROUND(COALESCE(SUM(stock_quantity * COALESCE(NULLIF(unit_cost,0), NULLIF(list_price_net,0), 0)), 0)::numeric, 2) AS total_stock_value
           FROM products WHERE tenant_id = ANY($1::uuid[])
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
           WHERE oi.tenant_id = ANY($1::uuid[]) AND o.order_date BETWEEN $2 AND $3
             AND ${statusPredicate('o.status', 6)}
             AND ${invoicePredicate('o.payment_method', 7)}
             AND ${paymentMethodPredicate('o.payment_method', 8)}
             AND ${salesChannelPredicate('o.channel', 9)}
             AND ${platformPredicate('o.channel', 10)}
             AND oi.unit_price_net > 0
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
           WHERE oi.tenant_id = ANY($1::uuid[]) AND o.order_date BETWEEN $4 AND $5
             AND ${statusPredicate('o.status', 6)}
             AND ${invoicePredicate('o.payment_method', 7)}
             AND ${paymentMethodPredicate('o.payment_method', 8)}
             AND ${salesChannelPredicate('o.channel', 9)}
             AND ${platformPredicate('o.channel', 10)}
             AND oi.unit_price_net > 0
         ),
         top_prod AS (
           SELECT product_id, SUM(oi.line_total_gross) AS rev
           FROM order_items oi
           JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
           WHERE oi.tenant_id = ANY($1::uuid[]) AND o.order_date BETWEEN $2 AND $3
             AND ${statusPredicate('o.status', 6)}
             AND ${invoicePredicate('o.payment_method', 7)}
             AND ${paymentMethodPredicate('o.payment_method', 8)}
             AND ${salesChannelPredicate('o.channel', 9)}
             AND ${platformPredicate('o.channel', 10)}
           GROUP BY product_id ORDER BY rev DESC LIMIT 1
         ),
         cur_top AS (
           SELECT COALESCE(SUM(oi.line_total_gross), 0) AS top_product_revenue
           FROM order_items oi
           JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
           JOIN top_prod tp ON tp.product_id = oi.product_id
           WHERE oi.tenant_id = ANY($1::uuid[]) AND o.order_date BETWEEN $2 AND $3
             AND ${statusPredicate('o.status', 6)}
             AND ${invoicePredicate('o.payment_method', 7)}
             AND ${paymentMethodPredicate('o.payment_method', 8)}
             AND ${salesChannelPredicate('o.channel', 9)}
             AND ${platformPredicate('o.channel', 10)}
         ),
         prev_top AS (
           SELECT COALESCE(SUM(oi.line_total_gross), 0) AS top_product_revenue
           FROM order_items oi
           JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
           JOIN top_prod tp ON tp.product_id = oi.product_id
           WHERE oi.tenant_id = ANY($1::uuid[]) AND o.order_date BETWEEN $4 AND $5
             AND ${statusPredicate('o.status', 6)}
             AND ${invoicePredicate('o.payment_method', 7)}
             AND ${paymentMethodPredicate('o.payment_method', 8)}
             AND ${salesChannelPredicate('o.channel', 9)}
             AND ${platformPredicate('o.channel', 10)}
         )
         SELECT
           c.total_products, c.active_products, c.total_stock_value,
           cm.avg_margin AS cur_margin, pm.avg_margin AS prev_margin,
           ct.top_product_revenue AS cur_top_rev, pt.top_product_revenue AS prev_top_rev
         FROM catalog c, cur_margin cm, prev_margin pm, cur_top ct, prev_top pt`,
        [
          tenantId,
          start,
          end,
          prevStart,
          prevEnd,
          statusFilter,
          invoiceScope,
          paymentMethodFilter,
          channelFilter,
          platformFilter,
        ],
      );

      const r = rows[0] || {};
      const [coverageRows, noSalesRows] = await Promise.all([
        this.db.query(
          `SELECT
             COUNT(*) FILTER (WHERE oi.unit_price_net > 0)::int AS priced_lines,
             COUNT(*) FILTER (
               WHERE oi.unit_price_net > 0
                 AND COALESCE(NULLIF(oi.unit_cost, 0), NULLIF(p.unit_cost, 0)) IS NOT NULL
             )::int AS costed_lines
           FROM order_items oi
           JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
           LEFT JOIN products p ON p.jtl_product_id = oi.product_id AND p.tenant_id = oi.tenant_id
           WHERE oi.tenant_id = ANY($1::uuid[]) AND o.order_date BETWEEN $2 AND $3
             AND ${statusPredicate('o.status', 4)}
             AND ${invoicePredicate('o.payment_method', 5)}
             AND ${paymentMethodPredicate('o.payment_method', 6)}
             AND ${salesChannelPredicate('o.channel', 7)}
             AND ${platformPredicate('o.channel', 8)}`,
          [tenantId, start, end, statusFilter, invoiceScope, paymentMethodFilter, channelFilter, platformFilter],
        ),
        this.db.query(
          `SELECT COUNT(*)::int AS no_sales_products
           FROM products p
           WHERE p.tenant_id = ANY($1::uuid[]) AND p.is_active = true
             AND NOT EXISTS (
               SELECT 1
               FROM order_items oi
               JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
               WHERE oi.tenant_id = p.tenant_id AND oi.product_id = p.jtl_product_id
                 AND o.order_date BETWEEN $2 AND $3
                 AND ${statusPredicate('o.status', 4)}
                 AND ${invoicePredicate('o.payment_method', 5)}
                 AND ${paymentMethodPredicate('o.payment_method', 6)}
                 AND ${salesChannelPredicate('o.channel', 7)}
                 AND ${platformPredicate('o.channel', 8)}
             )`,
          [tenantId, start, end, statusFilter, invoiceScope, paymentMethodFilter, channelFilter, platformFilter],
        ),
      ]);
      const curTopRev  = parseFloat(r.cur_top_rev)  || 0;
      const prevTopRev = parseFloat(r.prev_top_rev) || 0;
      const curMargin  = parseFloat(r.cur_margin)   || 0;
      const prevMargin = parseFloat(r.prev_margin)  || 0;
      const pricedLines = Number(coverageRows[0]?.priced_lines || 0);
      const costedLines = Number(coverageRows[0]?.costed_lines || 0);
      const marginCoverage = pricedLines > 0 ? costedLines / pricedLines : 0;

      const result = {
        total_products:      r.total_products,
        active_products:     r.active_products,
        total_stock_value:   r.total_stock_value,
        avg_margin:          curMargin,
        top_product_revenue: curTopRev,
        top_product_delta:   pctDelta(curTopRev,  prevTopRev),
        avg_margin_delta:    pctDelta(curMargin,  prevMargin),
        margin_available:    costedLines > 0 && marginCoverage >= 0.8,
        margin_cost_coverage_pct: Math.round(marginCoverage * 1000) / 10,
        no_sales_products: Number(noSalesRows[0]?.no_sales_products || 0),
      };
      return applyMasking(result, userLevel, role);
    });
  }

  async getList(scope: TenantScope, filters: ProductFilters, role: string, userLevel: string) {
    if (String(filters.brand || '').trim()) {
      throw new BadRequestException('Brand filter is unavailable because manufacturer data is not synced');
    }
    const tenantId = scope.tenantIds;
    const page      = Math.max(1, Number.parseInt(String(filters.page ?? '1'), 10) || 1);
    const limit     = Math.min(
      Math.max(1, Number.parseInt(String(filters.limit ?? '50'), 10) || 50),
      CSV_EXPORT_MAX_ROWS,
    );
    const offset    = (page - 1) * limit;
    // Strict whitelist map: user input key → safe SQL column identifier
    const SORT_MAP: Record<string, string> = {
      total_revenue: 'total_revenue',
      total_units: 'total_units',
      margin_pct: 'margin_pct',
      revenue_change: 'revenue_change',
      name: 'name',
      stock_quantity: 'stock_quantity',
      list_price_gross: 'list_price_gross',
    };
    const sortField = SORT_MAP[String(filters.sort || '').trim().toLowerCase()] ?? 'total_revenue';
    const sortDir   = String(filters.order || '').trim().toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const searchTerm = String(filters.search || '').trim();
    const categoryTerm = String(filters.category || '').trim();
    const skuTerm = String(filters.sku || '').trim();
    const modelTerm = String(filters.model || '').trim();
    const catalogStatus = ['active', 'inactive'].includes(String(filters.catalogStatus || '')) ? String(filters.catalogStatus) : 'all';
    const salesStatus = ['with_sales', 'no_sales', 'with_stock', 'without_stock', 'stock_no_sales'].includes(String(filters.salesStatus || '')) ? String(filters.salesStatus) : 'all';
    const channels = (Array.isArray(filters.channels) ? filters.channels : String(filters.channels || '').split(','))
      .map((value) => value.trim()).filter(Boolean).slice(0, 50);
    const productIds = String(filters.productIds || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map(Number)
      .filter(Number.isFinite)
      .slice(0, 100);
    const minRevenue = filters.minRevenue == null || filters.minRevenue === '' ? null : Number(filters.minRevenue);
    const maxRevenue = filters.maxRevenue == null || filters.maxRevenue === '' ? null : Number(filters.maxRevenue);
    const minStock = filters.minStock == null || filters.minStock === '' ? null : Number(filters.minStock);
    const maxStock = filters.maxStock == null || filters.maxStock === '' ? null : Number(filters.maxStock);
    const statusFilter = normalizeStatusFilter(filters.status);
    const invoiceScope = normalizeInvoiceScope(filters.invoice);
    const paymentMethodFilter = normalizeGenericFilter(filters.paymentMethod);
    const channelFilter = normalizeGenericFilter(filters.channel);
    const platformFilter = normalizeGenericFilter(filters.platform);
    const { start, end } = dateRange(filters.range || 'ALL', filters.from, filters.to);
    const { prevStart, prevEnd } = prevPeriod(start, end);

    const key = `jtl:${tenantId}:${await canonicalCacheNamespace(this.db, tenantId)}:products:list:${page}:${limit}:${sortField}:${sortDir}:${searchTerm}:${categoryTerm}:${skuTerm}:${modelTerm}:${catalogStatus}:${salesStatus}:${channels.join(',')}:${productIds.join(',')}:${minRevenue}:${maxRevenue}:${minStock}:${maxStock}:${start}:${end}:${statusFilter}:${invoiceScope}:${paymentMethodFilter}:${channelFilter}:${platformFilter}`;
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
        statusFilter,
        invoiceScope,
        paymentMethodFilter,
        channelFilter,
        platformFilter,
        channels,
        catalogStatus,
        salesStatus,
        skuTerm,
        modelTerm,
        productIds,
        Number.isFinite(minRevenue) ? minRevenue : null,
        Number.isFinite(maxRevenue) ? maxRevenue : null,
        Number.isFinite(minStock) ? minStock : null,
        Number.isFinite(maxStock) ? maxStock : null,
      ];
      const rows = await this.db.query(
          `
          WITH current_sales AS (
            SELECT oi.tenant_id, oi.product_id,
              SUM(oi.line_total_gross) AS total_revenue,
              SUM(oi.quantity) AS total_units,
              COUNT(DISTINCT o.jtl_order_id)::int AS total_orders,
              COUNT(DISTINCT o.customer_id)::int AS total_customers
            FROM order_items oi
            JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
            WHERE oi.tenant_id = ANY($1::uuid[]) AND o.order_date BETWEEN $4 AND $5
              AND ${statusPredicate('o.status', 12)}
              AND ${invoicePredicate('o.payment_method', 13)}
              AND ${paymentMethodPredicate('o.payment_method', 14)}
              AND ${salesChannelPredicate('o.channel', 15)}
              AND ${platformPredicate('o.channel', 16)}
              AND (cardinality($17::text[]) = 0 OR ${salesChannelLabelExpr('o.channel')} = ANY($17::text[]))
            GROUP BY oi.tenant_id, oi.product_id
          ), previous_sales AS (
            SELECT oi.tenant_id, oi.product_id,
              SUM(oi.line_total_gross) AS total_revenue
            FROM order_items oi
            JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
            WHERE oi.tenant_id = ANY($1::uuid[]) AND o.order_date BETWEEN $6 AND $7
              AND ${statusPredicate('o.status', 12)}
              AND ${invoicePredicate('o.payment_method', 13)}
              AND ${paymentMethodPredicate('o.payment_method', 14)}
              AND ${salesChannelPredicate('o.channel', 15)}
              AND ${platformPredicate('o.channel', 16)}
              AND (cardinality($17::text[]) = 0 OR ${salesChannelLabelExpr('o.channel')} = ANY($17::text[]))
            GROUP BY oi.tenant_id, oi.product_id
          ), current_stock AS (
            SELECT tenant_id, jtl_product_id,
              COALESCE(SUM(total), 0)::float8 AS total_stock,
              COALESCE(SUM(available), 0)::float8 AS available_stock,
              COALESCE(SUM(reserved), 0)::float8 AS reserved_stock
            FROM inventory
            WHERE tenant_id = ANY($1::uuid[])
            GROUP BY tenant_id, jtl_product_id
          ), base AS (
            SELECT
              p.id, p.jtl_product_id, p.article_number, p.name,
              p.list_price_gross, p.list_price_net, p.unit_cost,
              COALESCE(stock.total_stock, p.stock_quantity, 0)::float8 AS stock_quantity,
              COALESCE(stock.available_stock, 0)::float8 AS available_stock,
              COALESCE(stock.reserved_stock, 0)::float8 AS reserved_stock,
              p.is_active, p.ean, COALESCE(c.name, 'Uncategorized') AS category_name,
              COALESCE(rev.total_revenue, 0)::float8 AS total_revenue,
              COALESCE(rev.total_units, 0)::float8 AS total_units,
              COALESCE(rev.total_orders, 0)::int AS total_orders,
              COALESCE(rev.total_customers, 0)::int AS total_customers,
              COALESCE(prev.total_revenue, 0)::float8 AS prev_revenue,
              CASE WHEN COALESCE(prev.total_revenue, 0) > 0
                THEN ((COALESCE(rev.total_revenue, 0) - prev.total_revenue) / prev.total_revenue * 100)::float8
                ELSE NULL END AS revenue_change,
              CASE WHEN p.list_price_net > 0 AND p.unit_cost > 0
                THEN ROUND(((p.list_price_net - p.unit_cost) / p.list_price_net * 100)::numeric, 2)::float8
                ELSE NULL END AS margin_pct
            FROM products p
            LEFT JOIN categories c ON c.jtl_category_id = p.category_id AND c.tenant_id = p.tenant_id
            LEFT JOIN current_sales rev ON rev.tenant_id = p.tenant_id AND rev.product_id = p.jtl_product_id
            LEFT JOIN previous_sales prev ON prev.tenant_id = p.tenant_id AND prev.product_id = p.jtl_product_id
            LEFT JOIN current_stock stock ON stock.tenant_id = p.tenant_id AND stock.jtl_product_id = p.jtl_product_id
            WHERE p.tenant_id = ANY($1::uuid[])
            AND (
              $8 = ''
              OR p.name ILIKE '%' || $8 || '%'
              OR p.article_number ILIKE '%' || $8 || '%'
            )
            AND (
              $9 = ''
              OR COALESCE(c.name, 'Uncategorized') = $9
            )
            AND ($18 = 'all' OR ($18 = 'active' AND p.is_active) OR ($18 = 'inactive' AND NOT p.is_active))
            AND ($20 = '' OR p.article_number ILIKE '%' || $20 || '%')
            AND ($21 = '' OR p.name ILIKE '%' || $21 || '%' OR p.article_number ILIKE '%' || $21 || '%')
            AND (cardinality($22::bigint[]) = 0 OR p.id = ANY($22::bigint[]))
          ), filtered AS (
            SELECT *, COUNT(*) OVER()::int AS total_count
            FROM base
            WHERE ($19 = 'all'
              OR ($19 = 'with_sales' AND total_revenue > 0)
              OR ($19 = 'no_sales' AND total_revenue = 0)
              OR ($19 = 'with_stock' AND stock_quantity > 0)
              OR ($19 = 'without_stock' AND stock_quantity <= 0)
              OR ($19 = 'stock_no_sales' AND stock_quantity > 0 AND total_revenue = 0))
              AND ($23::numeric IS NULL OR total_revenue >= $23::numeric)
              AND ($24::numeric IS NULL OR total_revenue <= $24::numeric)
              AND ($25::numeric IS NULL OR stock_quantity >= $25::numeric)
              AND ($26::numeric IS NULL OR stock_quantity <= $26::numeric)
          )
          SELECT * FROM filtered
          ORDER BY
            CASE WHEN $10 = 'name' AND $11 = 'ASC' THEN name END ASC NULLS LAST,
            CASE WHEN $10 = 'name' AND $11 = 'DESC' THEN name END DESC NULLS LAST,
            CASE WHEN $10 = 'stock_quantity' AND $11 = 'ASC' THEN stock_quantity END ASC NULLS LAST,
            CASE WHEN $10 = 'stock_quantity' AND $11 = 'DESC' THEN stock_quantity END DESC NULLS LAST,
            CASE WHEN $10 = 'list_price_gross' AND $11 = 'ASC' THEN list_price_gross END ASC NULLS LAST,
            CASE WHEN $10 = 'list_price_gross' AND $11 = 'DESC' THEN list_price_gross END DESC NULLS LAST,
            CASE WHEN $10 = 'total_revenue' AND $11 = 'ASC' THEN total_revenue END ASC NULLS LAST,
            CASE WHEN $10 = 'total_revenue' AND $11 = 'DESC' THEN total_revenue END DESC NULLS LAST,
            CASE WHEN $10 = 'total_units' AND $11 = 'ASC' THEN total_units END ASC NULLS LAST,
            CASE WHEN $10 = 'total_units' AND $11 = 'DESC' THEN total_units END DESC NULLS LAST,
            CASE WHEN $10 = 'margin_pct' AND $11 = 'ASC' THEN margin_pct END ASC NULLS LAST,
            CASE WHEN $10 = 'margin_pct' AND $11 = 'DESC' THEN margin_pct END DESC NULLS LAST,
            CASE WHEN $10 = 'revenue_change' AND $11 = 'ASC' THEN revenue_change END ASC NULLS LAST,
            CASE WHEN $10 = 'revenue_change' AND $11 = 'DESC' THEN revenue_change END DESC NULLS LAST,
            id DESC
          LIMIT $2 OFFSET $3
          `,
          params,
        );

      const maskedRows = applyMasking(rows, userLevel, role) as Record<string, unknown>[];
      return buildPaginatedResult(maskedRows, rows[0]?.total_count, page, limit);
    });
  }

  async exportList(scope: TenantScope, filters: ProductFilters, role: string, userLevel: string): Promise<string> {
    const rows: Record<string, unknown>[] = [];
    let total = 0;
    for (let page = 1; rows.length < CSV_EXPORT_MAX_ROWS; page += 1) {
      const result = await this.getList(scope, { ...filters, page, limit: CSV_EXPORT_MAX_ROWS }, role, userLevel);
      rows.push(...result.rows);
      total = result.total;
      if (!result.has_next || rows.length >= total) break;
    }
    const columns: CsvColumn<Record<string, unknown>>[] = [
      { key: 'article_number', header: 'Article Number' },
      { key: 'name', header: 'Name' },
      { key: 'category_name', header: 'Category' },
      { key: 'list_price_gross', header: 'Price Gross' },
      { key: 'list_price_net', header: 'Price Net' },
      { key: 'unit_cost', header: 'Unit Cost' },
      { key: 'stock_quantity', header: 'Total Stock' },
      { key: 'total_revenue', header: 'Revenue' },
      { key: 'total_units', header: 'Units Sold' },
      {
        key: 'margin_pct',
        header: 'Margin %',
        value: (row) => Number(row.list_price_net || 0) > 0 && Number(row.unit_cost || 0) > 0 ? row.margin_pct : 'Margin unavailable',
      },
    ];
    return buildCsv(rows, columns, {
      metadata: {
        module: 'products',
        total_matching_rows: total,
        exported_rows: rows.length,
        complete: rows.length >= total,
        row_limit: CSV_EXPORT_MAX_ROWS,
        generated_at: new Date().toISOString(),
      },
    });
  }

  async getCategories(scope: TenantScope, filters?: ProductFilters) {
    const tenantId = scope.tenantIds;
    const { start, end } = dateRange((filters?.range || 'ALL'), filters?.from, filters?.to);
    const statusFilter = normalizeStatusFilter(filters?.status);
    const invoiceScope = normalizeInvoiceScope(filters?.invoice);
    const paymentMethodFilter = normalizeGenericFilter(filters?.paymentMethod);
    const channelFilter = normalizeGenericFilter(filters?.channel);
    const platformFilter = normalizeGenericFilter(filters?.platform);
    const key = `jtl:${tenantId}:${await canonicalCacheNamespace(this.db, tenantId)}:products:categories:${start}:${end}:${statusFilter}:${invoiceScope}:${paymentMethodFilter}:${channelFilter}:${platformFilter}`;
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
          WHERE oi.tenant_id = ANY($1::uuid[])
            AND o.order_date BETWEEN $2 AND $3
            AND ${statusPredicate('o.status', 4)}
            AND ${invoicePredicate('o.payment_method', 5)}
            AND ${paymentMethodPredicate('o.payment_method', 6)}
            AND ${salesChannelPredicate('o.channel', 7)}
            AND ${platformPredicate('o.channel', 8)}
          GROUP BY oi.product_id
        ) rev ON rev.product_id = p.jtl_product_id
        WHERE p.tenant_id = ANY($1::uuid[])
        GROUP BY c.name
        ORDER BY total_revenue DESC NULLS LAST
        LIMIT 500
        `,
        [tenantId, start, end, statusFilter, invoiceScope, paymentMethodFilter, channelFilter, platformFilter],
      );
    });
  }

  async getTop(scope: TenantScope, filters: ProductFilters, role: string, userLevel: string) {
    const tenantId = scope.tenantIds;
    const limit = Math.min(parseInt(String(filters.limit ?? '10'), 10), 100);
    const statusFilter = normalizeStatusFilter(filters.status);
    const invoiceScope = normalizeInvoiceScope(filters.invoice);
    const paymentMethodFilter = normalizeGenericFilter(filters.paymentMethod);
    const channelFilter = normalizeGenericFilter(filters.channel);
    const platformFilter = normalizeGenericFilter(filters.platform);
    const { start, end } = dateRange(filters.range || 'ALL', filters.from, filters.to);
    const key   = `jtl:${tenantId}:${await canonicalCacheNamespace(this.db, tenantId)}:products:top:${limit}:${start}:${end}:${statusFilter}:${invoiceScope}:${paymentMethodFilter}:${channelFilter}:${platformFilter}`;
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
            ELSE NULL
          END AS margin_pct
        FROM products p
        LEFT JOIN (
          SELECT oi.product_id,
            SUM(oi.line_total_gross) AS total_revenue,
            SUM(oi.quantity)         AS total_units
          FROM order_items oi
          JOIN orders o ON o.jtl_order_id = oi.order_id AND o.tenant_id = oi.tenant_id
          WHERE oi.tenant_id = ANY($1::uuid[])
            AND o.order_date BETWEEN $3 AND $4
            AND ${statusPredicate('o.status', 5)}
            AND ${invoicePredicate('o.payment_method', 6)}
            AND ${paymentMethodPredicate('o.payment_method', 7)}
            AND ${salesChannelPredicate('o.channel', 8)}
            AND ${platformPredicate('o.channel', 9)}
          GROUP BY oi.product_id
        ) rev ON rev.product_id = p.jtl_product_id
        WHERE p.tenant_id = ANY($1::uuid[])
        ORDER BY total_revenue DESC NULLS LAST
        LIMIT $2
        `,
        [tenantId, limit, start, end, statusFilter, invoiceScope, paymentMethodFilter, channelFilter, platformFilter],
      );
      return applyMasking(rows, userLevel, role);
    });
  }

  async getTrend(scope: TenantScope, filters: ProductFilters) {
    const tenantId = scope.tenantIds;
    const productId = Number.parseInt(String(filters.productId ?? ''), 10);
    if (!Number.isFinite(productId) || productId <= 0) return [];

    const { start, end } = dateRange(filters.range || 'ALL', filters.from, filters.to);
    const statusFilter = normalizeStatusFilter(filters.status);
    const invoiceScope = normalizeInvoiceScope(filters.invoice);
    const paymentMethodFilter = normalizeGenericFilter(filters.paymentMethod);
    const channelFilter = normalizeGenericFilter(filters.channel);
    const platformFilter = normalizeGenericFilter(filters.platform);
    const key = `jtl:${tenantId}:${await canonicalCacheNamespace(this.db, tenantId)}:products:trend:${productId}:${start}:${end}:${statusFilter}:${invoiceScope}:${paymentMethodFilter}:${channelFilter}:${platformFilter}`;

    return this.cache.getOrSet(key, 300, async () => {
      return this.db.query(
        `
        SELECT
          to_char(date_trunc('month', o.order_date), 'YYYY-MM-01') AS year_month,
          COALESCE(SUM(COALESCE(oi.line_total_gross, oi.quantity * oi.unit_price_gross, 0)), 0)::numeric AS revenue,
          COALESCE(SUM(oi.quantity), 0)::numeric AS units,
          COUNT(DISTINCT o.jtl_order_id)::int AS orders
        FROM order_items oi
        JOIN orders o
          ON o.jtl_order_id = oi.order_id
         AND o.tenant_id = oi.tenant_id
        WHERE oi.tenant_id = ANY($1::uuid[])
          AND oi.product_id = $2
          AND o.order_date BETWEEN $3 AND $4
          AND ${statusPredicate('o.status', 5)}
          AND ${invoicePredicate('o.payment_method', 6)}
          AND ${paymentMethodPredicate('o.payment_method', 7)}
          AND ${salesChannelPredicate('o.channel', 8)}
          AND ${platformPredicate('o.channel', 9)}
        GROUP BY year_month
        ORDER BY year_month ASC
        `,
        [tenantId, productId, start, end, statusFilter, invoiceScope, paymentMethodFilter, channelFilter, platformFilter],
      );
    });
  }

  async search(scope: TenantScope, search: string) {
    const term = String(search || '').trim();
    if (term.length < 2) return [];
    return this.db.query(
      `SELECT p.id, p.jtl_product_id, p.article_number, p.name, p.ean,
              COALESCE(c.name, 'Uncategorized') AS category_name,
              COALESCE(inv.total_stock, p.stock_quantity, 0)::float8 AS total_stock,
              COALESCE(inv.available_stock, 0)::float8 AS available_stock,
              COALESCE(inv.reserved_stock, 0)::float8 AS reserved_stock
       FROM products p
       LEFT JOIN categories c ON c.tenant_id = p.tenant_id AND c.jtl_category_id = p.category_id
       LEFT JOIN (
         SELECT tenant_id, jtl_product_id, SUM(total)::numeric AS total_stock,
                SUM(available)::numeric AS available_stock, SUM(reserved)::numeric AS reserved_stock
         FROM inventory WHERE tenant_id = ANY($1::uuid[]) GROUP BY tenant_id, jtl_product_id
       ) inv ON inv.tenant_id = p.tenant_id AND inv.jtl_product_id = p.jtl_product_id
       WHERE p.tenant_id = ANY($1::uuid[]) AND p.is_active = true
         AND (p.article_number ILIKE '%' || $2 || '%' OR p.name ILIKE '%' || $2 || '%' OR p.ean ILIKE '%' || $2 || '%')
       ORDER BY
         CASE WHEN LOWER(COALESCE(p.article_number, '')) = LOWER($2) OR LOWER(COALESCE(p.ean, '')) = LOWER($2) THEN 0
              WHEN LOWER(p.name) = LOWER($2) THEN 1
              WHEN COALESCE(p.article_number, '') ILIKE $2 || '%' THEN 2
              WHEN p.name ILIKE $2 || '%' THEN 3 ELSE 4 END,
         p.name ASC
       LIMIT 12`,
      [scope.tenantIds, term],
    );
  }

  async getIntelligence(scope: TenantScope, productId: number, filters: ProductFilters) {
    const { start, end } = dateRange(filters.range || 'ALL', filters.from, filters.to);
    const productRows = await this.db.query(
      `SELECT p.id, p.jtl_product_id, p.article_number, p.name, p.ean, p.is_active,
              p.list_price_net, p.list_price_gross, p.unit_cost, p.synced_at AS product_synced_at,
              COALESCE(c.name, 'Uncategorized') AS category
       FROM products p
       LEFT JOIN categories c ON c.tenant_id = p.tenant_id AND c.jtl_category_id = p.category_id
       WHERE p.tenant_id = ANY($1::uuid[]) AND p.id = $2 LIMIT 1`,
      [scope.tenantIds, productId],
    );
    const product = productRows[0];
    if (!product) throw new NotFoundException('Product not found');

    const [summaryRows, inventory, channels, knownChannels, orders, orderLines, trend] = await Promise.all([
      this.db.query(
        `SELECT COALESCE(SUM(oi.line_total_gross), 0)::float8 AS revenue,
                COALESCE(SUM(oi.quantity), 0)::float8 AS units,
                COUNT(DISTINCT o.jtl_order_id)::int AS orders,
                COUNT(DISTINCT o.customer_id)::int AS customers,
                CASE WHEN SUM(oi.quantity) > 0 THEN SUM(oi.line_total_gross) / SUM(oi.quantity) ELSE NULL END::float8 AS average_price,
                MAX(o.order_date) AS last_sale,
                COUNT(DISTINCT o.jtl_order_id) FILTER (WHERE LOWER(COALESCE(o.status, '')) IN ('returned', 'return'))::int AS returns,
                MAX(o.synced_at) AS last_order_sync,
                COUNT(*) FILTER (WHERE oi.unit_price_net > 0)::int AS eligible_margin_lines,
                COUNT(*) FILTER (
                  WHERE oi.unit_price_net > 0
                    AND COALESCE(NULLIF(oi.unit_cost, 0), NULLIF(p.unit_cost, 0)) > 0
                )::int AS costed_margin_lines,
                CASE
                  WHEN SUM(oi.quantity * oi.unit_price_net) FILTER (
                    WHERE oi.unit_price_net > 0
                      AND COALESCE(NULLIF(oi.unit_cost, 0), NULLIF(p.unit_cost, 0)) > 0
                  ) > 0
                  THEN ROUND((
                    (SUM(oi.quantity * oi.unit_price_net) FILTER (
                      WHERE oi.unit_price_net > 0
                        AND COALESCE(NULLIF(oi.unit_cost, 0), NULLIF(p.unit_cost, 0)) > 0
                    ) - SUM(oi.quantity * COALESCE(NULLIF(oi.unit_cost, 0), NULLIF(p.unit_cost, 0))) FILTER (
                      WHERE oi.unit_price_net > 0
                        AND COALESCE(NULLIF(oi.unit_cost, 0), NULLIF(p.unit_cost, 0)) > 0
                    )) / NULLIF(SUM(oi.quantity * oi.unit_price_net) FILTER (
                      WHERE oi.unit_price_net > 0
                        AND COALESCE(NULLIF(oi.unit_cost, 0), NULLIF(p.unit_cost, 0)) > 0
                    ), 0) * 100
                  )::numeric, 2)
                  ELSE NULL
                END AS margin_pct
         FROM order_items oi
         JOIN orders o ON o.tenant_id = oi.tenant_id AND o.jtl_order_id = oi.order_id
         LEFT JOIN products p ON p.tenant_id = oi.tenant_id AND p.jtl_product_id = oi.product_id
         WHERE oi.tenant_id = ANY($1::uuid[]) AND oi.product_id = $2
           AND o.order_date BETWEEN $3 AND $4
           AND LOWER(COALESCE(o.status, '')) <> 'cancelled'`,
        [scope.tenantIds, product.jtl_product_id, start, end],
      ),
      this.db.query(
        `SELECT warehouse_name, available::float8, reserved::float8, total::float8,
                reorder_point::float8, synced_at
         FROM inventory
         WHERE tenant_id = ANY($1::uuid[]) AND jtl_product_id = $2
         ORDER BY warehouse_name`,
        [scope.tenantIds, product.jtl_product_id],
      ),
      this.db.query(
        `SELECT ${salesChannelLabelExpr('o.channel')} AS channel,
                COALESCE(SUM(oi.line_total_gross), 0)::float8 AS revenue,
                COALESCE(SUM(oi.quantity), 0)::float8 AS units,
                COUNT(DISTINCT o.jtl_order_id)::int AS orders,
                COUNT(DISTINCT o.customer_id)::int AS customers,
                MAX(o.order_date) AS last_sale
         FROM order_items oi
         JOIN orders o ON o.tenant_id = oi.tenant_id AND o.jtl_order_id = oi.order_id
         WHERE oi.tenant_id = ANY($1::uuid[]) AND oi.product_id = $2
           AND o.order_date BETWEEN $3 AND $4
           AND LOWER(COALESCE(o.status, '')) <> 'cancelled'
         GROUP BY 1 ORDER BY revenue DESC`,
        [scope.tenantIds, product.jtl_product_id, start, end],
      ),
      this.db.query(
        `SELECT DISTINCT ${salesChannelLabelExpr('o.channel')} AS channel
         FROM orders o WHERE o.tenant_id = ANY($1::uuid[]) ORDER BY channel`,
        [scope.tenantIds],
      ),
      this.db.query(
        `SELECT o.id, o.jtl_order_id, o.order_number, o.order_date, o.status,
                ${salesChannelLabelExpr('o.channel')} AS channel,
                o.gross_revenue::float8, o.customer_number
         FROM orders o
         WHERE o.tenant_id = ANY($1::uuid[]) AND o.order_date BETWEEN $3 AND $4
           AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.tenant_id = o.tenant_id AND oi.order_id = o.jtl_order_id AND oi.product_id = $2)
         ORDER BY o.order_date DESC LIMIT 100`,
        [scope.tenantIds, product.jtl_product_id, start, end],
      ),
      this.db.query(
        `SELECT oi.id, oi.order_id, o.order_number, o.order_date,
                ${salesChannelLabelExpr('o.channel')} AS channel,
                oi.quantity::float8, oi.unit_price_gross::float8, oi.line_total_gross::float8
         FROM order_items oi
         JOIN orders o ON o.tenant_id = oi.tenant_id AND o.jtl_order_id = oi.order_id
         WHERE oi.tenant_id = ANY($1::uuid[]) AND oi.product_id = $2 AND o.order_date BETWEEN $3 AND $4
         ORDER BY o.order_date DESC LIMIT 200`,
        [scope.tenantIds, product.jtl_product_id, start, end],
      ),
      this.db.query(
        `SELECT date_trunc('month', o.order_date)::date AS period,
                COALESCE(SUM(oi.line_total_gross), 0)::float8 AS revenue,
                COALESCE(SUM(oi.quantity), 0)::float8 AS units,
                COUNT(DISTINCT o.jtl_order_id)::int AS orders
         FROM order_items oi
         JOIN orders o ON o.tenant_id = oi.tenant_id AND o.jtl_order_id = oi.order_id
         WHERE oi.tenant_id = ANY($1::uuid[]) AND oi.product_id = $2
           AND o.order_date BETWEEN $3 AND $4
           AND LOWER(COALESCE(o.status, '')) <> 'cancelled'
         GROUP BY period ORDER BY period`,
        [scope.tenantIds, product.jtl_product_id, start, end],
      ),
    ]);

    const summary = summaryRows[0] || {};
    const eligibleMarginLines = Number(summary.eligible_margin_lines || 0);
    const costedMarginLines = Number(summary.costed_margin_lines || 0);
    const marginCoverage = eligibleMarginLines > 0 ? costedMarginLines / eligibleMarginLines : 0;
    const marginAvailable = costedMarginLines > 0 && marginCoverage >= 0.8;
    const stock = inventory.reduce((total: number, row: Record<string, unknown>) => total + Number(row.total || 0), 0);
    const available = inventory.reduce((total: number, row: Record<string, unknown>) => total + Number(row.available || 0), 0);
    const reserved = inventory.reduce((total: number, row: Record<string, unknown>) => total + Number(row.reserved || 0), 0);
    const units = Number(summary.units || 0);
    const periodDays = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1);
    const salesVelocity = units / periodDays;
    const selling = new Set(channels.map((row: Record<string, unknown>) => String(row.channel)));
    const channelsNotSelling = knownChannels.map((row: Record<string, unknown>) => String(row.channel)).filter((channel: string) => !selling.has(channel));
    const performanceClass = Number(summary.revenue || 0) <= 0 ? 'No sales' : units / periodDays >= 1 ? 'Fast-moving' : 'Slow-moving';
    const riskClass = stock <= 0 && units > 0 ? 'Stockout risk' : stock > 0 && units <= 0 ? 'Dead stock' : stock > salesVelocity * 180 ? 'Overstock' : 'Monitor';

    return {
      product,
      summary: {
        ...summary,
        margin_pct: marginAvailable ? summary.margin_pct : null,
        margin_available: marginAvailable,
        margin_cost_coverage_pct: Math.round(marginCoverage * 1000) / 10,
        sales_velocity: salesVelocity,
        performance_class: performanceClass,
        risk_class: riskClass,
      },
      stock: { total: stock, available, reserved },
      inventory,
      channels,
      channels_not_selling: channelsNotSelling,
      orders,
      order_lines: orderLines,
      trend,
      filters: { from: start, to: end },
      freshness: {
        last_product_sync: product.product_synced_at,
        last_inventory_sync: inventory.reduce((latest: string | null, row: Record<string, unknown>) => {
          const value = row.synced_at ? String(row.synced_at) : null;
          return !latest || (value && value > latest) ? value : latest;
        }, null),
        last_order_sync: summary.last_order_sync || null,
      },
    };
  }

  async exportIntelligence(scope: TenantScope, productId: number, filters: ProductFilters): Promise<string> {
    const report = await this.getIntelligence(scope, productId, filters);
    const rows: Record<string, unknown>[] = [
      ...report.channels.map((row: Record<string, unknown>) => ({ record_type: 'channel', ...row })),
      ...report.inventory.map((row: Record<string, unknown>) => ({ record_type: 'warehouse', ...row })),
      ...report.trend.map((row: Record<string, unknown>) => ({ record_type: 'trend', ...row })),
      ...report.orders.map((row: Record<string, unknown>) => ({ record_type: 'order', ...row })),
      ...report.order_lines.map((row: Record<string, unknown>) => ({ record_type: 'order_line', ...row })),
    ];
    const exportRows = rows.length ? rows : [{ record_type: 'summary_only' }];
    const keys = Array.from(new Set(exportRows.flatMap((row) => Object.keys(row))));
    return buildCsv(exportRows, keys.map((key) => ({ key, header: key })), {
      metadata: {
        module: 'product_intelligence',
        product_id: productId,
        sku: report.product.article_number,
        product: report.product.name,
        from: report.filters.from,
        to: report.filters.to,
        total_stock: report.stock.total,
        available_stock: report.stock.available,
        reserved_stock: report.stock.reserved,
        revenue: report.summary.revenue,
        units: report.summary.units,
        orders: report.summary.orders,
        customers: report.summary.customers,
        average_price: report.summary.average_price,
        margin: report.summary.margin_available ? report.summary.margin_pct : 'Margin unavailable',
        margin_cost_coverage_pct: report.summary.margin_cost_coverage_pct,
        returns: report.summary.returns,
        last_sale: report.summary.last_sale,
        sales_velocity: report.summary.sales_velocity,
        channels_not_selling: report.channels_not_selling.join(' | '),
        performance_class: report.summary.performance_class,
        risk_class: report.summary.risk_class,
        complete: true,
        generated_at: new Date().toISOString(),
      },
    });
  }
}
