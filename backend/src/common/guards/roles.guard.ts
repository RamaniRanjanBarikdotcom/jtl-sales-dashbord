import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.get<string[]>('roles', ctx.getHandler());
    if (!roles) return true;
    const user = ctx.switchToHttp().getRequest().user;
    if (!roles.includes(user?.role)) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
