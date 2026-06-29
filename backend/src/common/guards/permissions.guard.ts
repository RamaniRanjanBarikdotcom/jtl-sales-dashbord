import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../audit/audit.service';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { PermissionsService } from '../permissions/permissions.service';
import { AuthenticatedRequest } from '../types/auth-request';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
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

    // membership_permissions is authoritative. TenantIsolationGuard runs first
    // (see app.module guard order) and has already set req.tenantId /
    // req.membershipId, so canMembershipAccess resolves from the selected company.
    const tenantId = req.tenantId ?? user.tenantId ?? null;
    const ok = await this.permissions.canMembershipAccess(
      req.membershipId,
      tenantId,
      user.sub,
      required,
    );
    if (!ok) {
      await this.audit.log({
        action: 'access.denied',
        actorId: user.sub,
        tenantId: tenantId ?? undefined,
        metadata: { reason: 'permission_missing', required, path: req.originalUrl },
      });
      throw new ForbiddenException('Missing required permission');
    }
    return true;
  }
}
