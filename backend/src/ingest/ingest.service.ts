import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CacheService } from '../cache/cache.service';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { Product } from '../entities/product.entity';
import { Category } from '../entities/category.entity';
import { Customer } from '../entities/customer.entity';
import { Inventory } from '../entities/inventory.entity';
import { SyncLog } from '../entities/sync-log.entity';
import { SyncWatermark } from '../entities/sync-watermark.entity';
import { transformOrders } from './transformers/orders.transformer';
import { transformProducts } from './transformers/products.transformer';
import { transformCustomers } from './transformers/customers.transformer';
import { transformInventory } from './transformers/inventory.transformer';

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    @InjectRepository(Order) private orderRepo: Repository<Order>,
    @InjectRepository(OrderItem) private orderItemRepo: Repository<OrderItem>,
    @InjectRepository(Product) private productRepo: Repository<Product>,
    @InjectRepository(Category) private categoryRepo: Repository<Category>,
    @InjectRepository(Customer) private customerRepo: Repository<Customer>,
    @InjectRepository(Inventory) private inventoryRepo: Repository<Inventory>,
    @InjectRepository(SyncLog) private syncLogRepo: Repository<SyncLog>,
    @InjectRepository(SyncWatermark)
    private watermarkRepo: Repository<SyncWatermark>,
    private readonly cache: CacheService,
    private readonly dataSource: DataSource,
  ) {}

  async processIngest(body: any): Promise<any> {
    const { module, tenantId, batchIndex, totalBatches, rows, syncStartTime } =
      body;
    const start = Date.now();
    let inserted = 0;
    let updated = 0;

    try {
      const result = await this.upsertRows(module, tenantId, rows || []);
      inserted = result.inserted;
      updated = result.updated;

      const isLastBatch =
        totalBatches === undefined || batchIndex === totalBatches - 1;

      if (isLastBatch) {
        // Only refresh matviews relevant to this module (CONCURRENTLY = no downtime)
        await this.refreshRelevantMatviews(module);

        // Invalidate only the cache namespace for this module
        await this.cache.del(
          `jtl:${tenantId}:${this.moduleToCache(module)}:*`,
        );

        await this.updateWatermark(tenantId, module, (rows || []).length);

        // After orders sync: recompute customer aggregate stats (total orders,
        // revenue, first/last order date, RFM score, segment) from orders table.
        // Runs only once on last batch so large syncs don't trigger this repeatedly.
        if (module === 'orders') {
          await this.recomputeCustomerStats(tenantId);
          // Also invalidate customer cache since their stats changed
          await this.cache.del(`jtl:${tenantId}:customers:*`);
        }
      }

      await this.syncLogRepo.save({
        tenant_id: tenantId,
        job_name: module,
        trigger_type: 'scheduled',
        status: 'ok',
        rows_extracted: (rows || []).length,
        rows_inserted: inserted,
        rows_updated: updated,
        duration_ms: Date.now() - start,
        started_at: syncStartTime ? new Date(syncStartTime) : new Date(),
        completed_at: new Date(),
      });

      return {
        success: true,
        received: (rows || []).length,
        inserted,
        updated,
        batchIndex,
        rowsAccepted: inserted + updated,
      };
    } catch (err: any) {
      this.logger.error(`Ingest failed [${module} batch ${batchIndex}]: ${err.message}`);
      await this.syncLogRepo.save({
        tenant_id: tenantId,
        job_name: module,
        trigger_type: 'scheduled',
        status: 'error',
        rows_extracted: (rows || []).length,
        rows_inserted: 0,
        rows_updated: 0,
        duration_ms: Date.now() - start,
        error_message: err.message,
        started_at: syncStartTime ? new Date(syncStartTime) : new Date(),
        completed_at: new Date(),
      });
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Core upsert logic — uses PostgreSQL json_array_elements bulk upsert with
  // a WHERE clause on DO UPDATE so rows that haven't changed are skipped
  // entirely (no unnecessary writes, safe for lakhs of records).
  // ─────────────────────────────────────────────────────────────────────────
  private async upsertRows(
    module: string,
    tenantId: string,
    rows: any[],
  ): Promise<{ inserted: number; updated: number }> {
    if (!rows.length) return { inserted: 0, updated: 0 };

    switch (module) {
      // ── orders ───────────────────────────────────────────────────────────
      case 'orders': {
        const transformed = rows.map((r) => ({
          ...transformOrders(r, tenantId),
          // Store item count per order (null if items not embedded)
          item_count: (r.items || r.Items || []).length || null,
        }));

        // Bulk upsert orders via JSON parameter — single round-trip to DB.
        // WHERE clause: skip update if nothing actually changed (gross_revenue,
        // status, jtl_modified_at all equal → row is identical, skip write).
        await this.dataSource.query(
          `INSERT INTO orders AS e (
            tenant_id, jtl_order_id, order_date, order_number, customer_id,
            gross_revenue, net_revenue, shipping_cost, status, channel,
            postcode, region, item_count, jtl_modified_at,
            external_order_number, customer_number, payment_method, shipping_method,
            synced_at, updated_at
          )
          SELECT
            (r->>'tenant_id')::uuid,
            (r->>'jtl_order_id')::bigint,
            (r->>'order_date')::date,
            r->>'order_number',
            NULLIF((r->>'customer_id'),'0')::bigint,
            COALESCE((r->>'gross_revenue')::numeric, 0),
            COALESCE((r->>'net_revenue')::numeric,   0),
            COALESCE((r->>'shipping_cost')::numeric,  0),
            COALESCE(r->>'status', 'pending'),
            COALESCE(r->>'channel', 'direct'),
            r->>'postcode',
            r->>'region',
            (r->>'item_count')::integer,
            (r->>'jtl_modified_at')::timestamptz,
            r->>'external_order_number',
            r->>'customer_number',
            r->>'payment_method',
            r->>'shipping_method',
            now(), now()
          FROM json_array_elements($1::json) AS r
          ON CONFLICT (tenant_id, jtl_order_id, order_date) DO UPDATE SET
            gross_revenue         = EXCLUDED.gross_revenue,
            net_revenue           = EXCLUDED.net_revenue,
            shipping_cost         = EXCLUDED.shipping_cost,
            status                = EXCLUDED.status,
            channel               = EXCLUDED.channel,
            item_count            = COALESCE(EXCLUDED.item_count, e.item_count),
            jtl_modified_at       = EXCLUDED.jtl_modified_at,
            external_order_number = EXCLUDED.external_order_number,
            customer_number       = EXCLUDED.customer_number,
            payment_method        = EXCLUDED.payment_method,
            shipping_method       = EXCLUDED.shipping_method,
            updated_at            = now()
          WHERE
            e.gross_revenue     IS DISTINCT FROM EXCLUDED.gross_revenue
            OR e.status         IS DISTINCT FROM EXCLUDED.status
            OR e.jtl_modified_at IS DISTINCT FROM EXCLUDED.jtl_modified_at`,
          [JSON.stringify(transformed)],
        );

        // Extract and upsert embedded order items
        const allItems = rows.flatMap((r) =>
          (r.items || r.Items || []).map((item: any) => {
            const qty   = parseFloat(item.nAnzahl    ?? item.fAnzahl)    || 0;
            const gross = parseFloat(item.fVKPreis   ?? item.fVkBrutto)  || null;
            const net   = parseFloat(item.fVKPreisNetto ?? item.fVkNetto) || null;
            const cost  = parseFloat(item.fEKPreis   ?? item.fEkNetto)   || null;
            return {
              tenant_id:        tenantId,
              jtl_item_id:      item.kBestellPos    ?? item.kAuftragPosition,
              order_id:         item.kBestellung     ?? item.kAuftrag,
              product_id:       item.kArtikel,
              quantity:         qty,
              unit_price_gross: gross,
              unit_price_net:   net,
              unit_cost:        cost,
              line_total_gross: (gross || 0) * qty,
              discount_pct:     parseFloat(item.nRabatt ?? item.fRabatt) || 0,
            };
          }),
        );

        if (allItems.length > 0) {
          await this.dataSource.query(
            `INSERT INTO order_items (
              tenant_id, jtl_item_id, order_id, product_id,
              quantity, unit_price_gross, unit_price_net, unit_cost,
              line_total_gross, discount_pct
            )
            SELECT
              (r->>'tenant_id')::uuid,
              (r->>'jtl_item_id')::bigint,
              (r->>'order_id')::bigint,
              (r->>'product_id')::bigint,
              COALESCE((r->>'quantity')::numeric, 0),
              (r->>'unit_price_gross')::numeric,
              (r->>'unit_price_net')::numeric,
              (r->>'unit_cost')::numeric,
              COALESCE((r->>'line_total_gross')::numeric, 0),
              COALESCE((r->>'discount_pct')::numeric, 0)
            FROM json_array_elements($1::json) AS r
            ON CONFLICT (tenant_id, jtl_item_id) DO UPDATE SET
              quantity         = EXCLUDED.quantity,
              unit_price_gross = EXCLUDED.unit_price_gross,
              unit_price_net   = EXCLUDED.unit_price_net,
              unit_cost        = EXCLUDED.unit_cost,
              line_total_gross = EXCLUDED.line_total_gross,
              discount_pct     = EXCLUDED.discount_pct
            WHERE
              order_items.quantity         IS DISTINCT FROM EXCLUDED.quantity
              OR order_items.unit_price_gross IS DISTINCT FROM EXCLUDED.unit_price_gross`,
            [JSON.stringify(allItems)],
          );
        }

        return { inserted: transformed.length, updated: allItems.length };
      }

      // ── order_items (standalone module) ──────────────────────────────────
      case 'order_items': {
        const transformed = rows.map((r) => {
          const qty   = parseFloat(r.nAnzahl    ?? r.fAnzahl)    || 0;
          const gross = parseFloat(r.fVKPreis   ?? r.fVkBrutto)  || null;
          return {
            tenant_id:        tenantId,
            jtl_item_id:      r.kBestellPos    ?? r.kAuftragPosition,
            order_id:         r.kBestellung     ?? r.kAuftrag,
            product_id:       r.kArtikel,
            quantity:         qty,
            unit_price_gross: gross,
            unit_price_net:   parseFloat(r.fVKPreisNetto ?? r.fVkNetto) || null,
            unit_cost:        parseFloat(r.fEKPreis      ?? r.fEkNetto) || null,
            line_total_gross: (gross || 0) * qty,
            discount_pct:     parseFloat(r.nRabatt ?? r.fRabatt) || 0,
          };
        });

        await this.dataSource.query(
          `INSERT INTO order_items (
            tenant_id, jtl_item_id, order_id, product_id,
            quantity, unit_price_gross, unit_price_net, unit_cost,
            line_total_gross, discount_pct
          )
          SELECT
            (r->>'tenant_id')::uuid,
            (r->>'jtl_item_id')::bigint,
            (r->>'order_id')::bigint,
            (r->>'product_id')::bigint,
            COALESCE((r->>'quantity')::numeric, 0),
            (r->>'unit_price_gross')::numeric,
            (r->>'unit_price_net')::numeric,
            (r->>'unit_cost')::numeric,
            COALESCE((r->>'line_total_gross')::numeric, 0),
            COALESCE((r->>'discount_pct')::numeric, 0)
          FROM json_array_elements($1::json) AS r
          ON CONFLICT (tenant_id, jtl_item_id) DO UPDATE SET
            quantity         = EXCLUDED.quantity,
            unit_price_gross = EXCLUDED.unit_price_gross,
            unit_price_net   = EXCLUDED.unit_price_net,
            unit_cost        = EXCLUDED.unit_cost,
            line_total_gross = EXCLUDED.line_total_gross
          WHERE
            order_items.quantity         IS DISTINCT FROM EXCLUDED.quantity
            OR order_items.unit_price_gross IS DISTINCT FROM EXCLUDED.unit_price_gross`,
          [JSON.stringify(transformed)],
        );

        return { inserted: transformed.length, updated: 0 };
      }

      // ── products ─────────────────────────────────────────────────────────
      case 'products': {
        const { products, categories } = transformProducts(rows, tenantId);

        if (categories.length) {
          await this.dataSource.query(
            `INSERT INTO categories (tenant_id, jtl_category_id, name)
            SELECT
              (r->>'tenant_id')::uuid,
              (r->>'jtl_category_id')::bigint,
              r->>'name'
            FROM json_array_elements($1::json) AS r
            ON CONFLICT (tenant_id, jtl_category_id) DO UPDATE SET
              name = EXCLUDED.name
            WHERE categories.name IS DISTINCT FROM EXCLUDED.name`,
            [JSON.stringify(categories)],
          );
        }

        // Smart upsert: skip if jtl_modified_at, price, and stock are all unchanged
        await this.dataSource.query(
          `INSERT INTO products AS e (
            tenant_id, jtl_product_id, article_number, name, category_id,
            ean, unit_cost, list_price_net, list_price_gross, weight_kg,
            stock_quantity, jtl_modified_at, synced_at, updated_at
          )
          SELECT
            (r->>'tenant_id')::uuid,
            (r->>'jtl_product_id')::bigint,
            r->>'article_number',
            COALESCE(r->>'name', 'Unknown'),
            (r->>'category_id')::bigint,
            r->>'ean',
            (r->>'unit_cost')::numeric,
            (r->>'list_price_net')::numeric,
            (r->>'list_price_gross')::numeric,
            (r->>'weight_kg')::numeric,
            COALESCE((r->>'stock_quantity')::numeric, 0),
            (r->>'jtl_modified_at')::timestamptz,
            now(), now()
          FROM json_array_elements($1::json) AS r
          ON CONFLICT (tenant_id, jtl_product_id) DO UPDATE SET
            name             = EXCLUDED.name,
            category_id      = COALESCE(EXCLUDED.category_id, e.category_id),
            unit_cost        = EXCLUDED.unit_cost,
            list_price_net   = EXCLUDED.list_price_net,
            list_price_gross = EXCLUDED.list_price_gross,
            stock_quantity   = EXCLUDED.stock_quantity,
            jtl_modified_at  = EXCLUDED.jtl_modified_at,
            updated_at       = now()
          WHERE
            e.jtl_modified_at  IS DISTINCT FROM EXCLUDED.jtl_modified_at
            OR e.stock_quantity IS DISTINCT FROM EXCLUDED.stock_quantity
            OR e.list_price_net IS DISTINCT FROM EXCLUDED.list_price_net`,
          [JSON.stringify(products)],
        );

        return { inserted: products.length, updated: 0 };
      }

      // ── customers ────────────────────────────────────────────────────────
      case 'customers': {
        const transformed = rows.map((r) => transformCustomers(r, tenantId));

        // Only upsert contact/address fields here.
        // Aggregate stats (total_orders, total_revenue, rfm_score, segment, ltv,
        // first/last_order_date, days_since_last_order) are computed by
        // recomputeCustomerStats() after the orders sync — NOT here.
        // This prevents the customer sync from overwriting computed stats with zeros.
        await this.dataSource.query(
          `INSERT INTO customers AS e (
            tenant_id, jtl_customer_id, email, first_name, last_name,
            company, postcode, city, country_code, region,
            jtl_modified_at, synced_at, updated_at
          )
          SELECT
            (r->>'tenant_id')::uuid,
            (r->>'jtl_customer_id')::bigint,
            r->>'email',
            r->>'first_name',
            r->>'last_name',
            r->>'company',
            r->>'postcode',
            r->>'city',
            COALESCE(r->>'country_code', 'DE'),
            r->>'region',
            (r->>'jtl_modified_at')::timestamptz,
            now(), now()
          FROM json_array_elements($1::json) AS r
          ON CONFLICT (tenant_id, jtl_customer_id) DO UPDATE SET
            email           = EXCLUDED.email,
            first_name      = EXCLUDED.first_name,
            last_name       = EXCLUDED.last_name,
            company         = EXCLUDED.company,
            postcode        = EXCLUDED.postcode,
            city            = EXCLUDED.city,
            country_code    = EXCLUDED.country_code,
            region          = EXCLUDED.region,
            jtl_modified_at = EXCLUDED.jtl_modified_at,
            updated_at      = now()
          WHERE
            e.jtl_modified_at IS DISTINCT FROM EXCLUDED.jtl_modified_at
            OR e.email IS DISTINCT FROM EXCLUDED.email`,
          [JSON.stringify(transformed)],
        );

        return { inserted: transformed.length, updated: 0 };
      }

      // ── inventory ────────────────────────────────────────────────────────
      case 'inventory': {
        const transformed = rows.map((r) => transformInventory(r, tenantId));

        // Inventory always updates — stock changes happen without a modified_at.
        // WHERE clause still skips unchanged rows (available/reserved/total equal).
        await this.dataSource.query(
          `INSERT INTO inventory (
            tenant_id, jtl_product_id, jtl_warehouse_id,
            warehouse_name, available, reserved, total,
            reorder_point, is_low_stock, synced_at, updated_at
          )
          SELECT
            (r->>'tenant_id')::uuid,
            (r->>'jtl_product_id')::bigint,
            COALESCE((r->>'jtl_warehouse_id')::bigint, 0),
            r->>'warehouse_name',
            COALESCE((r->>'available')::numeric,     0),
            COALESCE((r->>'reserved')::numeric,      0),
            COALESCE((r->>'total')::numeric,         0),
            COALESCE((r->>'reorder_point')::numeric, 0),
            COALESCE((r->>'is_low_stock')::boolean,  false),
            now(), now()
          FROM json_array_elements($1::json) AS r
          ON CONFLICT (tenant_id, jtl_product_id, jtl_warehouse_id) DO UPDATE SET
            warehouse_name = EXCLUDED.warehouse_name,
            available      = EXCLUDED.available,
            reserved       = EXCLUDED.reserved,
            total          = EXCLUDED.total,
            reorder_point  = EXCLUDED.reorder_point,
            is_low_stock   = EXCLUDED.is_low_stock,
            updated_at     = now()
          WHERE
            inventory.available IS DISTINCT FROM EXCLUDED.available
            OR inventory.reserved IS DISTINCT FROM EXCLUDED.reserved
            OR inventory.total    IS DISTINCT FROM EXCLUDED.total`,
          [JSON.stringify(transformed)],
        );

        // Keep products.stock_quantity in sync with inventory totals
        // so inventory KPI queries on the products table stay accurate.
        await this.dataSource.query(
          `UPDATE products p
          SET stock_quantity = sub.total_available,
              updated_at     = now()
          FROM (
            SELECT jtl_product_id, SUM(available) AS total_available
            FROM inventory
            WHERE tenant_id = $1
            GROUP BY jtl_product_id
          ) sub
          WHERE p.tenant_id = $1
            AND p.jtl_product_id = sub.jtl_product_id
            AND p.stock_quantity IS DISTINCT FROM sub.total_available`,
          [tenantId],
        );

        return { inserted: transformed.length, updated: 0 };
      }

      default:
        return { inserted: 0, updated: 0 };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Recompute customer aggregate stats from the orders table.
  // Called after every orders sync (last batch only).
  //
  // Computes: total_orders, total_revenue, first_order_date, last_order_date,
  // days_since_last_order, ltv, rfm_score (R/F/M 1-5), segment.
  //
  // With idx_orders_customer_id index this runs in seconds even for 500k+ orders.
  // ─────────────────────────────────────────────────────────────────────────
  private async recomputeCustomerStats(tenantId: string) {
    try {
      await this.dataSource.query(
        `UPDATE customers c
        SET
          total_orders          = sub.cnt,
          total_revenue         = sub.revenue,
          first_order_date      = sub.first_date,
          last_order_date       = sub.last_date,
          days_since_last_order = GREATEST((CURRENT_DATE - sub.last_date)::integer, 0),
          ltv                   = sub.revenue,
          rfm_score             = sub.rfm,
          segment               = sub.seg,
          updated_at            = now()
        FROM (
          SELECT
            customer_id AS jtl_cust_id,
            COUNT(*)                              AS cnt,
            ROUND(SUM(gross_revenue)::numeric, 2) AS revenue,
            MIN(order_date)                       AS first_date,
            MAX(order_date)                       AS last_date,
            -- RFM score: Recency(1-5) || Frequency(1-5) || Monetary(1-5)
            CASE
              WHEN (CURRENT_DATE - MAX(order_date)) <=  30 THEN '5'
              WHEN (CURRENT_DATE - MAX(order_date)) <=  90 THEN '4'
              WHEN (CURRENT_DATE - MAX(order_date)) <= 180 THEN '3'
              WHEN (CURRENT_DATE - MAX(order_date)) <= 365 THEN '2'
              ELSE '1'
            END ||
            CASE
              WHEN COUNT(*) >= 20 THEN '5'
              WHEN COUNT(*) >= 10 THEN '4'
              WHEN COUNT(*) >= 5  THEN '3'
              WHEN COUNT(*) >= 2  THEN '2'
              ELSE '1'
            END ||
            CASE
              WHEN SUM(gross_revenue) >= 10000 THEN '5'
              WHEN SUM(gross_revenue) >=  5000 THEN '4'
              WHEN SUM(gross_revenue) >=  2000 THEN '3'
              WHEN SUM(gross_revenue) >=   500 THEN '2'
              ELSE '1'
            END AS rfm,
            -- Segment based on RFM
            CASE
              WHEN (CURRENT_DATE - MAX(order_date)) > 365 THEN 'Churned'
              WHEN (CURRENT_DATE - MAX(order_date)) > 180 THEN 'At-Risk'
              WHEN SUM(gross_revenue) >= 5000
                AND (CURRENT_DATE - MAX(order_date)) <= 90  THEN 'VIP'
              WHEN SUM(gross_revenue) >= 1000
                AND COUNT(*) >= 3                           THEN 'Regular'
              WHEN COUNT(*) = 1
                AND (CURRENT_DATE - MAX(order_date)) <= 90  THEN 'New'
              ELSE 'Casual'
            END AS seg
          FROM orders
          WHERE tenant_id = $1
            AND status NOT IN ('cancelled', 'returned')
            AND customer_id IS NOT NULL
          GROUP BY customer_id
        ) sub
        WHERE c.tenant_id = $1
          AND c.jtl_customer_id = sub.jtl_cust_id`,
        [tenantId],
      );
      this.logger.log(`Customer stats recomputed for tenant ${tenantId}`);
    } catch (err: any) {
      // Non-fatal: log and continue — stats will be refreshed on next sync
      this.logger.warn(`Customer stats recomputation failed: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Only refresh matviews that are actually affected by the synced module.
  // CONCURRENTLY means reads are never blocked during refresh.
  // Marketing matview is not touched by sync (no sync module for it yet).
  // ─────────────────────────────────────────────────────────────────────────
  private async refreshRelevantMatviews(module: string) {
    const matviewMap: Record<string, string[]> = {
      orders:      ['mv_monthly_kpis', 'mv_daily_summary', 'mv_product_performance'],
      order_items: ['mv_product_performance'],
      products:    ['mv_product_performance'],
      customers:   [],                         // stats handled by recomputeCustomerStats
      inventory:   ['mv_inventory_summary'],
    };

    const views = matviewMap[module] || [];
    for (const view of views) {
      try {
        await this.dataSource.query(
          `REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`,
        );
      } catch {
        // Silently ignore — matview may not exist on first startup
      }
    }
  }

  private moduleToCache(module: string): string {
    const map: Record<string, string> = {
      orders:      'sales',
      order_items: 'sales',
      products:    'products',
      customers:   'customers',
      inventory:   'inventory',
    };
    return map[module] || module;
  }

  private async updateWatermark(
    tenantId: string,
    module: string,
    rowCount: number,
  ) {
    const existing = await this.watermarkRepo.findOne({
      where: { tenant_id: tenantId, job_name: module },
    });
    if (existing) {
      existing.last_synced_at = new Date();
      existing.last_row_count = rowCount;
      await this.watermarkRepo.save(existing);
    } else {
      await this.watermarkRepo.save({
        tenant_id: tenantId,
        job_name: module,
        last_synced_at: new Date(),
        last_row_count: rowCount,
      });
    }
  }
}
