import { ForbiddenException, Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { Tenant } from '../entities/tenant.entity';
import { UserTenantMembership } from '../entities/user-tenant-membership.entity';
import { AuthenticatedRequest, TenantScope } from './types/auth-request';

@Injectable()
export class TenantContextService {
  constructor(
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(UserTenantMembership)
    private readonly membershipRepo: Repository<UserTenantMembership>,
  ) {}

  /**
   * Resolve a read-path tenant scope. Honors the super-admin "All Companies"
   * mode (set by TenantIsolationGuard from the X-Tenant-Scope: all header) and
   * otherwise resolves to a single validated tenant. Read services filter with
   * `tenant_id = ANY(scope.tenantIds)`, so both modes share one code path.
   */
  async resolveScope(
    req: AuthenticatedRequest | Request,
    requestedTenantId?: string | null,
  ): Promise<TenantScope> {
    const r = req as AuthenticatedRequest;
    if (r.tenantScope === 'all') {
      return {
        scope: 'all',
        tenantId: null,
        tenantIds: r.allowedTenantIds ?? [],
        cacheKey: 'all',
      };
    }
    const tenantId = await this.resolve(req, requestedTenantId);
    return {
      scope: 'single',
      tenantId,
      tenantIds: [tenantId],
      cacheKey: `single:${tenantId}`,
    };
  }

  async resolve(
    req: AuthenticatedRequest | Request,
    requestedTenantId?: string | null,
  ): Promise<string> {
    const user = (req as AuthenticatedRequest).user;
    if (!user) throw new ForbiddenException('Authentication required');

    // All-company scope is a read-only combined view. Single-tenant callers
    // (writes/admin/sync) go through resolve() and must reject it.
    if ((req as any).headers?.['x-tenant-scope'] === 'all') {
      throw new BadRequestException('Select a single company for this action');
    }

    const candidateTenantId =
      requestedTenantId ||
      (req as AuthenticatedRequest).tenantId ||
      (typeof (req as any).query?.tenantId === 'string' ? (req as any).query.tenantId : undefined) ||
      (typeof (req as any).body?.tenantId === 'string' ? (req as any).body.tenantId : undefined) ||
      (typeof (req as any).headers?.['x-tenant-id'] === 'string' ? (req as any).headers['x-tenant-id'] : undefined) ||
      user.tenantId;

    if (!candidateTenantId) {
      throw new BadRequestException('tenantId is required');
    }

    if (user.role !== 'super_admin') {
      const membership = await this.membershipRepo.findOne({
        where: {
          user_id: user.sub,
          tenant_id: candidateTenantId,
          is_active: true,
        },
      });
      if (!membership) throw new ForbiddenException('Membership inactive');
    }

    const tenant = await this.tenantRepo.findOne({
      where: { id: candidateTenantId, is_active: true },
      select: { id: true },
    });
    if (!tenant) throw new ForbiddenException('Tenant inactive or unavailable');
    return candidateTenantId;
  }
}
