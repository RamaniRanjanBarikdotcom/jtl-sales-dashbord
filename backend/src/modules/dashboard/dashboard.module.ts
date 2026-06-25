import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { TenantContextModule } from '../../common/tenant-context.module';
import { SalesModule } from '../sales/sales.module';
import { ProductsModule } from '../products/products.module';
import { CustomersModule } from '../customers/customers.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [
    TenantContextModule,
    SalesModule,
    ProductsModule,
    CustomersModule,
    InventoryModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
