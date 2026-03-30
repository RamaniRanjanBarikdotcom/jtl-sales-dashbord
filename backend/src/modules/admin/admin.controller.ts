import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(AuthGuard('jwt'))
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ── Users ──────────────────────────────────────────────────────────────────

  @Get('users')
  getUsers(@Req() req: any, @Query('tenantId') tenantId?: string) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    return this.adminService.getUsers(
      req.user.role,
      req.user.tenantId,
      tenantId,
    );
  }

  @Post('users')
  createUser(@Req() req: any, @Body() body: any) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    return this.adminService.createUser(
      req.user.role,
      req.user.tenantId,
      body,
    );
  }

  @Patch('users/:id')
  updateUser(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: any,
  ) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    return this.adminService.updateUser(
      id,
      req.user.role,
      req.user.tenantId,
      body,
    );
  }

  @Patch('users/:id/deactivate')
  deactivateUser(@Param('id') id: string, @Req() req: any) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    return this.adminService.deactivateUser(
      id,
      req.user.role,
      req.user.tenantId,
    );
  }

  @Post('users/:id/reset-pwd')
  resetPassword(@Param('id') id: string, @Req() req: any) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    return this.adminService.resetPassword(
      id,
      req.user.role,
      req.user.tenantId,
    );
  }

  // ── Tenants (super_admin only) ─────────────────────────────────────────────

  @Get('tenants')
  getTenants(@Req() req: any) {
    if (req.user.role !== 'super_admin') throw new ForbiddenException();
    return this.adminService.getTenants();
  }

  @Post('tenants')
  createTenant(@Req() req: any, @Body() body: any) {
    if (req.user.role !== 'super_admin') throw new ForbiddenException();
    return this.adminService.createTenant(body, req.user.sub);
  }

  @Patch('tenants/:id')
  updateTenant(
    @Param('id') id: string,
    @Req() req: any,
    @Body() body: any,
  ) {
    if (req.user.role !== 'super_admin') throw new ForbiddenException();
    return this.adminService.updateTenant(id, body);
  }

  @Patch('tenants/:id/deactivate')
  deactivateTenant(@Param('id') id: string, @Req() req: any) {
    if (req.user.role !== 'super_admin') throw new ForbiddenException();
    return this.adminService.deactivateTenant(id);
  }

  @Post('tenants/:id/rotate-sync-key')
  rotateSyncKey(@Param('id') id: string, @Req() req: any) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    // admin can only rotate their own tenant's key
    const tenantId =
      req.user.role === 'admin' ? req.user.tenantId : id;
    return this.adminService.rotateSyncKey(tenantId);
  }

  @Get('platform/overview')
  platformOverview(@Req() req: any) {
    if (req.user.role !== 'super_admin') throw new ForbiddenException();
    return this.adminService.getPlatformOverview();
  }
}
