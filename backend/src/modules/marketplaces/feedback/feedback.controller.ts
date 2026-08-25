import { Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../../common/permissions/permission-keys';
import { TenantContextService } from '../../../common/tenant-context.service';
import { AuthenticatedRequest } from '../../../common/types/auth-request';
import { FeedbackCapabilityService } from './feedback-capability.service';
import { FeedbackReadService } from './feedback-read.service';

@Controller('marketplaces')
@UseGuards(AuthGuard('jwt'))
export class FeedbackController {
  constructor(
    private readonly capabilities: FeedbackCapabilityService,
    private readonly reads: FeedbackReadService,
    private readonly tenants: TenantContextService,
  ) {}

  @Get('accounts/:id/feedback/sources')
  @RequirePermissions(PERMISSIONS.MARKETPLACES_VIEW)
  async sources(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.capabilities.sources(await this.tenants.resolve(req), id);
  }

  @Get('accounts/:id/feedback/capabilities')
  @RequirePermissions(PERMISSIONS.MARKETPLACES_VIEW)
  async capabilityMatrix(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.capabilities.capabilities(await this.tenants.resolve(req), id);
  }

  @Post('accounts/:id/feedback/test')
  @RequirePermissions(PERMISSIONS.MARKETPLACES_MANAGE)
  async test(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.capabilities.test(await this.tenants.resolve(req), id);
  }

  @Get('accounts/:id/feedback/summary')
  @RequirePermissions(PERMISSIONS.MARKETPLACES_VIEW)
  async summary(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.capabilities.summary(await this.tenants.resolve(req), id);
  }

  @Get('review-insights')
  @RequirePermissions(PERMISSIONS.MARKETPLACES_VIEW)
  async insights(@Req() req: AuthenticatedRequest, @Query('accountId', ParseUUIDPipe) accountId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50) {
    return this.reads.insights(await this.tenants.resolve(req), accountId, page, limit);
  }

  @Get('review-trends')
  @RequirePermissions(PERMISSIONS.MARKETPLACES_VIEW)
  async trends(@Req() req: AuthenticatedRequest, @Query('accountId', ParseUUIDPipe) accountId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 100) {
    return this.reads.trends(await this.tenants.resolve(req), accountId, page, limit);
  }

  @Get('rating-aggregates')
  @RequirePermissions(PERMISSIONS.MARKETPLACES_VIEW)
  async ratings(@Req() req: AuthenticatedRequest, @Query('accountId', ParseUUIDPipe) accountId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50) {
    return this.reads.ratingAggregates(await this.tenants.resolve(req), accountId, page, limit);
  }
}
