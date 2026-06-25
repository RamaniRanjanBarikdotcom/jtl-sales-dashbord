import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../entities/tenant.entity';
import { UserTenantMembership } from '../entities/user-tenant-membership.entity';
import { TenantContextService } from './tenant-context.service';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, UserTenantMembership])],
  providers: [TenantContextService],
  exports: [TenantContextService],
})
export class TenantContextModule {}
