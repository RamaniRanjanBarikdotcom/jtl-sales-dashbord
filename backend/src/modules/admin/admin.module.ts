import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SyncController } from './sync.controller';
import { User } from '../../entities/user.entity';
import { Tenant } from '../../entities/tenant.entity';
import { TenantConnection } from '../../entities/tenant-connection.entity';
import { SyncLog } from '../../entities/sync-log.entity';
import { SyncWatermark } from '../../entities/sync-watermark.entity';
import { SyncTrigger } from '../../entities/sync-trigger.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Tenant,
      TenantConnection,
      SyncLog,
      SyncWatermark,
      SyncTrigger,
    ]),
  ],
  controllers: [AdminController, SyncController],
  providers: [AdminService],
})
export class AdminModule {}
