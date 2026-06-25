import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
  BadRequestException,
  Body,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminService } from './admin.service';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import { ModuleParamDto, SyncLogsQueryDto } from './dto/admin.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/permissions/permission-keys';
import { TenantContextService } from '../../common/tenant-context.service';

const VALID_MODULES = ['orders', 'products', 'customers', 'inventory', 'all'];
const VALID_SYNC_MODES = ['incremental', 'full'];

@Controller('sync')
@UseGuards(AuthGuard('jwt'))
export class SyncController {
  constructor(
    private readonly adminService: AdminService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get('status')
  @RequirePermissions(PERMISSIONS.SYNC_VIEW)
  async getStatus(@Req() req: AuthenticatedRequest, @Query('tenantId') tenantId?: string) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    const scopedTenantId = await this.tenantContext.resolve(req, tenantId);
    return this.adminService.getSyncStatus(scopedTenantId);
  }

  @Get('logs')
  @RequirePermissions(PERMISSIONS.SYNC_VIEW)
  async getLogs(
    @Req() req: AuthenticatedRequest,
    @Query() query: SyncLogsQueryDto,
  ) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    const scopedTenantId = await this.tenantContext.resolve(req, query.tenantId);
    return this.adminService.getSyncLogs(
      scopedTenantId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Post('trigger/:module')
  @RequirePermissions(PERMISSIONS.SYNC_MANAGE)
  async triggerSync(
    @Req() req: AuthenticatedRequest,
    @Param() params: ModuleParamDto,
    @Body() body: { syncMode?: string; sync_mode?: string },
    @Query('tenantId') tenantId?: string,
  ) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    const module = params.module;
    if (!VALID_MODULES.includes(module)) {
      throw new BadRequestException(
        `Invalid module: ${module}. Valid: ${VALID_MODULES.join(', ')}`,
      );
    }
    const syncMode = String(body?.syncMode || body?.sync_mode || 'incremental').trim().toLowerCase();
    if (!VALID_SYNC_MODES.includes(syncMode)) {
      throw new BadRequestException('Invalid syncMode. Valid: incremental, full');
    }
    const scopedTenantId = await this.tenantContext.resolve(req, tenantId);
    return this.adminService.createSyncTrigger(
      scopedTenantId,
      module,
      syncMode as 'incremental' | 'full',
      req.user.sub,
    );
  }

  @Get('triggers/pending')
  @RequirePermissions(PERMISSIONS.SYNC_VIEW)
  async getPendingTriggers(@Req() req: AuthenticatedRequest, @Query('tenantId') tenantId?: string) {
    // This endpoint is called by the sync engine to poll for manual triggers.
    // Allow admin/super_admin and also sync-key auth (handled separately in ingest controller).
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    const scopedTenantId = await this.tenantContext.resolve(req, tenantId);
    return this.adminService.getPendingTriggers(scopedTenantId);
  }

  @Post('triggers/:id/cancel')
  @RequirePermissions(PERMISSIONS.SYNC_MANAGE)
  async cancelTrigger(
    @Req() req: AuthenticatedRequest,
    @Param('id') triggerId: string,
    @Query('tenantId') tenantId?: string,
  ) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    const scopedTenantId = await this.tenantContext.resolve(req, tenantId);
    return this.adminService.cancelSyncTrigger(scopedTenantId, triggerId, req.user.sub);
  }

  @Post('rotate-key')
  @RequirePermissions(PERMISSIONS.SYNC_ROTATE_KEY)
  async rotateOwnSyncKey(@Req() req: AuthenticatedRequest, @Query('tenantId') tenantId?: string) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    const scopedTenantId = await this.tenantContext.resolve(req, tenantId);
    return this.adminService.rotateSyncKey(scopedTenantId);
  }
}
