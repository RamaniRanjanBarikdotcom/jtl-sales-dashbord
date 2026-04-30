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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminService } from './admin.service';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import { ModuleParamDto, SyncLogsQueryDto } from './dto/admin.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/permissions/permission-keys';

const VALID_MODULES = ['orders', 'products', 'customers', 'inventory'];

@Controller('sync')
@UseGuards(AuthGuard('jwt'))
export class SyncController {
  constructor(private readonly adminService: AdminService) {}

  @Get('status')
  @RequirePermissions(PERMISSIONS.SYNC_VIEW)
  getStatus(@Req() req: AuthenticatedRequest) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    return this.adminService.getSyncStatus(req.user.tenantId);
  }

  @Get('logs')
  @RequirePermissions(PERMISSIONS.SYNC_VIEW)
  getLogs(
    @Req() req: AuthenticatedRequest,
    @Query() query: SyncLogsQueryDto,
  ) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    return this.adminService.getSyncLogs(
      req.user.tenantId,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Post('trigger/:module')
  @RequirePermissions(PERMISSIONS.SYNC_MANAGE)
  async triggerSync(
    @Req() req: AuthenticatedRequest,
    @Param() params: ModuleParamDto,
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
    return this.adminService.createSyncTrigger(
      req.user.tenantId,
      module,
      req.user.sub,
    );
  }

  @Get('triggers/pending')
  @RequirePermissions(PERMISSIONS.SYNC_VIEW)
  getPendingTriggers(@Req() req: AuthenticatedRequest) {
    // This endpoint is called by the sync engine to poll for manual triggers.
    // Allow admin/super_admin and also sync-key auth (handled separately in ingest controller).
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    return this.adminService.getPendingTriggers(req.user.tenantId);
  }

  @Post('rotate-key')
  @RequirePermissions(PERMISSIONS.SYNC_MANAGE)
  rotateOwnSyncKey(@Req() req: AuthenticatedRequest) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    return this.adminService.rotateSyncKey(req.user.tenantId);
  }
}
