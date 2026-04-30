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
import { ChangePasswordDto, LoginDto, UpdateProfileDto } from './dto/auth.dto';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../common/permissions/permission-keys';
import { Public } from '../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.login(body.email, body.password, res);
  }

  @Post('refresh')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.['refresh_token'] as string | undefined;
    if (!token) throw new UnauthorizedException('No refresh token');
    return this.authService.refresh(token, res);
  }

  @Post('logout')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    return this.authService.logout(req.user.jti, req.user.exp, res);
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @RequirePermissions(PERMISSIONS.DASHBOARD_VIEW)
  async me(@Req() req: AuthenticatedRequest) {
    return req.user;
  }

  @Patch('change-password')
  @UseGuards(AuthGuard('jwt'))
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async changePassword(
    @Req() req: AuthenticatedRequest,
    @Body() body: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      req.user.sub,
      body.currentPassword,
      body.newPassword,
      req.user.jti,
      req.user.exp,
    );
  }

  @Patch('profile')
  @UseGuards(AuthGuard('jwt'))
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(req.user.sub, body);
  }

  @Get('preferences')
  @UseGuards(AuthGuard('jwt'))
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async getPreferences(@Req() req: AuthenticatedRequest) {
    return this.authService.getPreferences(req.user.sub);
  }

  @Patch('preferences')
  @UseGuards(AuthGuard('jwt'))
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async updatePreferences(
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    return this.authService.updatePreferences(req.user.sub, body);
  }
}
