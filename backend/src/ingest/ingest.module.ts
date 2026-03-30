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
    ]),
  ],
  controllers: [IngestController],
  providers: [IngestService],
})
export class IngestModule {}
