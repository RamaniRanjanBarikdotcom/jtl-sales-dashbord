import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { CacheModule } from './cache/cache.module';
import { ActivityModule } from './activity/activity.module';
import { AuthModule } from './auth/auth.module';
import { IngestModule } from './ingest/ingest.module';
import { PermissionsModule } from './common/permissions/permissions.module';
import { SalesModule } from './modules/sales/sales.module';
import { ProductsModule } from './modules/products/products.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { MarketingModule } from './modules/marketing/marketing.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthModule } from './modules/health/health.module';
import { CustomersModule } from './modules/customers/customers.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { AuditModule } from './common/audit/audit.module';
import { ActivityInterceptor } from './common/interceptors/activity.interceptor';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuditModule,
    PermissionsModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
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
    MaintenanceModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ActivityInterceptor,
    },
  ],
})
export class AppModule {}
