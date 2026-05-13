import { Injectable, UnauthorizedException, ForbiddenException, HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Like, Raw, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import type { CookieOptions, Response } from 'express';
import { randomBytes } from 'crypto';
import { User } from '../entities/user.entity';
import { RevokedToken } from '../entities/revoked-token.entity';
import { PermissionsService } from '../common/permissions/permissions.service';
import { AuditService } from '../common/audit/audit.service';

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/;
const LOCKOUT_WINDOW_MS = 15 * 60_000;

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
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly permissionsService: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  private async buildAccessPayload(user: User, jti: string) {
    const permissions = user.role === 'super_admin'
      ? ['*']
      : await this.permissionsService.getEffectivePermissionKeys(user.id);
    return {
      sub: user.id,
      tenantId: user.tenant_id,
      role: user.role,
      userLevel: user.user_level,
      name: user.full_name,
      jti,
      isSuperAdmin: user.role === 'super_admin',
      mustChange: user.must_change_pwd,
      permissions,
    };
  }

  // Lockout starts at 3 failed attempts (down from 5) to shrink brute-force window
  private getLockoutDurationMs(failedAttempts: number): number {
    if (failedAttempts >= 12) return 24 * 60 * 60_000; // 24h
    if (failedAttempts >= 8)  return 2  * 60 * 60_000; // 2h
    if (failedAttempts >= 5)  return 30 * 60_000;       // 30m
    if (failedAttempts >= 3)  return 5  * 60_000;       // 5m on 3rd attempt
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

  private setCsrfCookie(res: Response): void {
    const token = randomBytes(24).toString('base64url');
    res.cookie('XSRF-TOKEN', token, {
      ...this.getCookieOptions(false),
      maxAge: this.getRefreshTokenMaxAgeMs(),
    });
  }

  private getCookieSecure(): boolean {
    const raw = this.config.get<string>('COOKIE_SECURE');
    if (raw == null || raw.trim() === '') {
      const frontendUrl = (this.config.get<string>('FRONTEND_URL') || '').trim().toLowerCase();
      if (frontendUrl.startsWith('http://')) return false;
      if (frontendUrl.startsWith('https://')) return true;
      return this.config.get('NODE_ENV') === 'production';
    }
    return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
  }

  private getCookieSameSite(): 'strict' | 'lax' | 'none' {
    const raw = (this.config.get<string>('COOKIE_SAMESITE') || 'strict').trim().toLowerCase();
    if (raw === 'none') return this.getCookieSecure() ? 'none' : 'lax';
    if (raw === 'lax') return 'lax';
    return 'strict';
  }

  private getCookieOptions(httpOnly: boolean): CookieOptions {
    const domain = this.config.get<string>('COOKIE_DOMAIN')?.trim();
    const path = this.config.get<string>('COOKIE_PATH')?.trim() || '/';
    return {
      httpOnly,
      secure: this.getCookieSecure(),
      sameSite: this.getCookieSameSite(),
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

  async login(email: string, password: string, res: Response) {
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

    const jti = uuidv4();
    const accessToken = this.jwtService.sign(await this.buildAccessPayload(user, jti));

    const refreshJti = uuidv4();
    const refreshToken = this.jwtService.sign(
      { sub: user.id, jti: refreshJti },
      {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES', '7d'),
      },
    );

    res.cookie('refresh_token', refreshToken, {
      ...this.getCookieOptions(true),
      maxAge: this.getRefreshTokenMaxAgeMs(),
    });
    this.setCsrfCookie(res);

    await this.audit.log({ action: 'auth.login.success', actorId: user.id, tenantId: user.tenant_id });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.full_name,
        role: user.role,
        userLevel: user.user_level,
        mustChange: user.must_change_pwd,
        permissions:
          user.role === 'super_admin'
            ? ['*']
            : await this.permissionsService.getEffectivePermissionKeys(user.id),
      },
    };
  }

  async refresh(refreshToken: string, res: Response) {
    await this.cleanupExpiredRevokedTokens();
    let payload: { sub: string; jti: string; exp: number; iat: number };
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

    const jti = uuidv4();
    const accessToken = this.jwtService.sign(await this.buildAccessPayload(user, jti));

    const refreshJti = uuidv4();
    const newRefresh = this.jwtService.sign(
      { sub: user.id, jti: refreshJti },
      {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES', '7d'),
      },
    );

    res.cookie('refresh_token', newRefresh, {
      ...this.getCookieOptions(true),
      maxAge: this.getRefreshTokenMaxAgeMs(),
    });
    this.setCsrfCookie(res);

    await this.audit.log({ action: 'auth.token.refreshed', actorId: user.id, tenantId: user.tenant_id });

    return { accessToken };
  }

  async logout(jti: string, exp: number, res: Response) {
    await this.cleanupExpiredRevokedTokens();
    if (jti) {
      await this.revokedRepo.save({ jti, expires_at: new Date(exp * 1000) });
    }
    res.clearCookie('refresh_token', this.getCookieOptions(true));
    res.clearCookie('XSRF-TOKEN', this.getCookieOptions(false));
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

    const revokedAt = Date.now();

    // 1. Revoke the current access token
    if (jti) {
      await this.revokedRepo.save({ jti, expires_at: new Date(exp * 1000) });
    }

    // 2. Insert user-level sentinel to invalidate ALL other sessions.
    //    Any refresh token with iat < revokedAt will be rejected by isRevokedByUserSentinel().
    //    Delete any old sentinel for this user first to keep the table clean.
    await this.revokedRepo.delete({ jti: Like(`${REVOKE_ALL_PREFIX}${userId}:%`) });
    await this.revokedRepo.save({
      jti: `${REVOKE_ALL_PREFIX}${userId}:${revokedAt}`,
      expires_at: new Date(revokedAt + this.getRefreshTokenMaxAgeMs()),
    });

    await this.audit.log({ action: 'auth.password.changed', actorId: userId, tenantId: user.tenant_id });

    const newJti = uuidv4();
    const accessToken = this.jwtService.sign(
      await this.buildAccessPayload(
        { ...user, must_change_pwd: false } as User,
        newJti,
      ),
    );

    return { accessToken };
  }
}
