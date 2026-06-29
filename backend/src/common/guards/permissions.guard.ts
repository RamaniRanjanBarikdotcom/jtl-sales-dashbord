import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { MembershipPermission } from '../../entities/membership-permission.entity';
import { UserTenantMembership } from '../../entities/user-tenant-membership.entity';
import { AuditService } from '../audit/audit.service';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { PermissionsService } from '../permissions/permissions.service';
import { AuthenticatedRequest } from '../types/auth-request';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
    @InjectRepository(UserTenantMembership)
    private readonly membershipRepo: Repository<UserTenantMembership>,
    @InjectRepository(MembershipPermission)
    private readonly membershipPermissionRepo: Repository<MembershipPermission>,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;
    if (!user) return false;
    if (user.role === 'super_admin') return true;

    const tenantId = req.tenantId || user.tenantId;
    if (tenantId) {
      const membership = req.membershipId
        ? { id: req.membershipId }
        : await this.membershipRepo.findOne({
            where: { user_id: user.sub, tenant_id: tenantId, is_active: true },
            select: { id: true },
          });
      if (!membership?.id) {
        await this.audit.log({
          action: 'access.denied',
          actorId: user.sub,
          tenantId,
          metadata: { reason: 'permission_membership_missing', required, path: req.originalUrl },
        });
        throw new ForbiddenException('No access to this company');
      }
      const rows = await this.membershipPermissionRepo.find({
        where: { membership_id: membership.id, permission_key: In(required) },
        select: { permission_key: true },
      });
      const allowed = new Set(rows.map((row) => row.permission_key));
      const ok = required.every((permission) => allowed.has(permission));
      if (!ok) {
        await this.audit.log({
          action: 'access.denied',
          actorId: user.sub,
          tenantId,
          metadata: { reason: 'permission_missing', required, path: req.originalUrl },
        });
        throw new ForbiddenException('Missing required permission');
      }
      return true;
    }

    return this.permissions.canUserAccess(user.sub, required);
  }
}
