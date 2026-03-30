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
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { Request, Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: { email: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.login(body.email, body.password, res);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req as any).cookies?.['refresh_token'];
    if (!token) throw new UnauthorizedException('No refresh token');
    return this.authService.refresh(token, res);
  }

  @Post('logout')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(200)
  async logout(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    return this.authService.logout(req.user.jti, req.user.exp, res);
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  async me(@Req() req: any) {
    return req.user;
  }

  @Patch('change-password')
  @UseGuards(AuthGuard('jwt'))
  async changePassword(
    @Req() req: any,
    @Body() body: { currentPassword: string; newPassword: string },
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
  async updateProfile(
    @Req() req: any,
    @Body() body: { full_name?: string; email?: string },
  ) {
    return this.authService.updateProfile(req.user.sub, body);
  }

  @Get('preferences')
  @UseGuards(AuthGuard('jwt'))
  async getPreferences(@Req() req: any) {
    return this.authService.getPreferences(req.user.sub);
  }

  @Patch('preferences')
  @UseGuards(AuthGuard('jwt'))
  async updatePreferences(
    @Req() req: any,
    @Body() body: Record<string, any>,
  ) {
    return this.authService.updatePreferences(req.user.sub, body);
  }
}
