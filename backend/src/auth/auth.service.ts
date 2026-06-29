import { Injectable, UnauthorizedException, ForbiddenException, HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Like, Raw, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import type { CookieOptions, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { User } from '../entities/user.entity';
import { RevokedToken } from '../entities/revoked-token.entity';
import { Tenant } from '../entities/tenant.entity';
import { UserTenantMembership } from '../entities/user-tenant-membership.entity';
import { MembershipPermission } from '../entities/membership-permission.entity';
import { AuditService } from '../common/audit/audit.service';

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/;
const LOCKOUT_WINDOW_MS = 15 * 60_000;
const COMPANY_SELECTION_EXPIRES_IN = '5m';

// Prefix for user-level "revoke all tokens" sentinel stored in revoked_tokens table.
// When password is changed, a sentinel with this prefix is inserted so the JWT strategy
// can reject all tokens issued before the change timestamp.
const REVOKE_ALL_PREFIX = '__revoke_all__';

@Injectable()
export class AuthService {
  private lastRevokedTokenCleanupAt = 0;

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(RevokedToken) private readonly revokedRepo: Repository<RevokedToken>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(UserTenantMembership)
    private readonly membershipRepo: Repository<UserTenantMembership>,
    @InjectRepository(MembershipPermission)
    private readonly membershipPermissionRepo: Repository<MembershipPermission>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  private mapMembershipRoleToJwtRole(role: string): string {
    if (role === 'company_admin') return 'admin';
    if (['manager', 'analyst', 'viewer'].includes(role)) return 'user';
    return role || 'user';
  }

  private mapMembershipRoleToUserLevel(role: string, userLevel?: string | null): string | null {
    if (['manager', 'analyst', 'viewer'].includes(role)) return role;
    return userLevel || null;
  }

  private async getMembershipPermissionKeys(membershipId?: string | null): Promise<string[]> {
    if (!membershipId) return [];
    const rows = await this.membershipPermissionRepo.find({
      where: { membership_id: membershipId },
      select: { permission_key: true },
    });
    return rows.map((row) => row.permission_key);
  }

  private async getCompanyRows(userId: string) {
    return this.membershipRepo
      .createQueryBuilder('m')
      .innerJoin(Tenant, 't', 't.id = m.tenant_id AND t.is_active = true')
      .select([
        'm.id AS "membershipId"',
        'm.tenant_id AS "tenantId"',
        'm.role AS role',
        'm.user_level AS "userLevel"',
        'm.dept AS dept',
        't.name AS name',
        't.slug AS slug',
      ])
      .where('m.user_id = :userId', { userId })
      .andWhere('m.is_active = true')
      .orderBy('t.name', 'ASC')
      .getRawMany<{
        membershipId: string;
        tenantId: string;
        role: string;
        userLevel: string | null;
        dept: string | null;
        name: string;
        slug: string;
      }>();
  }

  private async ensureLegacyMembership(user: User): Promise<UserTenantMembership | null> {
    if (!user.tenant_id || user.role === 'super_admin') return null;
    let membership = await this.membershipRepo.findOne({
      where: { user_id: user.id, tenant_id: user.tenant_id },
    });
    if (membership) return membership;
    membership = await this.membershipRepo.save({
      user_id: user.id,
      tenant_id: user.tenant_id,
      role: user.role === 'admin' ? 'company_admin' : 'user',
      user_level: user.user_level,
      dept: user.dept,
      is_active: user.is_active,
      created_by: user.created_by || null,
    } as Partial<UserTenantMembership>);
    return membership;
  }

  // Identity-only payload that gets SIGNED into the access token. Tenant-scoped
  // permissions are deliberately NOT embedded — they are tenant-specific and
  // would go stale after admin permission changes. Backend authorization is
  // enforced by TenantIsolationGuard + PermissionsGuard against DB
  // membership_permissions on every protected request.
  private buildAccessPayload(user: User, jti: string, membership?: UserTenantMembership | null) {
    const role = membership ? this.mapMembershipRoleToJwtRole(membership.role) : user.role;
    const userLevel = membership
      ? this.mapMembershipRoleToUserLevel(membership.role, membership.user_level)
      : user.user_level;
    return {
      sub: user.id,
      tenantId: membership?.tenant_id ?? user.tenant_id,
      membershipId: membership?.id ?? null,
      role,
      userLevel,
      name: user.full_name,
      jti,
      isSuperAdmin: user.role === 'super_admin',
      mustChange: user.must_change_pwd,
    };
  }

  // Permissions for RESPONSE BODIES only (never embedded in the signed token).
  // The frontend reads these from the body to gate menu items; enforcement
  // still recomputes server-side per request.
  private async resolveResponsePermissions(
    user: User,
    membership?: UserTenantMembership | null,
  ): Promise<string[]> {
    if (user.role === 'super_admin') return ['*'];
    if (membership) return this.getMembershipPermissionKeys(membership.id);
    return [];
  }

  private async buildCompanySummaries(userId: string) {
    const companies = await this.getCompanyRows(userId);
    return Promise.all(companies.map(async (company) => ({
      ...company,
      permissions: await this.getMembershipPermissionKeys(company.membershipId),
    })));
  }

  private signCompanySelectionToken(userId: string): string {
    return this.jwtService.sign(
      {
        sub: userId,
        jti: uuidv4(),
        purpose: 'company_selection',
      },
      { expiresIn: COMPANY_SELECTION_EXPIRES_IN },
    );
  }

  private verifyCompanySelectionToken(selectionToken: string): { sub: string; purpose: string } {
    try {
      const payload = this.jwtService.verify(selectionToken) as { sub?: string; purpose?: string };
      if (!payload.sub || payload.purpose !== 'company_selection') {
        throw new UnauthorizedException('Invalid company selection token');
      }
      return { sub: payload.sub, purpose: payload.purpose };
    } catch {
      throw new UnauthorizedException('Invalid or expired company selection token');
    }
  }

  private async issueDashboardSession(
    user: User,
    membership: UserTenantMembership | null,
    res?: Response,
    req?: Request,
  ) {
    const jti = uuidv4();
    const accessPayload = this.buildAccessPayload(user, jti, membership);
    const accessToken = this.jwtService.sign(accessPayload);
    const permissions = await this.resolveResponsePermissions(user, membership);
    if (res) {
      const refreshJti = uuidv4();
      const refreshToken = this.jwtService.sign(
        {
          sub: user.id,
          jti: refreshJti,
          tenantId: accessPayload.tenantId,
          membershipId: accessPayload.membershipId ?? null,
        },
        {
          secret: this.config.get('JWT_REFRESH_SECRET'),
          expiresIn: this.config.get('JWT_REFRESH_EXPIRES', '7d'),
        },
      );
      res.cookie('refresh_token', refreshToken, {
        ...this.getCookieOptions(true, req),
        maxAge: this.getRefreshTokenMaxAgeMs(),
      });
      this.setCsrfCookie(res, req);
    }
    return { accessToken, accessPayload, permissions };
  }

  // Lockout starts at 5 failed attempts. Below that we leave the account alone
  // so a user mistyping a password a couple of times isn't punished. The per-IP
  // throttle (in auth.controller) catches faster bot-style attacks.
  private getLockoutDurationMs(failedAttempts: number): number {
    if (failedAttempts >= 20) return 24 * 60 * 60_000; // 24h
    if (failedAttempts >= 12) return 2  * 60 * 60_000; // 2h
    if (failedAttempts >= 8)  return 30 * 60_000;       // 30m
    if (failedAttempts >= 5)  return 5  * 60_000;       // 5m on 5th attempt
    return 0;
  }

  private getRefreshTokenMaxAgeMs(): number {
    const raw = this.config.get<string>('JWT_REFRESH_EXPIRES', '7d');
    const value = String(raw).trim().toLowerCase();
    const match = value.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 60 * 60_000;
    const n = Number(match[1]);
    const unit = match[2];
    const factor =
      unit === 's' ? 1000 :
      unit === 'm' ? 60_000 :
      unit === 'h' ? 60 * 60_000 :
      24 * 60 * 60_000;
    return Math.max(60_000, n * factor);
  }

  private async cleanupExpiredRevokedTokens(force = false) {
    const now = Date.now();
    if (!force && now - this.lastRevokedTokenCleanupAt < LOCKOUT_WINDOW_MS) return;
    this.lastRevokedTokenCleanupAt = now;
    await this.revokedRepo.delete({ expires_at: LessThan(new Date()) });
  }

  private setCsrfCookie(res: Response, req?: Request): void {
    const token = randomBytes(24).toString('base64url');
    res.cookie('XSRF-TOKEN', token, {
      ...this.getCookieOptions(false, req),
      maxAge: this.getRefreshTokenMaxAgeMs(),
    });
  }

  // Cookie `secure` flag must match the request's scheme — browsers silently
  // drop Secure cookies sent over HTTP. We prefer the live request (via
  // X-Forwarded-Proto from the proxy, or req.secure) and only fall back to env
  // when no request is in scope.
  private getCookieSecure(req?: Request): boolean {
    const raw = this.config.get<string>('COOKIE_SECURE');
    if (raw != null && raw.trim() !== '') {
      return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
    }
    if (req) {
      const xfProto = String(req.headers['x-forwarded-proto'] || '')
        .toLowerCase()
        .split(',')[0]
        .trim();
      if (xfProto === 'https') return true;
      if (xfProto === 'http') return false;
      if (typeof req.secure === 'boolean') return req.secure;
    }
    const frontendUrl = (this.config.get<string>('FRONTEND_URL') || '')
      .split(',')[0]
      .trim()
      .toLowerCase();
    if (frontendUrl.startsWith('http://')) return false;
    if (frontendUrl.startsWith('https://')) return true;
    return this.config.get('NODE_ENV') === 'production';
  }

  private getCookieSameSite(req?: Request): 'strict' | 'lax' | 'none' {
    const raw = (this.config.get<string>('COOKIE_SAMESITE') || 'lax').trim().toLowerCase();
    if (raw === 'none') return this.getCookieSecure(req) ? 'none' : 'lax';
    if (raw === 'lax') return 'lax';
    return 'strict';
  }

  private getCookieOptions(httpOnly: boolean, req?: Request): CookieOptions {
    const domain = this.config.get<string>('COOKIE_DOMAIN')?.trim();
    const path = this.config.get<string>('COOKIE_PATH')?.trim() || '/';
    return {
      httpOnly,
      secure: this.getCookieSecure(req),
      sameSite: this.getCookieSameSite(req),
      ...(domain ? { domain } : {}),
      path,
    };
  }

  private normalizeEmail(value: string): string {
    return value.trim().toLowerCase().normalize('NFKC');
  }

  // Check if a user-level "revoke all" sentinel exists and is newer than the token's iat
  async isRevokedByUserSentinel(userId: string, tokenIat: number): Promise<boolean> {
    const sentinel = await this.revokedRepo.findOne({
      where: { jti: Like(`${REVOKE_ALL_PREFIX}${userId}:%`) },
    });
    if (!sentinel) return false;
    // Extract timestamp from sentinel jti: "__revoke_all__<userId>:<ts>"
    const parts = sentinel.jti.split(':');
    const revokedAt = Number(parts[parts.length - 1]);
    return Number.isFinite(revokedAt) && tokenIat * 1000 < revokedAt;
  }

  async login(email: string, password: string, res: Response, req?: Request) {
    await this.cleanupExpiredRevokedTokens();
    // Normalize email: lowercase + Unicode NFKC to block homograph attacks
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.userRepo.findOne({
      where: {
        email: Raw((alias) => `LOWER(${alias}) = :email`, { email: normalizedEmail }),
      },
    });
    if (!user) {
      await this.audit.log({ action: 'auth.login.failed', metadata: { reason: 'user_not_found', email: normalizedEmail } });
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.is_active) {
      await this.audit.log({ action: 'auth.login.failed', actorId: user.id, tenantId: user.tenant_id, metadata: { reason: 'account_inactive' } });
      throw new ForbiddenException({ code: 'TENANT_INACTIVE', message: 'Account inactive' });
    }
    if (user.locked_until && user.locked_until > new Date()) {
      await this.audit.log({ action: 'auth.login.blocked', actorId: user.id, tenantId: user.tenant_id, metadata: { locked_until: user.locked_until } });
      throw new HttpException({ code: 'ACCOUNT_LOCKED', message: 'Account locked', locked_until: user.locked_until }, 423);
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      user.failed_login_attempts++;
      const lockMs = this.getLockoutDurationMs(user.failed_login_attempts);
      if (lockMs > 0) {
        user.locked_until = new Date(Date.now() + lockMs);
      }
      await this.userRepo.save(user);
      await this.audit.log({
        action: 'auth.login.failed',
        actorId: user.id,
        tenantId: user.tenant_id,
        metadata: { reason: 'invalid_password', attempts: user.failed_login_attempts, locked: lockMs > 0 },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    user.failed_login_attempts = 0;
    user.locked_until = null as any;
    user.last_login_at = new Date();
    await this.userRepo.save(user);

    const memberships = await this.getCompanyRows(user.id);
    const companies = user.role === 'super_admin'
      ? []
      : await this.buildCompanySummaries(user.id);
    if (user.role !== 'super_admin' && companies.length > 1) {
      const selectionToken = this.signCompanySelectionToken(user.id);
      await this.audit.log({
        action: 'auth.login.company_selection_required',
        actorId: user.id,
        metadata: { companyCount: companies.length },
      });
      return {
        requiresCompanySelection: true,
        selectionToken,
        companies,
      };
    }

    const selectedMembership = memberships.length > 0
      ? await this.membershipRepo.findOne({ where: { id: memberships[0].membershipId } })
      : await this.ensureLegacyMembership(user);

    const { accessToken, permissions } = await this.issueDashboardSession(
      user,
      selectedMembership,
      res,
      req,
    );

    await this.audit.log({
      action: 'auth.login.success',
      actorId: user.id,
      tenantId: selectedMembership?.tenant_id ?? user.tenant_id,
    });

    return {
      accessToken,
      requiresCompanySelection: false,
      companies,
      currentCompany: companies.find((c) => c.tenantId === (selectedMembership?.tenant_id ?? user.tenant_id)) ?? null,
      user: {
        id: user.id,
        email: user.email,
        name: user.full_name,
        role: selectedMembership ? this.mapMembershipRoleToJwtRole(selectedMembership.role) : user.role,
        userLevel: selectedMembership
          ? this.mapMembershipRoleToUserLevel(selectedMembership.role, selectedMembership.user_level)
          : user.user_level,
        mustChange: user.must_change_pwd,
        permissions,
      },
    };
  }

  private async resolveRefreshMembership(
    user: User,
    payload: { tenantId?: string | null; membershipId?: string | null },
  ): Promise<UserTenantMembership | null> {
    if (user.role === 'super_admin') {
      if (payload.tenantId) {
        const tenant = await this.tenantRepo.findOne({
          where: { id: payload.tenantId, is_active: true },
          select: { id: true },
        });
        if (!tenant) throw new UnauthorizedException('Tenant inactive');
        user.tenant_id = payload.tenantId;
      }
      return null;
    }

    if (payload.membershipId) {
      const membership = await this.membershipRepo.findOne({
        where: { id: payload.membershipId, user_id: user.id, is_active: true },
      });
      if (membership) return membership;
    }

    if (payload.tenantId) {
      const membership = await this.membershipRepo.findOne({
        where: { user_id: user.id, tenant_id: payload.tenantId, is_active: true },
      });
      if (membership) return membership;
    }

    return this.ensureLegacyMembership(user);
  }

  private async buildSessionResponse(accessToken: string, user: User, membership: UserTenantMembership | null) {
    const decoded = this.jwtService.decode(accessToken) as Record<string, unknown> | null;
    const [companies, permissions] = await Promise.all([
      user.role === 'super_admin'
        ? this.getCompanies(user.id).then((result) => result.companies)
        : this.buildCompanySummaries(user.id),
      this.resolveResponsePermissions(user, membership),
    ]);
    const tenantId = String(decoded?.tenantId ?? membership?.tenant_id ?? user.tenant_id ?? '');
    return {
      accessToken,
      user: {
        sub: user.id,
        id: user.id,
        email: user.email,
        name: user.full_name,
        tenantId: tenantId || null,
        membershipId: decoded?.membershipId ?? membership?.id ?? null,
        role: decoded?.role ?? (membership ? this.mapMembershipRoleToJwtRole(membership.role) : user.role),
        userLevel: decoded?.userLevel ?? (membership
          ? this.mapMembershipRoleToUserLevel(membership.role, membership.user_level)
          : user.user_level),
        permissions,
        mustChange: user.must_change_pwd,
      },
      companies,
      currentCompany: companies.find((c) => c.tenantId === tenantId) ?? null,
    };
  }

  async refresh(refreshToken: string, res: Response, req?: Request) {
    await this.cleanupExpiredRevokedTokens();
    let payload: {
      sub: string;
      jti: string;
      exp: number;
      iat: number;
      tenantId?: string | null;
      membershipId?: string | null;
    };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const revoked = await this.revokedRepo.findOne({ where: { jti: payload.jti } });
    if (revoked) throw new UnauthorizedException('Refresh token revoked');

    // Check user-level sentinel (all tokens revoked after password change)
    if (await this.isRevokedByUserSentinel(payload.sub, payload.iat)) {
      throw new UnauthorizedException('Session invalidated — please log in again');
    }

    // Rotate: revoke old refresh token before issuing new one
    try {
      await this.revokedRepo.save({
        jti: payload.jti,
        expires_at: new Date(payload.exp * 1000),
      });
    } catch (e: unknown) {
      const code = typeof e === 'object' && e !== null && 'code' in e
        ? String((e as { code?: string }).code)
        : '';
      if (code !== '23505') throw e;
    }

    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user || !user.is_active) throw new UnauthorizedException('User not found');

    const membership = await this.resolveRefreshMembership(user, payload);
    const jti = uuidv4();
    const accessToken = this.jwtService.sign(this.buildAccessPayload(user, jti, membership));

    const refreshJti = uuidv4();
    const newRefresh = this.jwtService.sign(
      {
        sub: user.id,
        jti: refreshJti,
        tenantId: payload.tenantId ?? membership?.tenant_id ?? user.tenant_id ?? null,
        membershipId: membership?.id ?? payload.membershipId ?? null,
      },
      {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES', '7d'),
      },
    );

    res.cookie('refresh_token', newRefresh, {
      ...this.getCookieOptions(true, req),
      maxAge: this.getRefreshTokenMaxAgeMs(),
    });
    this.setCsrfCookie(res, req);

    await this.audit.log({ action: 'auth.token.refreshed', actorId: user.id, tenantId: user.tenant_id });

    return this.buildSessionResponse(accessToken, user, membership);
  }

  async session(refreshToken: string, res: Response, req?: Request) {
    try {
      const session = await this.refresh(refreshToken, res, req);
      return { authenticated: true, ...session };
    } catch {
      res.clearCookie('refresh_token', this.getCookieOptions(true, req));
      res.clearCookie('XSRF-TOKEN', this.getCookieOptions(false, req));
      return { authenticated: false };
    }
  }

  async getCompanies(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !user.is_active) throw new UnauthorizedException('User not found');
    if (user.role === 'super_admin') {
      const tenants = await this.tenantRepo.find({
        where: { is_active: true },
        order: { name: 'ASC' },
        select: { id: true, name: true, slug: true },
      });
      return {
        companies: tenants.map((tenant) => ({
          tenantId: tenant.id,
          membershipId: null,
          name: tenant.name,
          slug: tenant.slug,
          role: 'super_admin',
          userLevel: null,
          permissions: ['*'],
        })),
      };
    }
    await this.ensureLegacyMembership(user);
    return { companies: await this.buildCompanySummaries(userId) };
  }

  private resolveBearerToken(authHeader?: string): string | null {
    const [scheme, token] = String(authHeader || '').split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : null;
  }

  private async resolveSwitchUserId(authHeader: string | undefined, selectionToken?: string): Promise<string> {
    if (selectionToken) {
      return this.verifyCompanySelectionToken(selectionToken).sub;
    }
    const token = this.resolveBearerToken(authHeader);
    if (!token) throw new UnauthorizedException('Missing access token or selection token');
    try {
      const payload = this.jwtService.verify(token) as { sub?: string; purpose?: string; jti?: string; iat?: number };
      if (!payload.sub || payload.purpose === 'company_selection') {
        throw new UnauthorizedException('Invalid access token');
      }
      if (payload.jti) {
        const revoked = await this.revokedRepo.findOne({ where: { jti: payload.jti } });
        if (revoked) throw new UnauthorizedException('Token revoked');
      }
      if (payload.iat && await this.isRevokedByUserSentinel(payload.sub, payload.iat)) {
        throw new UnauthorizedException('Session invalidated');
      }
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }

  async switchCompany(
    userId: string,
    tenantId: string,
    res?: Response,
    req?: Request,
  ) {
    const user = await this.userRepo.findOne({ where: { id: userId, is_active: true } });
    if (!user) throw new UnauthorizedException('User not found');

    let membership: UserTenantMembership | null = null;
    if (user.role === 'super_admin') {
      const tenant = await this.tenantRepo.findOne({ where: { id: tenantId, is_active: true } });
      if (!tenant) throw new ForbiddenException('Tenant inactive or unavailable');
    } else {
      membership = await this.membershipRepo.findOne({
        where: { user_id: userId, tenant_id: tenantId, is_active: true },
      });
      if (!membership) throw new ForbiddenException('Company access denied');
      const tenant = await this.tenantRepo.findOne({ where: { id: tenantId, is_active: true } });
      if (!tenant) throw new ForbiddenException('Tenant inactive');
    }

    const payload = user.role === 'super_admin'
      ? {
          ...(await this.issueDashboardSession({ ...user, tenant_id: tenantId } as User, null, res, req)).accessPayload,
          tenantId,
        }
      : (await this.issueDashboardSession(user, membership, res, req)).accessPayload;
    const accessToken = this.jwtService.sign(payload);
    const companies = await this.getCompanies(userId);
    const currentCompany = companies.companies.find((c) => c.tenantId === tenantId) ?? null;

    await this.audit.log({
      action: user.role === 'super_admin' ? 'admin.switched_company' : 'auth.switch_company',
      actorId: userId,
      tenantId,
      metadata: { membershipId: membership?.id ?? null },
    });

    return { accessToken, currentCompany };
  }

  async switchCompanyFromToken(
    authHeader: string | undefined,
    tenantId: string,
    selectionToken: string | undefined,
    res: Response,
    req?: Request,
  ) {
    const userId = await this.resolveSwitchUserId(authHeader, selectionToken);
    return this.switchCompany(userId, tenantId, res, req);
  }

  async logout(jti: string, exp: number, res: Response, req?: Request) {
    await this.cleanupExpiredRevokedTokens();
    if (jti) {
      await this.revokedRepo.save({ jti, expires_at: new Date(exp * 1000) });
    }
    res.clearCookie('refresh_token', this.getCookieOptions(true, req));
    res.clearCookie('XSRF-TOKEN', this.getCookieOptions(false, req));
    return { ok: true };
  }

  async logoutAll(userId: string, jti: string, exp: number, res: Response, req?: Request) {
    await this.cleanupExpiredRevokedTokens();
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const revokedAt = Date.now();
    if (jti) {
      await this.revokedRepo.save({ jti, expires_at: new Date(exp * 1000) });
    }
    await this.revokedRepo.delete({ jti: Like(`${REVOKE_ALL_PREFIX}${userId}:%`) });
    await this.revokedRepo.save({
      jti: `${REVOKE_ALL_PREFIX}${userId}:${revokedAt}`,
      expires_at: new Date(revokedAt + this.getRefreshTokenMaxAgeMs()),
    });

    res.clearCookie('refresh_token', this.getCookieOptions(true, req));
    res.clearCookie('XSRF-TOKEN', this.getCookieOptions(false, req));
    await this.audit.log({ action: 'auth.logout_all', actorId: userId, tenantId: user.tenant_id });
    return { ok: true };
  }

  async updateProfile(userId: string, body: { full_name?: string; email?: string }) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (body.full_name) user.full_name = body.full_name.trim();
    // Email changes disabled via profile endpoint — must go through admin to prevent self-impersonation
    await this.userRepo.save(user);
    return { ok: true, full_name: user.full_name, email: user.email };
  }

  async getPreferences(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    return { data: user.preferences ?? {} };
  }

  async updatePreferences(userId: string, prefs: Record<string, unknown>) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    user.preferences = { ...(user.preferences ?? {}), ...prefs };
    await this.userRepo.save(user);
    return { ok: true, data: user.preferences };
  }

  async changePassword(
    userId: string,
    currentPwd: string,
    newPwd: string,
    jti: string,
    exp: number,
    membershipId?: string | null,
    res?: Response,
    req?: Request,
  ) {
    if (!PASSWORD_REGEX.test(newPwd)) {
      throw new ForbiddenException(
        'Password must be at least 8 characters with uppercase, lowercase, number, and special character',
      );
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    const valid = await bcrypt.compare(currentPwd, user.password_hash);
    if (!valid) {
      await this.audit.log({ action: 'auth.password.change_failed', actorId: userId, tenantId: user.tenant_id, metadata: { reason: 'wrong_current_password' } });
      throw new UnauthorizedException('Current password incorrect');
    }

    const hash = await bcrypt.hash(newPwd, 12);
    user.password_hash = hash;
    user.must_change_pwd = false;
    await this.userRepo.save(user);

    const membership = membershipId
      ? await this.membershipRepo.findOne({
          where: { id: membershipId, user_id: user.id, is_active: true },
        })
      : await this.ensureLegacyMembership(user);
    const session = await this.issueDashboardSession(user, membership, res, req);
    const decoded = this.jwtService.decode(session.accessToken) as { iat?: number } | null;
    const newTokenIssuedAt = Number(decoded?.iat) || Math.floor(Date.now() / 1000);
    const revokedAt = Math.max(0, newTokenIssuedAt * 1000 - 1);

    // 1. Revoke the current access token
    if (jti) {
      await this.revokedRepo.save({ jti, expires_at: new Date(exp * 1000) });
    }

    // 2. Insert user-level sentinel to invalidate ALL other sessions.
    //    Store the sentinel just before the freshly issued session's iat so
    //    the new dashboard token and refresh cookie survive the forced reset.
    //    Delete any old sentinel for this user first to keep the table clean.
    await this.revokedRepo.delete({ jti: Like(`${REVOKE_ALL_PREFIX}${userId}:%`) });
    await this.revokedRepo.save({
      jti: `${REVOKE_ALL_PREFIX}${userId}:${revokedAt}`,
      expires_at: new Date(revokedAt + this.getRefreshTokenMaxAgeMs()),
    });

    await this.audit.log({ action: 'auth.password.changed', actorId: userId, tenantId: user.tenant_id });

    return { accessToken: session.accessToken };
  }
}
