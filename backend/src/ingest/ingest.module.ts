import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { TenantConnection } from '../entities/tenant-connection.entity';
import { Tenant } from '../entities/tenant.entity';
import { Order } from '../entities/order.entity';
import { OrderItem } from '../entities/order-item.entity';
import { Product } from '../entities/product.entity';
import { Category } from '../entities/category.entity';
import { Customer } from '../entities/customer.entity';
import { Inventory } from '../entities/inventory.entity';
import { SyncLog } from '../entities/sync-log.entity';
import { SyncWatermark } from '../entities/sync-watermark.entity';
import { SyncTrigger } from '../entities/sync-trigger.entity';
import { SyncRun } from '../entities/sync-run.entity';
import { SyncRunBatch } from '../entities/sync-run-batch.entity';
import { InventoryStaging } from '../entities/inventory-staging.entity';
import { SyncEngineInstallation } from '../entities/sync-engine-installation.entity';
import { SyncApiKeyGuard } from '../common/guards/sync-api-key.guard';
import { SyncQueueService } from './sync-queue.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TenantConnection,
      Tenant,
      Order,
      OrderItem,
      Product,
      Category,
      Customer,
      Inventory,
      SyncLog,
      SyncWatermark,
      SyncTrigger,
      SyncRun,
      SyncRunBatch,
      InventoryStaging,
      SyncEngineInstallation,
    ]),
  ],
  controllers: [IngestController],
  providers: [IngestService, SyncApiKeyGuard, SyncQueueService],
  exports: [SyncQueueService],
})
export class IngestModule {}
