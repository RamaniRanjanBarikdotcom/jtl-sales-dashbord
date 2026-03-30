import { Injectable } from '@nestjs/common';
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
        await this.refreshMatviews();
        await this.cache.del(
          `jtl:${tenantId}:${this.moduleToCache(module)}:*`,
        );
        await this.updateWatermark(tenantId, module, (rows || []).length);
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
      };
    } catch (err: any) {
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

  private async upsertRows(
    module: string,
    tenantId: string,
    rows: any[],
  ): Promise<{ inserted: number; updated: number }> {
    if (!rows.length) return { inserted: 0, updated: 0 };

    switch (module) {
      case 'orders': {
        const transformed = rows.map((r) => transformOrders(r, tenantId));
        await this.orderRepo
          .createQueryBuilder()
          .insert()
          .into(Order)
          .values(transformed)
          .orUpdate(
            [
              'gross_revenue',
              'net_revenue',
              'status',
              'jtl_modified_at',
              'updated_at',
              'shipping_cost',
              'channel',
              'region',
              'external_order_number',
              'customer_number',
              'payment_method',
              'shipping_method',
            ],
            ['tenant_id', 'jtl_order_id', 'order_date'],
          )
          .execute();

        // Extract and upsert embedded order items
        const allItems = rows.flatMap((r) =>
          (r.items || []).map((item: any) => ({
            tenant_id: tenantId,
            jtl_item_id: item.kBestellPos,
            order_id: item.kBestellung,
            product_id: item.kArtikel,
            quantity: parseFloat(item.nAnzahl) || 0,
            unit_price_gross: parseFloat(item.fVKPreis) || null,
            unit_price_net: parseFloat(item.fVKPreisNetto) || null,
            unit_cost: parseFloat(item.fEKPreis) || null,
            line_total_gross:
              (parseFloat(item.fVKPreis) || 0) *
              (parseFloat(item.nAnzahl) || 0),
            discount_pct: parseFloat(item.nRabatt) || 0,
          })),
        );
        if (allItems.length > 0) {
          await this.orderItemRepo
            .createQueryBuilder()
            .insert()
            .into(OrderItem)
            .values(allItems)
            .orUpdate(
              [
                'quantity',
                'unit_price_gross',
                'unit_price_net',
                'unit_cost',
                'line_total_gross',
              ],
              ['tenant_id', 'jtl_item_id'],
            )
            .execute();
        }
        return { inserted: transformed.length, updated: allItems.length };
      }

      case 'order_items': {
        const transformed = rows.map((r) => ({
          tenant_id: tenantId,
          jtl_item_id: r.kBestellPos,
          order_id: r.kBestellung,
          product_id: r.kArtikel,
          quantity: parseFloat(r.nAnzahl) || 0,
          unit_price_gross: parseFloat(r.fVKPreis) || null,
          unit_price_net: parseFloat(r.fVKPreisNetto) || null,
          unit_cost: parseFloat(r.fEKPreis) || null,
          line_total_gross:
            (parseFloat(r.fVKPreis) || 0) * (parseFloat(r.nAnzahl) || 0),
          discount_pct: parseFloat(r.nRabatt) || 0,
        }));
        await this.orderItemRepo
          .createQueryBuilder()
          .insert()
          .into(OrderItem)
          .values(transformed)
          .orUpdate(
            [
              'quantity',
              'unit_price_gross',
              'unit_price_net',
              'unit_cost',
              'line_total_gross',
            ],
            ['tenant_id', 'jtl_item_id'],
          )
          .execute();
        return { inserted: transformed.length, updated: 0 };
      }

      case 'products': {
        const { products, categories } = transformProducts(rows, tenantId);
        if (categories.length) {
          await this.categoryRepo
            .createQueryBuilder()
            .insert()
            .into(Category)
            .values(categories)
            .orUpdate(['name'], ['tenant_id', 'jtl_category_id'])
            .execute();
        }
        await this.productRepo
          .createQueryBuilder()
          .insert()
          .into(Product)
          .values(products)
          .orUpdate(
            [
              'name',
              'unit_cost',
              'list_price_net',
              'list_price_gross',
              'stock_quantity',
              'jtl_modified_at',
            ],
            ['tenant_id', 'jtl_product_id'],
          )
          .execute();
        return { inserted: products.length, updated: 0 };
      }

      case 'customers': {
        const transformed = rows.map((r) =>
          transformCustomers(r, tenantId),
        );
        await this.customerRepo
          .createQueryBuilder()
          .insert()
          .into(Customer)
          .values(transformed)
          .orUpdate(
            [
              'email',
              'first_name',
              'last_name',
              'region',
              'jtl_modified_at',
              'updated_at',
            ],
            ['tenant_id', 'jtl_customer_id'],
          )
          .execute();
        return { inserted: transformed.length, updated: 0 };
      }

      case 'inventory': {
        const transformed = rows.map((r) =>
          transformInventory(r, tenantId),
        );
        await this.inventoryRepo
          .createQueryBuilder()
          .insert()
          .into(Inventory)
          .values(transformed)
          .orUpdate(
            [
              'available',
              'reserved',
              'total',
              'is_low_stock',
              'updated_at',
              'warehouse_name',
            ],
            ['tenant_id', 'jtl_product_id', 'jtl_warehouse_id'],
          )
          .execute();
        return { inserted: transformed.length, updated: 0 };
      }

      default:
        return { inserted: 0, updated: 0 };
    }
  }

  private async refreshMatviews() {
    try {
      await this.dataSource.query(`SELECT refresh_all_matviews()`);
    } catch {
      // matviews may not exist yet on first run — ignore silently
    }
  }

  private moduleToCache(module: string): string {
    const map: Record<string, string> = {
      orders: 'sales',
      order_items: 'sales',
      products: 'products',
      customers: 'customers',
      inventory: 'inventory',
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
