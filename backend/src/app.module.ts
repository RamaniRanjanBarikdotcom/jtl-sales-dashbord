import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { CacheModule } from './cache/cache.module';
import { ActivityModule } from './activity/activity.module';
import { AuthModule } from './auth/auth.module';
import { IngestModule } from './ingest/ingest.module';
import { SalesModule } from './modules/sales/sales.module';
import { ProductsModule } from './modules/products/products.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { MarketingModule } from './modules/marketing/marketing.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthModule } from './modules/health/health.module';
import { CustomersModule } from './modules/customers/customers.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    DatabaseModule,
    CacheModule,
    ActivityModule,
    AuthModule,
    IngestModule,
    SalesModule,
    ProductsModule,
    InventoryModule,
    MarketingModule,
    AdminModule,
    HealthModule,
    CustomersModule,
  ],
})
export class AppModule {}
