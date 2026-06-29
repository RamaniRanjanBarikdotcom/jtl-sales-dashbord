import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsService } from './permissions.service';
import { Permission } from '../../entities/permission.entity';
import { RolePermission } from '../../entities/role-permission.entity';
import { UserPermission } from '../../entities/user-permission.entity';
import { User } from '../../entities/user.entity';
import { UserTenantMembership } from '../../entities/user-tenant-membership.entity';
import { MembershipPermission } from '../../entities/membership-permission.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Permission,
      RolePermission,
      UserPermission,
      User,
      UserTenantMembership,
      MembershipPermission,
    ]),
  ],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}

