import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/permissions/permission-keys';
import { PermissionsService } from '../../common/permissions/permissions.service';
import { SyncApiKeyGuard } from '../../common/guards/sync-api-key.guard';
import { TenantContextService } from '../../common/tenant-context.service';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import {
  AgentHeartbeatDto, ClaimCommandDto, COMMAND_PERMISSION, CommandProgressDto,
  CommandResultDto, CreateSyncCommandDto,
} from './sync-control.dto';
import { SyncControlService } from './sync-control.service';

@Controller('admin')
@UseGuards(AuthGuard('jwt'))
export class AdminSyncControlController {
  constructor(
    private readonly service: SyncControlService,
    private readonly tenants: TenantContextService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('sync-control/status')
  @RequirePermissions(PERMISSIONS.SYNC_STATUS_VIEW)
  async status(@Req() req: AuthenticatedRequest) {
    return this.service.status(await this.tenants.resolve(req));
  }

  @Get('sync-agents')
  @RequirePermissions(PERMISSIONS.SYNC_STATUS_VIEW)
  async agents(@Req() req: AuthenticatedRequest) {
    return (await this.service.status(await this.tenants.resolve(req))).agents;
  }

  @Get('sync-agents/:agentId')
  @RequirePermissions(PERMISSIONS.SYNC_STATUS_VIEW)
  async agent(@Req() req: AuthenticatedRequest, @Param('agentId') agentId: string) {
    return this.service.getAgent(await this.tenants.resolve(req),agentId);
  }

  @Get('sync-commands')
  @RequirePermissions(PERMISSIONS.SYNC_HISTORY_VIEW)
  async commands(@Req() req: AuthenticatedRequest, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.listCommands(await this.tenants.resolve(req), Number(page) || 1, Number(limit) || 50);
  }

  @Get('sync-commands/:id')
  @RequirePermissions(PERMISSIONS.SYNC_HISTORY_VIEW)
  async command(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.getCommand(await this.tenants.resolve(req),id);
  }

  @Post('sync-commands')
  @RequirePermissions(PERMISSIONS.SYNC_STATUS_VIEW)
  async create(@Req() req: AuthenticatedRequest, @Body() dto: CreateSyncCommandDto) {
    const tenantId = await this.tenants.resolve(req);
    if (req.user.role !== 'super_admin') {
      const allowed = await this.permissions.canMembershipAccess(
        req.membershipId,tenantId,req.user.sub,[COMMAND_PERMISSION[dto.commandType]],
      );
      if (!allowed) throw new ForbiddenException('Missing command permission');
    }
    const headers = req.headers;
    return this.service.create(
      tenantId,req.user.sub,dto,req.ip,headers['user-agent'],req.correlationId,
    );
  }

  @Post('sync-commands/:id/cancel')
  @RequirePermissions(PERMISSIONS.SYNC_CANCEL)
  @HttpCode(200)
  async cancel(@Req() req: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.cancel(await this.tenants.resolve(req),id,req.user.sub);
  }
}

@Controller('sync-agent')
@Public()
@UseGuards(SyncApiKeyGuard)
export class SyncAgentController {
  constructor(private readonly service: SyncControlService) {}
  private tenant(req: { syncTenantId?: string }) { return String(req.syncTenantId); }

  @Post('heartbeat')
  @HttpCode(200)
  heartbeat(@Req() req: { syncTenantId?: string }, @Body() dto: AgentHeartbeatDto) {
    return this.service.heartbeat(this.tenant(req), dto);
  }

  @Post('commands/claim')
  @HttpCode(200)
  claim(@Req() req: { syncTenantId?: string }, @Body() dto: ClaimCommandDto) {
    return this.service.claim(this.tenant(req), dto.agentId);
  }

  @Post('commands/:id/progress')
  @HttpCode(200)
  progress(@Req() req: { syncTenantId?: string }, @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CommandProgressDto) {
    return this.service.progress(this.tenant(req), dto.agentId, id, dto);
  }

  @Post('commands/:id/lease')
  @HttpCode(200)
  renew(@Req() req: { syncTenantId?: string }, @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ClaimCommandDto) {
    return this.service.renew(this.tenant(req), dto.agentId, id);
  }

  @Post('commands/:id/complete')
  @HttpCode(200)
  complete(@Req() req: { syncTenantId?: string }, @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CommandResultDto) {
    return this.service.finish(this.tenant(req), body.agentId, id, 'completed', body);
  }

  @Post('commands/:id/fail')
  @HttpCode(200)
  fail(@Req() req: { syncTenantId?: string }, @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CommandResultDto) {
    return this.service.finish(this.tenant(req), body.agentId, id, 'failed', body);
  }

  @Post('commands/:id/cancelled')
  @HttpCode(200)
  cancelled(@Req() req: { syncTenantId?: string }, @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: CommandResultDto) {
    return this.service.finish(this.tenant(req), body.agentId, id, 'cancelled', body);
  }
}
