import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantContextModule } from '../../common/tenant-context.module';
import { SyncApiKeyGuard } from '../../common/guards/sync-api-key.guard';
import { Tenant } from '../../entities/tenant.entity';
import { TenantConnection } from '../../entities/tenant-connection.entity';
import { AdminSyncControlController, SyncAgentController } from './sync-control.controller';
import { SyncControlService } from './sync-control.service';
import { AuditModule } from '../../common/audit/audit.module';
import { PermissionsModule } from '../../common/permissions/permissions.module';

@Module({
  imports: [
    TenantContextModule,AuditModule,PermissionsModule,
    TypeOrmModule.forFeature([Tenant,TenantConnection]),
  ],
  controllers: [AdminSyncControlController, SyncAgentController],
  providers: [SyncControlService, SyncApiKeyGuard],
})
export class SyncControlModule {}
