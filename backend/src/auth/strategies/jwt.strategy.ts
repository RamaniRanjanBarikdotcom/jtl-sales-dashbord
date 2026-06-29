import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { RevokedToken } from '../../entities/revoked-token.entity';
import { User } from '../../entities/user.entity';
import { Tenant } from '../../entities/tenant.entity';
import { UserTenantMembership } from '../../entities/user-tenant-membership.entity';
import { MembershipPermission } from '../../entities/membership-permission.entity';
import { RequestUser } from '../../common/types/auth-request';

const REVOKE_ALL_PREFIX = '__revoke_all__';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(RevokedToken)
    private readonly revokedRepo: Repository<RevokedToken>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(UserTenantMembership)
    private readonly membershipRepo: Repository<UserTenantMembership>,
    @InjectRepository(MembershipPermission)
    private readonly membershipPermissionRepo: Repository<MembershipPermission>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: RequestUser) {
    if (payload.jti) {
      const revoked = await this.revokedRepo.findOne({ where: { jti: payload.jti } });
      if (revoked) throw new UnauthorizedException('Token revoked');
    }
    if (payload.sub && payload.iat) {
      const sentinel = await this.revokedRepo.findOne({
        where: { jti: Like(`${REVOKE_ALL_PREFIX}${payload.sub}:%`) },
      });
      if (sentinel) {
        const parts = sentinel.jti.split(':');
        const revokedAt = Number(parts[parts.length - 1]);
        if (Number.isFinite(revokedAt) && payload.iat * 1000 < revokedAt) {
          throw new UnauthorizedException('Session invalidated');
        }
      }
    }

    const user = await this.userRepo.findOne({
      where: { id: payload.sub, is_active: true },
      select: { id: true, role: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    let membership: UserTenantMembership | null = null;
    let tenantId = payload.tenantId ?? null;
    let role = user.role;
    let userLevel = payload.userLevel || 'viewer';

    if (payload.membershipId) {
      membership = await this.membershipRepo.findOne({
        where: { id: payload.membershipId, user_id: user.id, is_active: true },
      });
      if (!membership) throw new UnauthorizedException('Membership inactive');
      if (tenantId && membership.tenant_id !== tenantId) {
        throw new UnauthorizedException('Membership tenant mismatch');
      }
      tenantId = membership.tenant_id;
      role = membership.role === 'company_admin' ? 'admin' : ['manager', 'analyst', 'viewer'].includes(membership.role) ? 'user' : membership.role;
      userLevel = ['manager', 'analyst', 'viewer'].includes(membership.role)
        ? membership.role
        : membership.user_level || 'viewer';
    } else if (user.role !== 'super_admin' && tenantId) {
      membership = await this.membershipRepo.findOne({
        where: { user_id: user.id, tenant_id: tenantId, is_active: true },
      });
      if (!membership) throw new UnauthorizedException('Membership inactive');
      tenantId = membership.tenant_id;
      role = membership.role === 'company_admin' ? 'admin' : ['manager', 'analyst', 'viewer'].includes(membership.role) ? 'user' : membership.role;
      userLevel = ['manager', 'analyst', 'viewer'].includes(membership.role)
        ? membership.role
        : membership.user_level || 'viewer';
    }

    if (user.role === 'super_admin') {
      if (tenantId) {
        const tenant = await this.tenantRepo.findOne({
          where: { id: tenantId, is_active: true },
          select: { id: true },
        });
        if (!tenant) throw new UnauthorizedException('Tenant inactive');
      }
      return {
        ...payload,
        role: user.role,
        isSuperAdmin: true,
        tenantId: tenantId ?? null,
        membershipId: membership?.id ?? payload.membershipId ?? null,
        permissions: ['*'],
      };
    }

    if (!membership) {
      throw new UnauthorizedException('No active company membership');
    }

    if (tenantId) {
      const tenant = await this.tenantRepo.findOne({
        where: { id: tenantId, is_active: true },
        select: { id: true },
      });
      if (!tenant) throw new UnauthorizedException('Tenant inactive');
    }

    const permissions = (await this.membershipPermissionRepo.find({
      where: { membership_id: membership.id },
      select: { permission_key: true },
    })).map((permission) => permission.permission_key);

    return {
      ...payload,
      tenantId: membership.tenant_id,
      membershipId: membership.id,
      role,
      userLevel,
      isSuperAdmin: false,
      permissions,
    };
  }
}
