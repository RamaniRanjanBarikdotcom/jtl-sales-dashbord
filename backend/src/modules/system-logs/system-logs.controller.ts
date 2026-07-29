import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { SyncApiKeyGuard } from '../../common/guards/sync-api-key.guard';
import { PERMISSIONS } from '../../common/permissions/permission-keys';
import { TenantContextService } from '../../common/tenant-context.service';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import { CreateAgentEventDto, LogsExportDto, LogsQueryDto } from './system-logs.dto';
import { LogsScope, SystemLogsService } from './system-logs.service';

@Controller(['logs', 'admin/logs'])
@UseGuards(AuthGuard('jwt'))
export class SystemLogsController {
  constructor(private readonly logs: SystemLogsService, private readonly tenants: TenantContextService) {}

  @Get('summary')
  @RequirePermissions(PERMISSIONS.LOGS_SYSTEM_VIEW)
  async summary(@Req() req: AuthenticatedRequest, @Query() query: LogsQueryDto) {
    return this.logs.summary(await this.scope(req),query);
  }

  @Get(['system', 'events'])
  @RequirePermissions(PERMISSIONS.LOGS_SYSTEM_VIEW)
  async events(@Req() req: AuthenticatedRequest, @Query() query: LogsQueryDto) {
    return this.logs.listEvents(await this.scope(req),query);
  }

  @Get('events/:id')
  @RequirePermissions(PERMISSIONS.LOGS_SYSTEM_VIEW)
  async detail(@Req() req: AuthenticatedRequest, @Param('id',ParseIntPipe) id: number) {
    return this.logs.detail(await this.scope(req),String(id),this.canSeeStack(req));
  }

  @Get('events/:id/related')
  @RequirePermissions(PERMISSIONS.LOGS_SYSTEM_VIEW)
  async related(@Req() req: AuthenticatedRequest, @Param('id',ParseIntPipe) id: number) {
    return this.logs.related(await this.scope(req),String(id));
  }

  @Get('audit')
  @RequirePermissions(PERMISSIONS.LOGS_AUDIT_VIEW)
  async audit(@Req() req: AuthenticatedRequest, @Query() query: LogsQueryDto) {
    return this.logs.listAudit(await this.scope(req),query);
  }

  @Get('security')
  @RequirePermissions(PERMISSIONS.LOGS_SECURITY_VIEW)
  async security(@Req() req: AuthenticatedRequest, @Query() query: LogsQueryDto) {
    return this.logs.listSecurity(await this.scope(req),query);
  }

  @Get('sources')
  @RequirePermissions(PERMISSIONS.LOGS_SYSTEM_VIEW)
  async sources(@Req() req: AuthenticatedRequest) {
    return this.logs.sources(await this.scope(req));
  }

  @Post('export')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.LOGS_EXPORT)
  async export(
    @Req() req: AuthenticatedRequest,
    @Body() dto: LogsExportDto,
    @Res() response: Response,
  ) {
    const result = await this.logs.export(await this.scope(req),req.user.sub,dto,req.requestId);
    response.setHeader('Content-Type',result.contentType);
    response.setHeader('Content-Disposition',`attachment; filename="${result.filename}"`);
    response.send(result.content);
  }

  private async scope(req: AuthenticatedRequest): Promise<LogsScope> {
    if (req.tenantScope === 'all' && req.user.role === 'super_admin') {
      return { tenantIds: req.allowedTenantIds ?? [],includePlatform: true };
    }
    return { tenantIds: [(await this.tenants.resolve(req))],includePlatform: false };
  }

  private canSeeStack(req: AuthenticatedRequest) {
    return req.user.role === 'super_admin' || (req.user.permissions ?? []).includes(PERMISSIONS.LOGS_STACKTRACE_VIEW);
  }
}

@Controller('sync-agent/events')
@Public()
@UseGuards(SyncApiKeyGuard)
export class SyncAgentEventsController {
  constructor(private readonly logs: SystemLogsService) {}

  @Post()
  @HttpCode(202)
  ingest(
    @Req() req: { syncTenantId?: string },
    @Body() dto: CreateAgentEventDto,
  ) {
    return this.logs.ingestAgentEvent(String(req.syncTenantId),dto);
  }
}
