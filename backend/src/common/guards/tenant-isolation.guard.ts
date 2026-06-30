import { BadRequestException, ForbiddenException, Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { Tenant } from '../../entities/tenant.entity';
import { UserTenantMembership } from '../../entities/user-tenant-membership.entity';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class TenantIsolationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(UserTenantMembership)
    private readonly membershipRepo: Repository<UserTenantMembership>,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (!user) return false;
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_PERMISSIONS_KEY,
      [ctx.getHandler(), ctx.getClass()],
    ) || [];

    // Super-admin "All Companies" scope: combined view across every active
    // tenant. Only super_admin may use it; everyone else is rejected so tenant
    // isolation is never weakened. Resolved before the single-tenant path so no
    // x-tenant-id is required in this mode.
    const scopeHeader = req.headers?.['x-tenant-scope'];
    if (scopeHeader === 'all') {
      if (user.role !== 'super_admin') {
        await this.audit.log({
          action: 'access.denied',
          actorId: user.sub,
          metadata: { reason: 'all_scope_forbidden', path: req.originalUrl },
        });
        throw new ForbiddenException('All-company scope is restricted to super admins');
      }
      const activeTenants = await this.tenantRepo.find({
        where: { is_active: true },
        select: { id: true },
      });
      req.tenantId = undefined;
      req.tenantScope = 'all';
      req.allowedTenantIds = activeTenants.map((t) => t.id);
      req.tenantRole = 'super_admin';
      req.membershipId = null;
      return true;
    }

    const explicitTenantId =
      req.headers?.['x-tenant-id'] ||
      req.params?.tenantId ||
      req.query?.tenantId ||
      req.body?.tenantId;
    const requestedTenantId = explicitTenantId || (required.length === 0 ? user.tenantId : undefined);

    if (!requestedTenantId) {
      if (required.length > 0) {
        throw new BadRequestException('Missing x-tenant-id');
      }
      return true;
    }

    const tenantId = Array.isArray(requestedTenantId) ? requestedTenantId[0] : String(requestedTenantId);
    const tenant = await this.tenantRepo.findOne({
      where: { id: tenantId, is_active: true },
      select: { id: true },
    });
    if (!tenant) {
      await this.audit.log({
        action: 'access.denied',
        actorId: user.sub,
        tenantId,
        metadata: { reason: 'tenant_inactive_or_missing', path: req.originalUrl },
      });
      throw new ForbiddenException('Tenant inactive or unavailable');
    }

    req.tenantId = tenantId;
    req.tenantScope = 'single';
    req.allowedTenantIds = [tenantId];

    if (user.role === 'super_admin') {
      req.tenantRole = 'super_admin';
      req.membershipId = null;
      return true;
    }

    const membership = await this.membershipRepo.findOne({
      where: {
        user_id: user.sub,
        tenant_id: tenantId,
        is_active: true,
      },
    });
    if (!membership) {
      await this.audit.log({
        action: 'access.denied',
        actorId: user.sub,
        tenantId,
        metadata: { reason: 'membership_missing', path: req.originalUrl },
      });
      throw new ForbiddenException('No access to this company');
    }

    req.tenantRole = membership.role;
    req.membershipId = membership.id;
    return true;
  }
}
