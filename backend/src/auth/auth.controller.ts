import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../common/types/auth-request';
import { ChangePasswordDto, LoginDto, SwitchCompanyDto, UpdateProfileDto } from './dto/auth.dto';
import { Public } from '../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // 5 attempts per minute per IP — stops bot-speed brute-force while staying
  // tolerant of humans retyping a wrong password. The DB-backed account
  // lockout (auth.service.getLockoutDurationMs) handles the slower per-user
  // attack pattern; this guard handles the fast per-IP one.
  @Post('login')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.login(body.email, body.password, res, req);
  }

  // 20 refreshes per minute — prevents token-refresh flooding while allowing normal browser retries
  @Post('refresh')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.['refresh_token'] as string | undefined;
    if (!token) throw new UnauthorizedException('No refresh token');
    return this.authService.refresh(token, res, req);
  }

  @Get('session')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async session(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.['refresh_token'] as string | undefined;
    if (!token) return { authenticated: false };
    return this.authService.session(token, res, req);
  }

  @Post('logout')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    return this.authService.logout(req.user.jti, req.user.exp, res, req);
  }

  @Post('logout-all')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  async logoutAll(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    return this.authService.logoutAll(req.user.sub, req.user.jti, req.user.exp, res, req);
  }

  // Any authenticated user can view their own profile — no extra permission needed
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  async me(@Req() req: AuthenticatedRequest) {
    return req.user;
  }

  @Get('companies')
  @UseGuards(AuthGuard('jwt'))
  async companies(@Req() req: AuthenticatedRequest) {
    return this.authService.getCompanies(req.user.sub);
  }

  // Public only because the login-time company-selection token is verified
  // manually here. Existing dashboard sessions still pass a Bearer token and
  // are validated inside AuthService.switchCompanyFromToken().
  @Post('switch-company')
  @Public()
  @HttpCode(200)
  async switchCompany(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: SwitchCompanyDto,
  ) {
    return this.authService.switchCompanyFromToken(
      req.headers.authorization,
      body.tenantId,
      body.selectionToken,
      res,
      req,
    );
  }

  // 3 password changes per 15 minutes — prevents brute-force via change-password
  @Patch('change-password')
  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: { limit: 3, ttl: 900_000 } })
  async changePassword(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      req.user.sub,
      body.currentPassword,
      body.newPassword,
      req.user.jti,
      req.user.exp,
      req.user.membershipId,
      res,
      req,
    );
  }

  // Block email changes via profile — name-only updates allowed
  @Patch('profile')
  @UseGuards(AuthGuard('jwt'))
  async updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(req.user.sub, body);
  }

  @Get('preferences')
  @UseGuards(AuthGuard('jwt'))
  async getPreferences(@Req() req: AuthenticatedRequest) {
    return this.authService.getPreferences(req.user.sub);
  }

  @Patch('preferences')
  @UseGuards(AuthGuard('jwt'))
  async updatePreferences(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.authService.updatePreferences(req.user.sub, body);
  }
}
