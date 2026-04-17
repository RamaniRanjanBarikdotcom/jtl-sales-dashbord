import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

@Injectable()
export class TenantIsolationGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user;
    if (!user) return false;
    // super_admin may access all tenants
    if (user.role === 'super_admin') return true;
    // other users must have a tenantId
    if (!user.tenantId) throw new ForbiddenException('No tenant assigned');
    return true;
  }
}
