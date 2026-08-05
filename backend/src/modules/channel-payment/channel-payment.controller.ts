import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/permissions/permission-keys';
import { TenantContextService } from '../../common/tenant-context.service';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import {
  ChannelPaymentActivationDto,
  ChannelPaymentBackfillDto,
  ChannelPaymentPreviewDto,
  ChannelPaymentRuleDecisionDto,
  ChannelPaymentRollbackDto,
} from './channel-payment.dto';
import { ChannelPaymentService } from './channel-payment.service';

@Controller('channel-payment')
@UseGuards(AuthGuard('jwt'))
export class ChannelPaymentController {
  constructor(
    private readonly service: ChannelPaymentService,
    private readonly tenants: TenantContextService,
  ) {}

  @Get('settings')
  @RequirePermissions(PERMISSIONS.CHANNEL_PAYMENT_PREVIEW)
  async settings(@Req() req: AuthenticatedRequest) {
    return this.service.settings(await this.tenants.resolve(req));
  }

  @Get('rules')
  @RequirePermissions(PERMISSIONS.CHANNEL_PAYMENT_PREVIEW)
  async rules(@Req() req: AuthenticatedRequest) {
    return this.service.rules(await this.tenants.resolve(req));
  }

  @Get('preview')
  @RequirePermissions(PERMISSIONS.CHANNEL_PAYMENT_PREVIEW)
  async preview(@Req() req: AuthenticatedRequest, @Query() query: ChannelPaymentPreviewDto) {
    return this.service.preview(await this.tenants.resolve(req), query);
  }

  @Get('coverage')
  @RequirePermissions(PERMISSIONS.CHANNEL_PAYMENT_PREVIEW)
  async coverage(@Req() req: AuthenticatedRequest, @Query() query: ChannelPaymentPreviewDto) {
    return this.service.coverage(await this.tenants.resolve(req), query);
  }

  @Patch('rules/:ruleId/decision')
  @RequirePermissions(PERMISSIONS.CHANNEL_PAYMENT_MANAGE)
  async decideRule(
    @Req() req: AuthenticatedRequest,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body() dto: ChannelPaymentRuleDecisionDto,
  ) {
    return this.service.decideRule(await this.tenants.resolve(req), req.user.sub, ruleId, dto);
  }

  @Patch('activation')
  @RequirePermissions(PERMISSIONS.CHANNEL_PAYMENT_MANAGE)
  async setActivation(@Req() req: AuthenticatedRequest, @Body() dto: ChannelPaymentActivationDto) {
    return this.service.setActivation(await this.tenants.resolve(req), req.user.sub, dto);
  }

  @Post('backfill')
  @RequirePermissions(PERMISSIONS.CHANNEL_PAYMENT_BACKFILL)
  async backfill(@Req() req: AuthenticatedRequest, @Body() dto: ChannelPaymentBackfillDto) {
    return this.service.backfill(await this.tenants.resolve(req), req.user.sub, dto);
  }

  @Post('backfill/rollback')
  @RequirePermissions(PERMISSIONS.CHANNEL_PAYMENT_BACKFILL)
  async rollback(@Req() req: AuthenticatedRequest, @Body() dto: ChannelPaymentRollbackDto) {
    return this.service.rollback(await this.tenants.resolve(req), req.user.sub, dto);
  }
}
