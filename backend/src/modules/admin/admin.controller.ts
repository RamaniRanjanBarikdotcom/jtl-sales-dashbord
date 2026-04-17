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
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminService } from './admin.service';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import {
  CreateTenantDto,
  CreateUserDto,
  PagedTenantScopeQueryDto,
  TenantScopeQueryDto,
  UpdateTenantDto,
  UpdateUserDto,
} from './dto/admin.dto';

@Controller('admin')
@UseGuards(AuthGuard('jwt'))
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  private resolveTenantScope(req: AuthenticatedRequest, tenantId?: string): string {
    if (req.user.role === 'admin') return req.user.tenantId;
    const scopedTenant = tenantId || req.user.tenantId;
    if (!scopedTenant) {
      throw new BadRequestException(
        'tenantId is required for super_admin tenant-scoped operations',
      );
    }
    return scopedTenant;
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  @Get('users')
  getUsers(@Req() req: AuthenticatedRequest, @Query() query: PagedTenantScopeQueryDto) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    const scopedTenantId = this.resolveTenantScope(req, query.tenantId);
    return this.adminService.getUsers(
      req.user.role,
      scopedTenantId,
      scopedTenantId,
      query.page ?? 1,
      query.limit ?? 100,
    );
  }

  @Post('users')
  createUser(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateUserDto,
    @Query() query: TenantScopeQueryDto,
  ) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    const bodyTenantId = typeof body.tenantId === 'string' ? body.tenantId : undefined;
    const scopedTenantId = this.resolveTenantScope(req, query.tenantId || bodyTenantId);
    return this.adminService.createUser(
      req.user.role,
      scopedTenantId,
      { ...body, tenantId: scopedTenantId },
    );
  }

  @Patch('users/:id')
  updateUser(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
    @Query() query: TenantScopeQueryDto,
    @Body() body: UpdateUserDto,
  ) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    const scopedTenantId = this.resolveTenantScope(req, query.tenantId);
    return this.adminService.updateUser(
      id,
      req.user.role,
      scopedTenantId,
      body,
    );
  }

  @Patch('users/:id/deactivate')
  deactivateUser(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
    @Query() query: TenantScopeQueryDto,
  ) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    const scopedTenantId = this.resolveTenantScope(req, query.tenantId);
    return this.adminService.deactivateUser(
      id,
      req.user.role,
      scopedTenantId,
    );
  }

  @Post('users/:id/reset-pwd')
  resetPassword(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
    @Query() query: TenantScopeQueryDto,
  ) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    const scopedTenantId = this.resolveTenantScope(req, query.tenantId);
    return this.adminService.resetPassword(
      id,
      req.user.role,
      scopedTenantId,
    );
  }

  // ── Tenants (super_admin only) ─────────────────────────────────────────────

  @Get('tenants')
  getTenants(@Req() req: AuthenticatedRequest, @Query() query: PagedTenantScopeQueryDto) {
    if (req.user.role !== 'super_admin') throw new ForbiddenException();
    return this.adminService.getTenants(query.page ?? 1, query.limit ?? 100);
  }

  @Post('tenants')
  createTenant(@Req() req: AuthenticatedRequest, @Body() body: CreateTenantDto) {
    if (req.user.role !== 'super_admin') throw new ForbiddenException();
    return this.adminService.createTenant(body, req.user.sub);
  }

  @Patch('tenants/:id')
  updateTenant(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateTenantDto,
  ) {
    if (req.user.role !== 'super_admin') throw new ForbiddenException();
    return this.adminService.updateTenant(id, body);
  }

  @Patch('tenants/:id/deactivate')
  deactivateTenant(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    if (req.user.role !== 'super_admin') throw new ForbiddenException();
    return this.adminService.deactivateTenant(id);
  }

  @Post('tenants/:id/rotate-sync-key')
  rotateSyncKey(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
    @Query() query: TenantScopeQueryDto,
  ) {
    if (!['admin', 'super_admin'].includes(req.user.role)) {
      throw new ForbiddenException();
    }
    // admin can only rotate their own tenant's key
    const targetTenantId =
      req.user.role === 'admin' ? req.user.tenantId : (query.tenantId || id);
    return this.adminService.rotateSyncKey(targetTenantId as string);
  }

  @Get('platform/overview')
  platformOverview(@Req() req: AuthenticatedRequest) {
    if (req.user.role !== 'super_admin') throw new ForbiddenException();
    return this.adminService.getPlatformOverview();
  }
}
