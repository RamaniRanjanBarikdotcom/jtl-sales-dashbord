import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CacheService } from '../cache/cache.service';
import { AuditService } from '../common/audit/audit.service';
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

const VALID_SYNC_MODULES = new Set([
  'orders',
  'order_items',
  'products',
  'customers',
  'inventory',
]);

type SyncModule = 'orders' | 'order_items' | 'products' | 'customers' | 'inventory';

interface IngestPayload {
  module: SyncModule;
  tenantId?: string;
  batchIndex?: number;
  totalBatches?: number;
  rows?: unknown[];
  syncStartTime?: string | Date;
  watermarkTime?: string | Date;
}

interface QueryExecutor {
  query<T = unknown>(query: string, parameters?: unknown[]): Promise<T>;
}

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);
  private readonly maxRetryAttempts = Math.max(
    1,
    Number.parseInt(process.env.INGEST_RETRY_MAX_ATTEMPTS || '3', 10) || 3,
  );
  private readonly retryBaseDelayMs = Math.max(
    100,
    Number.parseInt(process.env.INGEST_RETRY_BASE_DELAY_MS || '400', 10) || 400,
  );
  private readonly bulkIdChunkSize = Math.max(
    500,
    Number.parseInt(process.env.INGEST_BULK_ID_CHUNK || '5000', 10) || 5000,
  );

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
    private readonly audit: AuditService,
  ) {}

  private isRetryableIngestError(err: unknown): boolean {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: string }).code ?? '')
        : '';
    if (['40001', '40P01', '53300', '57P01'].includes(code)) return true;
    if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE'].includes(code)) return true;

    const message = err instanceof Error ? err.message.toLowerCase() : '';
    return (
      message.includes('deadlock') ||
      message.includes('could not serialize access') ||
      message.includes('connection terminated') ||
      message.includes('timeout') ||
      message.includes('too many clients')
    );
  }

  private async delay(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private chunkArray<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      out.push(items.slice(i, i + size));
    }
    return out;
  }

  async processIngest(body: IngestPayload, attempt = 1): Promise<Record<string, unknown>> {
    const {
      module,
      tenantId,
      batchIndex,
      totalBatches,
      rows,
      syncStartTime,
      watermarkTime,
    } = body;
    const start = Date.now();
    let inserted = 0;
    let updated = 0;
    const safeRows = rows || [];
    const safeBatchIndex = batchIndex ?? 0;
    if (!tenantId) {
      throw new Error('tenantId is required for ingest');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      if (!VALID_SYNC_MODULES.has(module)) {
        throw new Error(`Unsupported sync module: ${module}`);
      }
      const isLastBatch =
        totalBatches === undefined || batchIndex === totalBatches - 1;
      const result = await this.upsertRows(
        module,
        tenantId,
        safeRows,
        safeBatchIndex,
        isLastBatch,
        queryRunner.manager,
      );
      inserted = result.inserted;
      updated = result.updated;

      if (isLastBatch) {
        // For product full-window syncs, deactivate products that were not seen
        // in this sync run (resume-safe because all seen rows get synced_at touched).
        if (module === 'products') {
          await this.deactivateStaleProducts(
            tenantId,
            syncStartTime,
            watermarkTime,
            queryRunner.manager,
          );
        }

        await this.updateWatermark(tenantId, module, safeRows.length, queryRunner.manager);

        // After orders OR customers sync: recompute customer aggregate stats
        // (total orders, revenue, first/last order date, RFM score, segment).
        // Runs on the last batch only — batch index 0-based, totalBatches passed via body.
        if (module === 'orders' || module === 'customers') {
          await this.recomputeCustomerStats(tenantId, queryRunner.manager);
        }
      }

      await queryRunner.commitTransaction();
      await queryRunner.release();

      if (isLastBatch) {
        try {
          // Only refresh matviews relevant to this module (CONCURRENTLY = no downtime)
          await this.refreshRelevantMatviews(module);
        } catch (postCommitErr: unknown) {
          const message = postCommitErr instanceof Error ? postCommitErr.message : 'unknown matview post-commit error';
          this.logger.warn(`Post-commit matview refresh failed for ${module}: ${message}`);
        }

        try {
          // Invalidate only the cache namespace for this module
          await this.cache.del(`jtl:${tenantId}:${this.moduleToCache(module)}:*`);
          // Invalidate customer cache so dashboard shows fresh computed stats
          if (module === 'orders' || module === 'customers') {
            await this.cache.del(`jtl:${tenantId}:customers:*`);
          }
        } catch (postCommitErr: unknown) {
          const message = postCommitErr instanceof Error ? postCommitErr.message : 'unknown cache post-commit error';
          this.logger.warn(`Post-commit cache invalidation failed for ${module}: ${message}`);
        }
      }

      await this.syncLogRepo.save({
        tenant_id: tenantId,
        job_name: module,
        trigger_type: 'scheduled',
        status: 'ok',
        rows_extracted: safeRows.length,
        rows_inserted: inserted,
        rows_updated: updated,
        duration_ms: Date.now() - start,
        started_at: syncStartTime ? new Date(syncStartTime) : new Date(),
        completed_at: new Date(),
      });
      await this.audit.log({
        action: 'sync.ingest.success',
        tenantId,
        metadata: {
          module,
          batchIndex: safeBatchIndex,
          totalBatches: totalBatches ?? null,
          received: safeRows.length,
          inserted,
          updated,
        },
      });

      return {
        success: true,
        received: safeRows.length,
        inserted,
        updated,
        batchIndex,
        rowsAccepted: inserted + updated,
      };
    } catch (err: unknown) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      if (!queryRunner.isReleased) {
        await queryRunner.release();
      }
      if (this.isRetryableIngestError(err) && attempt < this.maxRetryAttempts) {
        const jitter = Math.floor(Math.random() * 120);
        const delayMs = this.retryBaseDelayMs * 2 ** (attempt - 1) + jitter;
        const message = err instanceof Error ? err.message : 'unknown ingest error';
        this.logger.warn(
          `Transient ingest failure [${module}] attempt ${attempt}/${this.maxRetryAttempts}. Retrying in ${delayMs}ms. Error: ${message}`,
        );
        await this.audit.log({
          action: 'sync.ingest.retry',
          tenantId,
          metadata: {
            module,
            attempt,
            maxAttempts: this.maxRetryAttempts,
            delayMs,
            error: message,
          },
        });
        await this.delay(delayMs);
        return this.processIngest(body, attempt + 1);
      }

      // Log full error including stack/detail so the root cause is visible in backend logs
      const message = err instanceof Error ? err.message : 'Unknown ingest error';
      const stack = err instanceof Error ? err.stack : '';
      this.logger.error(
        `Ingest failed [${module} batch ${batchIndex ?? '?'}/${totalBatches ?? '?'}]: ${message}`,
        stack,
      );
      await this.syncLogRepo.save({
        tenant_id: tenantId,
        job_name: module,
        trigger_type: 'scheduled',
        status: 'error',
        rows_extracted: safeRows.length,
        rows_inserted: 0,
        rows_updated: 0,
        duration_ms: Date.now() - start,
        error_message: message,
        started_at: syncStartTime ? new Date(syncStartTime) : new Date(),
        completed_at: new Date(),
      });
      await this.audit.log({
        action: 'sync.ingest.failure',
        tenantId,
        metadata: {
          module,
          batchIndex: safeBatchIndex,
          totalBatches: totalBatches ?? null,
          received: safeRows.length,
          error: message,
        },
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
    module: SyncModule,
    tenantId: string,
    rows: unknown[],
    batchIndex: number = 0,
    isLastBatch: boolean = false,
    executor: QueryExecutor = this.dataSource,
  ): Promise<{ inserted: number; updated: number }> {
    if (!rows.length) return { inserted: 0, updated: 0 };
    const sourceRows = rows as Array<Record<string, unknown>>;

    switch (module) {
      // ── orders ───────────────────────────────────────────────────────────
      case 'orders': {
        const transformed = sourceRows.map((r) => ({
          ...transformOrders(r, tenantId),
          // .NET sync engine sends itemsSummary (STRING_AGG comma string), not an array.
          // Old TS engine sent items[]. Support both.
          item_count:
            (r.itemsSummary || r.ItemsSummary)
              ? String(r.itemsSummary ?? r.ItemsSummary)
                  .split(',')
                  .filter((s: string) => s.trim().length > 0).length
              : ((Array.isArray(r.items) ? r.items : Array.isArray(r.Items) ? r.Items : []).length || null),
        }));

        // Bulk upsert orders via JSON parameter — single round-trip to DB.
        // WHERE clause: skip update if nothing actually changed (gross_revenue,
        // status, jtl_modified_at all equal → row is identical, skip write).
        await executor.query(
          `INSERT INTO orders AS e (
            tenant_id, jtl_order_id, order_date, order_number, customer_id,
            gross_revenue, net_revenue, shipping_cost, status, channel,
            postcode, city, country, region, item_count, jtl_modified_at,
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
            NULLIF(LEFT(COALESCE(r->>'postcode', ''), 32), ''),
            r->>'city',
            r->>'country',
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
            postcode              = COALESCE(EXCLUDED.postcode, e.postcode),
            city                  = COALESCE(EXCLUDED.city, e.city),
            country               = COALESCE(EXCLUDED.country, e.country),
            region                = COALESCE(EXCLUDED.region, e.region),
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
        const allItems = sourceRows.flatMap((r) => {
          const maybeItems = Array.isArray(r.items)
            ? r.items
            : (Array.isArray(r.Items) ? r.Items : []);
          return maybeItems.map((item: unknown) => {
            const raw = item as Record<string, unknown>;
            const qty = parseFloat(String(raw.nAnzahl ?? raw.fAnzahl ?? 0)) || 0;
            const gross = parseFloat(String(raw.fVKPreis ?? raw.fVkBrutto ?? '')) || null;
            const net = parseFloat(String(raw.fVKPreisNetto ?? raw.fVkNetto ?? '')) || null;
            const cost = parseFloat(String(raw.fEKPreis ?? raw.fEkNetto ?? '')) || null;
            return {
              tenant_id:        tenantId,
              jtl_item_id:      raw.kBestellPos    ?? raw.kAuftragPosition,
              order_id:         raw.kBestellung     ?? raw.kAuftrag,
              product_id:       raw.kArtikel,
              quantity:         qty,
              unit_price_gross: gross,
              unit_price_net:   net,
              unit_cost:        cost,
              line_total_gross: (gross || 0) * qty,
              discount_pct:     parseFloat(String(raw.nRabatt ?? raw.fRabatt ?? 0)) || 0,
            };
          });
        });

        if (allItems.length > 0) {
          // Filter out items with null/undefined jtl_item_id to avoid NOT NULL violations
          const validItems = allItems.filter((item) => item.jtl_item_id != null && item.jtl_item_id !== 0);

          if (validItems.length > 0) {
            await executor.query(
              `INSERT INTO order_items (
                tenant_id, jtl_item_id, order_id, product_id,
                quantity, unit_price_gross, unit_price_net, unit_cost,
                line_total_gross, discount_pct
              )
              SELECT
                (r->>'tenant_id')::uuid,
                (r->>'jtl_item_id')::bigint,
                (r->>'order_id')::bigint,
                NULLIF((r->>'product_id'),'0')::bigint,
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
              [JSON.stringify(validItems)],
            );
          }

          // Only run the expensive full-table-scan updates on the LAST batch.
          // Running on every batch would be O(n²) — for 700 batches of 100 orders
          // with 50K total items, that's 35M row-scans per sync run.
          if (isLastBatch) {
            // Compute cost_of_goods and gross_margin on orders from their line items.
            await executor.query(
              `UPDATE orders o
              SET
                cost_of_goods = sub.total_cost,
                gross_margin  = CASE
                  WHEN o.gross_revenue > 0 AND sub.total_cost > 0
                  THEN ROUND((o.gross_revenue - sub.total_cost) / o.gross_revenue * 100, 2)
                  ELSE 0
                END,
                updated_at = now()
              FROM (
                SELECT order_id, SUM(quantity * unit_cost) AS total_cost
                FROM order_items
                WHERE tenant_id = $1
                  AND unit_cost IS NOT NULL AND unit_cost > 0
                GROUP BY order_id
              ) sub
              WHERE o.tenant_id = $1
                AND o.jtl_order_id = sub.order_id
                AND sub.total_cost > 0`,
              [tenantId],
            );

            // Update products.unit_cost from average order-item cost where product cost = 0.
            await executor.query(
              `UPDATE products p
              SET unit_cost  = sub.avg_cost,
                  updated_at = now()
              FROM (
                SELECT product_id, ROUND(AVG(unit_cost)::numeric, 4) AS avg_cost
                FROM order_items
                WHERE tenant_id = $1
                  AND unit_cost IS NOT NULL AND unit_cost > 0
                GROUP BY product_id
              ) sub
              WHERE p.tenant_id = $1
                AND p.jtl_product_id = sub.product_id
                AND COALESCE(p.unit_cost, 0) = 0
                AND sub.avg_cost > 0`,
              [tenantId],
            );
          }
        }

        return { inserted: transformed.length, updated: allItems.length };
      }

      // ── order_items (standalone module) ──────────────────────────────────
      case 'order_items': {
        const transformed = sourceRows.map((r) => {
          const qty = parseFloat(String(r.nAnzahl ?? r.fAnzahl ?? 0)) || 0;
          const gross = parseFloat(String(r.fVKPreis ?? r.fVkBrutto ?? '')) || null;
          return {
            tenant_id:        tenantId,
            jtl_item_id:      r.kBestellPos    ?? r.kAuftragPosition,
            order_id:         r.kBestellung     ?? r.kAuftrag,
            product_id:       r.kArtikel,
            quantity:         qty,
            unit_price_gross: gross,
            unit_price_net:   parseFloat(String(r.fVKPreisNetto ?? r.fVkNetto ?? '')) || null,
            unit_cost:        parseFloat(String(r.fEKPreis      ?? r.fEkNetto ?? '')) || null,
            line_total_gross: (gross || 0) * qty,
            discount_pct:     parseFloat(String(r.nRabatt ?? r.fRabatt ?? 0)) || 0,
          };
        });

        await executor.query(
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
        const { products, categories } = transformProducts(sourceRows, tenantId);

        if (categories.length) {
          await executor.query(
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
        await executor.query(
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

        // Touch synced_at for all rows seen in this batch (including unchanged rows
        // skipped by DO UPDATE WHERE clause). This gives us a reliable marker for
        // end-of-sync stale deactivation on the last batch.
        if (products.length > 0) {
          const activeIds = products.map((p) => p.jtl_product_id);
          const chunks = this.chunkArray(activeIds, this.bulkIdChunkSize);
          for (const ids of chunks) {
            await executor.query(
              `UPDATE products
               SET is_active = true, synced_at = now(), updated_at = now()
               WHERE tenant_id = $1
                 AND jtl_product_id = ANY($2::bigint[])`,
              [tenantId, ids],
            );
          }
        }

        return { inserted: products.length, updated: 0 };
      }

      // ── customers ────────────────────────────────────────────────────────
      case 'customers': {
        const transformed = sourceRows.map((r) => transformCustomers(r, tenantId));

        // Only upsert contact/address fields here.
        // Aggregate stats (total_orders, total_revenue, rfm_score, segment, ltv,
        // first/last_order_date, days_since_last_order) are computed by
        // recomputeCustomerStats() after the orders sync — NOT here.
        // This prevents the customer sync from overwriting computed stats with zeros.
        await executor.query(
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
            NULLIF(LEFT(COALESCE(r->>'postcode', ''), 32), ''),
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
        const transformed = sourceRows.map((r) => transformInventory(r, tenantId));

        // Inventory is a full snapshot — delete ALL existing rows for this tenant
        // on the first batch so stale per-warehouse records (from old kWarenLager=0
        // hardcoding or removed warehouses) don't linger and double-count stock.
        if (batchIndex === 0) {
          await executor.query(
            `DELETE FROM inventory WHERE tenant_id = $1`,
            [tenantId],
          );
        }

        // Inventory always updates — stock changes happen without a modified_at.
        // WHERE clause still skips unchanged rows (available/reserved/total equal).
        await executor.query(
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
        await executor.query(
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

  private async deactivateStaleProducts(
    tenantId: string,
    syncStartTime?: string | Date,
    watermarkTime?: string | Date,
    executor: QueryExecutor = this.dataSource,
  ) {
    if (!syncStartTime) {
      this.logger.warn(
        `Skipping stale-product deactivation for tenant ${tenantId}: missing syncStartTime`,
      );
      return;
    }

    const syncStart = new Date(syncStartTime);
    if (Number.isNaN(syncStart.getTime())) {
      this.logger.warn(
        `Skipping stale-product deactivation for tenant ${tenantId}: invalid syncStartTime "${syncStartTime}"`,
      );
      return;
    }

    // Product sync is incremental by default (dMod window). Deactivate stale rows
    // only on full-catalog windows (watermark around bootstrap epoch) to avoid
    // deactivating unchanged products that were not part of the incremental delta.
    const watermark = watermarkTime ? new Date(watermarkTime) : null;
    const isFullCatalogWindow =
      watermark !== null &&
      !Number.isNaN(watermark.getTime()) &&
      watermark <= new Date('2000-01-02T00:00:00.000Z');
    if (!isFullCatalogWindow) {
      return;
    }

    await executor.query(
      `UPDATE products
       SET is_active = false, updated_at = now()
       WHERE tenant_id = $1
         AND is_active = true
         AND synced_at < $2::timestamptz`,
      [tenantId, syncStart.toISOString()],
    );
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
  private async recomputeCustomerStats(
    tenantId: string,
    executor: QueryExecutor = this.dataSource,
  ) {
    try {
      await executor.query(
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
    } catch (err: unknown) {
      // Non-fatal: log and continue — stats will be refreshed on next sync
      const message = err instanceof Error ? err.message : 'unknown recompute error';
      this.logger.warn(`Customer stats recomputation failed: ${message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Only refresh matviews that are actually affected by the synced module.
  // CONCURRENTLY means reads are never blocked during refresh.

  // ─────────────────────────────────────────────────────────────────────────
  private async refreshRelevantMatviews(module: SyncModule) {
    const matviewMap: Record<string, string[]> = {
      orders:      ['mv_monthly_kpis', 'mv_daily_summary', 'mv_product_performance'],
      order_items: ['mv_product_performance'],
      products:    ['mv_product_performance'],
      customers:   [],                         // stats handled by recomputeCustomerStats
      inventory:   ['mv_inventory_summary'],
    };
    const refreshSqlByView: Record<string, string> = {
      mv_monthly_kpis: 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_kpis',
      mv_daily_summary: 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_summary',
      mv_product_performance: 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_product_performance',
      mv_inventory_summary: 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_inventory_summary',
    };

    const views = matviewMap[module] || [];
    for (const view of views) {
      try {
        const refreshSql = refreshSqlByView[view];
        if (!refreshSql) {
          this.logger.warn(`Skipping unknown matview in refresh map: ${view}`);
          continue;
        }
        await this.dataSource.query(
          refreshSql,
        );
        this.logger.log(`Refreshed matview: ${view}`);
      } catch (err: unknown) {
        // Log but don't throw — matview may not exist on first startup
        const message = err instanceof Error ? err.message : 'unknown matview refresh error';
        this.logger.warn(`Failed to refresh matview ${view}: ${message}`);
      }
    }
  }

  private moduleToCache(module: SyncModule): string {
    const map: Record<string, string> = {
      orders:      'sales',
      order_items: 'sales',
      products:    'products',
      customers:   'customers',
      inventory:   'inventory',
    };
    if (!map[module]) {
      throw new Error(`Invalid cache namespace module: ${module}`);
    }
    return map[module];
  }

  private async updateWatermark(
    tenantId: string,
    module: SyncModule,
    rowCount: number,
    executor: QueryExecutor = this.dataSource,
  ) {
    await executor.query(
      `INSERT INTO sync_watermarks (tenant_id, job_name, last_synced_at, last_row_count)
       VALUES ($1::uuid, $2, now(), $3)
       ON CONFLICT (tenant_id, job_name) DO UPDATE SET
         last_synced_at = EXCLUDED.last_synced_at,
         last_row_count = EXCLUDED.last_row_count`,
      [tenantId, module, rowCount],
    );
  }
}
