import { Body, Controller, Get, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminService } from './admin.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/permissions/permission-keys';

@Controller('company')
@UseGuards(AuthGuard('jwt'))
export class CompanySettingsController {
  constructor(
    private readonly adminService: AdminService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get('settings')
  @RequirePermissions(PERMISSIONS.SETTINGS_VIEW)
  async getSettings(@Req() req: AuthenticatedRequest, @Query('tenantId') tenantId?: string) {
    const scopedTenantId = await this.tenantContext.resolve(req, tenantId);
    return this.adminService.getCompanySettings(scopedTenantId);
  }

  @Patch('settings')
  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  async updateSettings(
    @Req() req: AuthenticatedRequest,
    @Query('tenantId') tenantId: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const scopedTenantId = await this.tenantContext.resolve(req, tenantId);
    return this.adminService.updateCompanySettings(scopedTenantId, req.user.sub, body);
  }

  @Get('sync-config')
  @RequirePermissions(PERMISSIONS.SYNC_VIEW)
  async getSyncConfig(@Req() req: AuthenticatedRequest, @Query('tenantId') tenantId?: string) {
    const scopedTenantId = await this.tenantContext.resolve(req, tenantId);
    return this.adminService.getCompanySyncConfig(scopedTenantId);
  }

  @Patch('sync-config')
  @RequirePermissions(PERMISSIONS.SYNC_MANAGE)
  async updateSyncConfig(
    @Req() req: AuthenticatedRequest,
    @Query('tenantId') tenantId: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    const scopedTenantId = await this.tenantContext.resolve(req, tenantId);
    return this.adminService.updateCompanySyncConfig(scopedTenantId, req.user.sub, body);
  }

  @Post('sync-key/rotate')
  @RequirePermissions(PERMISSIONS.SYNC_MANAGE)
  async rotateSyncKey(@Req() req: AuthenticatedRequest, @Query('tenantId') tenantId?: string) {
    const scopedTenantId = await this.tenantContext.resolve(req, tenantId);
    return this.adminService.rotateSyncKey(scopedTenantId);
  }
}
