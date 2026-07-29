import {
  Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe,
  Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { SyncApiKeyGuard } from '../../common/guards/sync-api-key.guard';
import { PERMISSIONS } from '../../common/permissions/permission-keys';
import { PermissionsService } from '../../common/permissions/permissions.service';
import { TenantContextService } from '../../common/tenant-context.service';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import {
  AgentUpdateProgressDto, AgentUpdateResultDto, ClaimAgentUpdateDto,
  CreateAgentReleaseDto, RequestAgentUpdateDto,
} from './agent-release.dto';
import { AgentReleaseService } from './agent-release.service';

@Controller('admin')
@UseGuards(AuthGuard('jwt'))
export class AdminAgentReleaseController {
  constructor(
    private readonly service: AgentReleaseService,
    private readonly tenants: TenantContextService,
    private readonly permissions: PermissionsService,
  ) {}

  private superAdmin(req: AuthenticatedRequest) {
    if (req.user.role !== 'super_admin') throw new ForbiddenException('Super admin access required');
  }

  @Post('agent-releases')
  @RequirePermissions(PERMISSIONS.SYNC_AGENT_UPDATE_MANAGE_RELEASES)
  create(@Req() req: AuthenticatedRequest,@Body() dto: CreateAgentReleaseDto) {
    this.superAdmin(req);
    return this.service.create(req.user.sub,dto);
  }

  @Post('agent-releases/:id/validate')
  @RequirePermissions(PERMISSIONS.SYNC_AGENT_UPDATE_MANAGE_RELEASES)
  validate(@Req() req: AuthenticatedRequest,@Param('id',new ParseUUIDPipe()) id: string) {
    this.superAdmin(req);
    return this.service.validate(id,req.user.sub);
  }

  @Post('agent-releases/:id/publish')
  @RequirePermissions(PERMISSIONS.SYNC_AGENT_UPDATE_MANAGE_RELEASES)
  publish(@Req() req: AuthenticatedRequest,@Param('id',new ParseUUIDPipe()) id: string) {
    this.superAdmin(req);
    return this.service.publish(id,req.user.sub);
  }

  @Post('agent-releases/:id/revoke')
  @RequirePermissions(PERMISSIONS.SYNC_AGENT_UPDATE_MANAGE_RELEASES)
  revoke(@Req() req: AuthenticatedRequest,@Param('id',new ParseUUIDPipe()) id: string) {
    this.superAdmin(req);
    return this.service.revoke(id,req.user.sub);
  }

  @Get('agent-releases')
  @RequirePermissions(PERMISSIONS.SYNC_AGENT_UPDATE_MANAGE_RELEASES)
  list(@Req() req: AuthenticatedRequest) {
    this.superAdmin(req);
    return this.service.list();
  }

  @Get('agent-releases/:id')
  @RequirePermissions(PERMISSIONS.SYNC_AGENT_UPDATE_MANAGE_RELEASES)
  get(@Req() req: AuthenticatedRequest,@Param('id',new ParseUUIDPipe()) id: string) {
    this.superAdmin(req);
    return this.service.get(id);
  }

  @Post('sync-agents/:agentId/update')
  @RequirePermissions(PERMISSIONS.SYNC_AGENT_UPDATE)
  async request(
    @Req() req: AuthenticatedRequest,@Param('agentId') agentId: string,
    @Body() dto: RequestAgentUpdateDto,
  ) {
    const tenantId = await this.tenants.resolve(req);
    if (dto.retryFailed && !await this.permissions.canMembershipAccess(
      req.membershipId,tenantId,req.user.sub,[PERMISSIONS.SYNC_AGENT_UPDATE_RETRY_FAILED],
    )) {
      throw new ForbiddenException('Missing failed-update retry permission');
    }
    return this.service.request(
      tenantId,agentId,req.user.sub,dto,req.ip,req.headers['user-agent'],req.correlationId,
    );
  }

  @Get('sync-agents/:agentId/update-status')
  @RequirePermissions(PERMISSIONS.SYNC_STATUS_VIEW)
  async status(@Req() req: AuthenticatedRequest,@Param('agentId') agentId: string) {
    return this.service.updateStatus(await this.tenants.resolve(req),agentId);
  }

  @Get('agent-update-requests')
  @RequirePermissions(PERMISSIONS.SYNC_STATUS_VIEW)
  async requests(@Req() req: AuthenticatedRequest) {
    if (req.user.role === 'super_admin' && !req.tenantId) return this.service.listRequests();
    return this.service.listRequests(await this.tenants.resolve(req));
  }

  @Get('agent-update-requests/:id')
  @RequirePermissions(PERMISSIONS.SYNC_STATUS_VIEW)
  async requestById(
    @Req() req: AuthenticatedRequest,@Param('id',new ParseUUIDPipe()) id: string,
  ) {
    if (req.user.role === 'super_admin' && !req.tenantId) return this.service.listRequests(undefined,id);
    return this.service.listRequests(await this.tenants.resolve(req),id);
  }

  @Post('agent-update-requests/:id/cancel')
  @RequirePermissions(PERMISSIONS.SYNC_AGENT_UPDATE)
  async cancel(
    @Req() req: AuthenticatedRequest,@Param('id',new ParseUUIDPipe()) id: string,
  ) {
    return this.service.cancel(await this.tenants.resolve(req),id,req.user.sub);
  }
}

type SyncAgentRequest = {
  syncTenantId?: string;
};

@Controller('sync-agent')
@Public()
@UseGuards(SyncApiKeyGuard)
export class SyncAgentReleaseController {
  constructor(private readonly service: AgentReleaseService) {}
  private tenant(req: SyncAgentRequest) { return String(req.syncTenantId); }

  @Get('releases/current')
  current(
    @Req() req: SyncAgentRequest,@Query('agentId') agentId: string,
    @Query('currentVersion') currentVersion: string,@Query('channel') channel?: string,
  ) {
    return this.service.current(this.tenant(req),agentId,currentVersion,channel);
  }

  @Get('releases/:id/manifest')
  manifest(
    @Req() req: SyncAgentRequest,@Param('id',new ParseUUIDPipe()) id: string,
    @Query('agentId') agentId: string,
  ) {
    return this.service.manifestFor(this.tenant(req),id,agentId);
  }

  @Get('releases/:id/package')
  async package(
    @Req() req: SyncAgentRequest,@Param('id',new ParseUUIDPipe()) id: string,
    @Query('agentId') agentId: string,@Res() response: Response,
  ) {
    const packaged = await this.service.packageFor(this.tenant(req),id,agentId);
    response.setHeader('Content-Type','application/zip');
    response.setHeader('Content-Length',String(packaged.stats.size));
    response.setHeader('Content-Disposition',`attachment; filename="${packaged.release.package_path}"`);
    response.setHeader('Cache-Control','private, no-store');
    packaged.stream.pipe(response);
  }

  @Post('update-requests/claim')
  @HttpCode(200)
  claim(@Req() req: SyncAgentRequest,@Body() dto: ClaimAgentUpdateDto) {
    return this.service.claim(this.tenant(req),dto);
  }

  @Post('update-requests/:id/progress')
  @HttpCode(200)
  progress(
    @Req() req: SyncAgentRequest,@Param('id',new ParseUUIDPipe()) id: string,
    @Body() dto: AgentUpdateProgressDto,
  ) {
    return this.service.progress(this.tenant(req),id,dto);
  }

  @Post('update-requests/:id/complete')
  @HttpCode(200)
  complete(
    @Req() req: SyncAgentRequest,@Param('id',new ParseUUIDPipe()) id: string,
    @Body() dto: AgentUpdateResultDto,
  ) {
    return this.service.complete(this.tenant(req),id,dto);
  }

  @Post('update-requests/:id/fail')
  @HttpCode(200)
  fail(
    @Req() req: SyncAgentRequest,@Param('id',new ParseUUIDPipe()) id: string,
    @Body() dto: AgentUpdateResultDto,
  ) {
    return this.service.fail(this.tenant(req),id,dto);
  }

  @Post('update-requests/:id/rollback')
  @HttpCode(200)
  rollback(
    @Req() req: SyncAgentRequest,@Param('id',new ParseUUIDPipe()) id: string,
    @Body() dto: AgentUpdateResultDto,
  ) {
    return this.service.rollback(this.tenant(req),id,dto);
  }
}
