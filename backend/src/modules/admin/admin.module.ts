import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { CompanySettingsController } from './company-settings.controller';
import { AdminService } from './admin.service';
import { PlatformSettingsController } from './platform-settings.controller';
import { SyncController } from './sync.controller';
import { User } from '../../entities/user.entity';
import { Tenant } from '../../entities/tenant.entity';
import { TenantConnection } from '../../entities/tenant-connection.entity';
import { SyncLog } from '../../entities/sync-log.entity';
import { SyncWatermark } from '../../entities/sync-watermark.entity';
import { SyncTrigger } from '../../entities/sync-trigger.entity';
import { UserTenantMembership } from '../../entities/user-tenant-membership.entity';
import { MembershipPermission } from '../../entities/membership-permission.entity';
import { SyncEngineInstallation } from '../../entities/sync-engine-installation.entity';
import { TenantContextModule } from '../../common/tenant-context.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    MailModule,
    TenantContextModule,
    TypeOrmModule.forFeature([
      User,
      Tenant,
      TenantConnection,
      SyncLog,
      SyncWatermark,
      SyncTrigger,
      UserTenantMembership,
      MembershipPermission,
      SyncEngineInstallation,
    ]),
  ],
  controllers: [
    AdminController,
    CompanySettingsController,
    PlatformSettingsController,
    SyncController,
  ],
  providers: [AdminService],
})
export class AdminModule {}
