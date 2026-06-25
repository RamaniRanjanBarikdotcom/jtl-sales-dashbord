import { Body, Controller, Get, Patch, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminService } from './admin.service';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/permissions/permission-keys';

@Controller('platform')
@UseGuards(AuthGuard('jwt'))
export class PlatformSettingsController {
  constructor(private readonly adminService: AdminService) {}

  private assertSuperAdmin(req: AuthenticatedRequest) {
    if (req.user.role !== 'super_admin') throw new ForbiddenException();
  }

  @Get('settings')
  @RequirePermissions(PERMISSIONS.ADMIN_MANAGE)
  getSettings(@Req() req: AuthenticatedRequest) {
    this.assertSuperAdmin(req);
    return this.adminService.getPlatformSettings();
  }

  @Patch('settings')
  @RequirePermissions(PERMISSIONS.ADMIN_MANAGE)
  updateSettings(@Req() req: AuthenticatedRequest, @Body() body: Record<string, unknown>) {
    this.assertSuperAdmin(req);
    return this.adminService.updatePlatformSettings(req.user.sub, body);
  }

  @Get('health')
  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  getHealth(@Req() req: AuthenticatedRequest) {
    this.assertSuperAdmin(req);
    return this.adminService.getPlatformHealth();
  }

  @Get('audit-retention')
  @RequirePermissions(PERMISSIONS.ADMIN_MANAGE)
  async getAuditRetention(@Req() req: AuthenticatedRequest) {
    this.assertSuperAdmin(req);
    const settings = await this.adminService.getPlatformSettings();
    return { audit_retention_days: settings.audit_retention_days };
  }

  @Patch('audit-retention')
  @RequirePermissions(PERMISSIONS.ADMIN_MANAGE)
  updateAuditRetention(@Req() req: AuthenticatedRequest, @Body() body: { audit_retention_days?: number }) {
    this.assertSuperAdmin(req);
    return this.adminService.updatePlatformSettings(req.user.sub, {
      audit_retention_days: Number(body.audit_retention_days ?? 365),
    });
  }
}
