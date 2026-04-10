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

const VALID_MODULES = ['orders', 'products', 'customers', 'inventory'];

@Controller('sync')
@UseGuards(AuthGuard('jwt'))
export class SyncController {
  constructor(private readonly adminService: AdminService) {}

  @Get('status')
  getStatus(@Req() req: any) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    return this.adminService.getSyncStatus(req.user.tenantId);
  }

  @Get('logs')
  getLogs(
    @Req() req: any,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    return this.adminService.getSyncLogs(
      req.user.tenantId,
      parseInt(page),
      parseInt(limit),
    );
  }

  @Post('trigger/:module')
  async triggerSync(
    @Req() req: any,
    @Param('module') module: string,
  ) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
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
  getPendingTriggers(@Req() req: any) {
    // This endpoint is called by the sync engine to poll for manual triggers.
    // Allow admin/super_admin and also sync-key auth (handled separately in ingest controller).
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    return this.adminService.getPendingTriggers(req.user.tenantId);
  }
}
