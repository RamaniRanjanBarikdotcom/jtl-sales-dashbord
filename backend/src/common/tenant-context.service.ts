import { ForbiddenException, Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { Tenant } from '../entities/tenant.entity';
import { UserTenantMembership } from '../entities/user-tenant-membership.entity';
import { AuthenticatedRequest } from './types/auth-request';

@Injectable()
export class TenantContextService {
  constructor(
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(UserTenantMembership)
    private readonly membershipRepo: Repository<UserTenantMembership>,
  ) {}

  async resolve(
    req: AuthenticatedRequest | Request,
    requestedTenantId?: string | null,
  ): Promise<string> {
    const user = (req as AuthenticatedRequest).user;
    if (!user) throw new ForbiddenException('Authentication required');

    const candidateTenantId =
      requestedTenantId ||
      (typeof (req as any).query?.tenantId === 'string' ? (req as any).query.tenantId : undefined) ||
      (typeof (req as any).body?.tenantId === 'string' ? (req as any).body.tenantId : undefined) ||
      (typeof (req as any).headers?.['x-tenant-id'] === 'string' ? (req as any).headers['x-tenant-id'] : undefined) ||
      user.tenantId;

    if (!candidateTenantId) {
      throw new BadRequestException('tenantId is required');
    }

    if (user.role !== 'super_admin') {
      if (candidateTenantId !== user.tenantId) {
        throw new ForbiddenException('Cross-tenant access denied');
      }
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
