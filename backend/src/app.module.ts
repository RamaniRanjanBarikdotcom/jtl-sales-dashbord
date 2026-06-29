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
import { AdminModule } from './modules/admin/admin.module';
import { HealthModule } from './modules/health/health.module';
import { CustomersModule } from './modules/customers/customers.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { AuditModule } from './common/audit/audit.module';
import { ActivityInterceptor } from './common/interceptors/activity.interceptor';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { TenantIsolationGuard } from './common/guards/tenant-isolation.guard';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { Tenant } from './entities/tenant.entity';
import { UserTenantMembership } from './entities/user-tenant-membership.entity';
import { MembershipPermission } from './entities/membership-permission.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forFeature([Tenant, UserTenantMembership, MembershipPermission]),
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
    AdminModule,
    HealthModule,
    CustomersModule,
    MaintenanceModule,
    AnalyticsModule,
    DashboardModule,
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
      useClass: TenantIsolationGuard,
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
