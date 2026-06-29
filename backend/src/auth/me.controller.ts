import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { AuthenticatedRequest } from '../common/types/auth-request';
import { SwitchCompanyDto } from './dto/auth.dto';
import { AuthService } from './auth.service';

@Controller('me')
@UseGuards(AuthGuard('jwt'))
export class MeController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  me(@Req() req: AuthenticatedRequest) {
    return {
      ...req.user,
      tenantId: req.tenantId ?? req.user.tenantId ?? null,
      tenantRole: req.tenantRole ?? null,
      membershipId: req.membershipId ?? req.user.membershipId ?? null,
    };
  }

  @Get('tenants')
  tenants(@Req() req: AuthenticatedRequest) {
    return this.authService.getCompanies(req.user.sub);
  }

  @Post('switch-tenant')
  @HttpCode(200)
  switchTenant(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: SwitchCompanyDto,
  ) {
    return this.authService.switchCompany(req.user.sub, body.tenantId, res, req);
  }
}
