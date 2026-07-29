import { Global, Module } from '@nestjs/common';
import { TenantContextModule } from '../../common/tenant-context.module';
import { SyncAgentEventsController, SystemLogsController } from './system-logs.controller';
import { SystemLogsService } from './system-logs.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../../entities/tenant.entity';
import { TenantConnection } from '../../entities/tenant-connection.entity';
import { SyncApiKeyGuard } from '../../common/guards/sync-api-key.guard';

@Global()
@Module({
  imports: [TenantContextModule,TypeOrmModule.forFeature([Tenant,TenantConnection])],
  controllers: [SystemLogsController,SyncAgentEventsController],
  providers: [SystemLogsService,SyncApiKeyGuard],
  exports: [SystemLogsService],
})
export class SystemLogsModule {}
