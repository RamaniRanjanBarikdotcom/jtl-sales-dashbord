import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { PermissionsService } from '../permissions/permissions.service';
import { AuthenticatedRequest } from '../types/auth-request';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
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

    if (Array.isArray(user.permissions) && user.permissions.length > 0) {
      const set = new Set(user.permissions);
      return required.every((p) => set.has(p));
    }
    return this.permissions.canUserAccess(user.sub, required);
  }
}

