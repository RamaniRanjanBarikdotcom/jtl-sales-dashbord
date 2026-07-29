import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncApiKeyGuard } from '../../common/guards/sync-api-key.guard';
import { PermissionsModule } from '../../common/permissions/permissions.module';
import { TenantContextModule } from '../../common/tenant-context.module';
import { Tenant } from '../../entities/tenant.entity';
import { TenantConnection } from '../../entities/tenant-connection.entity';
import {
  AdminAgentReleaseController, SyncAgentReleaseController,
} from './agent-release.controller';
import { AgentReleaseStorageService } from './agent-release-storage.service';
import { AgentReleaseService } from './agent-release.service';

@Module({
  imports: [TenantContextModule,PermissionsModule,TypeOrmModule.forFeature([Tenant,TenantConnection])],
  controllers: [AdminAgentReleaseController,SyncAgentReleaseController],
  providers: [AgentReleaseService,AgentReleaseStorageService,SyncApiKeyGuard],
})
export class AgentReleaseModule {}
