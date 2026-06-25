import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class TenantIsolationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (!user) return false;
    // super_admin may access all tenants
    if (user.role === 'super_admin') return true;
    // other users must have a tenantId
    if (!user.tenantId) throw new ForbiddenException('No tenant assigned');
    const requestedTenantId =
      req.params?.tenantId ||
      req.query?.tenantId ||
      req.body?.tenantId;
    if (requestedTenantId && requestedTenantId !== user.tenantId) {
      throw new ForbiddenException('Cross-tenant access denied');
    }
    return true;
  }
}
