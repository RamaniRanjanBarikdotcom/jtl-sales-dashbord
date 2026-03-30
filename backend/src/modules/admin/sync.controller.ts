import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminService } from './admin.service';

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
}
