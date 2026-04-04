import { Injectable, UnauthorizedException, ForbiddenException, HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../entities/user.entity';
import { RevokedToken } from '../entities/revoked-token.entity';

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{8,}$/;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(RevokedToken) private readonly revokedRepo: Repository<RevokedToken>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string, res: any) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!user.is_active) throw new ForbiddenException({ code: 'TENANT_INACTIVE', message: 'Account inactive' });
    if (user.locked_until && user.locked_until > new Date()) {
      throw new HttpException({ code: 'ACCOUNT_LOCKED', message: 'Account locked', locked_until: user.locked_until }, 423);
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      user.failed_login_attempts++;
      if (user.failed_login_attempts >= 5) {
        user.locked_until = new Date(Date.now() + 15 * 60_000);
      }
      await this.userRepo.save(user);
      throw new UnauthorizedException('Invalid credentials');
    }

    user.failed_login_attempts = 0;
    user.locked_until = null;
    user.last_login_at = new Date();
    await this.userRepo.save(user);

    const jti = uuidv4();
    const accessToken = this.jwtService.sign({
      sub: user.id,
      tenantId: user.tenant_id,
      role: user.role,
      userLevel: user.user_level,
      name: user.full_name,
      jti,
      isSuperAdmin: user.role === 'super_admin',
      mustChange: user.must_change_pwd,
    });

    const refreshJti = uuidv4();
    const refreshToken = this.jwtService.sign(
      { sub: user.id, jti: refreshJti },
      {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES', '7d'),
      },
    );

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.full_name,
        role: user.role,
        userLevel: user.user_level,
        mustChange: user.must_change_pwd,
      },
    };
  }

  async refresh(refreshToken: string, res: any) {
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const revoked = await this.revokedRepo.findOne({ where: { jti: payload.jti } });
    if (revoked) throw new UnauthorizedException('Refresh token revoked');

    // Revoke old refresh token (token rotation).
    // ON CONFLICT: two concurrent refreshes with the same token can both pass the
    // findOne check above before either one commits. The second insert gets a
    // duplicate-key error — safe to ignore (first call already revoked it).
    try {
      await this.revokedRepo.save({
        jti: payload.jti,
        expires_at: new Date(payload.exp * 1000),
      });
    } catch (e: any) {
      if (!e.message?.includes('duplicate key')) throw e;
      // concurrent refresh race — token is revoked by the first call; continue
    }

    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user || !user.is_active) throw new UnauthorizedException('User not found');

    const jti = uuidv4();
    const accessToken = this.jwtService.sign({
      sub: user.id,
      tenantId: user.tenant_id,
      role: user.role,
      userLevel: user.user_level,
      name: user.full_name,
      jti,
      isSuperAdmin: user.role === 'super_admin',
      mustChange: user.must_change_pwd,
    });

    const refreshJti = uuidv4();
    const newRefresh = this.jwtService.sign(
      { sub: user.id, jti: refreshJti },
      { secret: this.config.get('JWT_REFRESH_SECRET'), expiresIn: '7d' },
    );

    res.cookie('refresh_token', newRefresh, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return { accessToken };
  }

  async logout(jti: string, exp: number, res: any) {
    if (jti) {
      await this.revokedRepo.save({ jti, expires_at: new Date(exp * 1000) });
    }
    res.clearCookie('refresh_token');
    return { ok: true };
  }

  async updateProfile(userId: string, body: { full_name?: string; email?: string }) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (body.full_name) user.full_name = body.full_name.trim();
    if (body.email) {
      const existing = await this.userRepo.findOne({ where: { email: body.email } });
      if (existing && existing.id !== userId) {
        throw new UnauthorizedException('Email already in use');
      }
      user.email = body.email.toLowerCase().trim();
    }
    await this.userRepo.save(user);
    return { ok: true, full_name: user.full_name, email: user.email };
  }

  async getPreferences(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    return { data: user.preferences ?? {} };
  }

  async updatePreferences(userId: string, prefs: Record<string, any>) {
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
    if (!valid) throw new UnauthorizedException('Current password incorrect');

    const hash = await bcrypt.hash(newPwd, 12);
    user.password_hash = hash;
    user.must_change_pwd = false;
    await this.userRepo.save(user);

    // Revoke current token so frontend gets fresh one
    if (jti) {
      await this.revokedRepo.save({ jti, expires_at: new Date(exp * 1000) });
    }

    const newJti = uuidv4();
    const accessToken = this.jwtService.sign({
      sub: user.id,
      tenantId: user.tenant_id,
      role: user.role,
      userLevel: user.user_level,
      name: user.full_name,
      jti: newJti,
      isSuperAdmin: user.role === 'super_admin',
      mustChange: false,
    });

    return { accessToken };
  }
}
