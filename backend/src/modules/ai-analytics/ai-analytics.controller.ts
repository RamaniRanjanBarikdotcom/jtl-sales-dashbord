import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/permissions/permission-keys';
import { TenantContextService } from '../../common/tenant-context.service';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import { AiAnalyticsService } from './ai-analytics.service';
import { AskQuestionDto, CreateConversationDto, FeedbackDto } from './ai-analytics.dto';

@Controller('ai/analytics')
@UseGuards(AuthGuard('jwt'))
@RequirePermissions(PERMISSIONS.AI_ANALYTICS_USE)
export class AiAnalyticsController {
  constructor(private readonly ai: AiAnalyticsService, private readonly tenants: TenantContextService) {}

  // Lets the UI say why the Copilot is unusable. Server errors are masked to
  // "Internal server error" by design, so without this the browser cannot tell
  // "switched off" apart from "genuinely broken".
  @Get('status')
  status() {
    return this.ai.status();
  }

  @Get('conversations')
  @RequirePermissions(PERMISSIONS.AI_ANALYTICS_USE, PERMISSIONS.AI_CONVERSATIONS_MANAGE)
  async list(@Req() req: AuthenticatedRequest) {
    return this.ai.listConversations(await this.tenants.resolve(req), req.user.sub);
  }

  @Post('conversations')
  @RequirePermissions(PERMISSIONS.AI_ANALYTICS_USE, PERMISSIONS.AI_CONVERSATIONS_MANAGE)
  async create(@Req() req: AuthenticatedRequest, @Body() dto: CreateConversationDto) {
    return this.ai.createConversation(await this.tenants.resolve(req), req.user.sub, dto);
  }

  @Get('conversations/:id/messages')
  @RequirePermissions(PERMISSIONS.AI_ANALYTICS_USE, PERMISSIONS.AI_CONVERSATIONS_MANAGE)
  async messages(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.ai.history(await this.tenants.resolve(req), req.user.sub, id);
  }

  // Every question costs a paid provider call, so the ask endpoint is capped
  // well below the global rate limit.
  @Post('ask')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(PERMISSIONS.AI_ANALYTICS_USE, PERMISSIONS.AI_SALES_VIEW)
  async ask(@Req() req: AuthenticatedRequest, @Body() dto: AskQuestionDto) {
    return this.ai.ask(await this.tenants.resolve(req), req.user.sub, req.user.permissions ?? [], dto);
  }

  @Post('feedback')
  @RequirePermissions(PERMISSIONS.AI_ANALYTICS_USE, PERMISSIONS.AI_FEEDBACK_SUBMIT)
  async feedback(@Req() req: AuthenticatedRequest, @Body() dto: FeedbackDto) {
    return this.ai.feedback(await this.tenants.resolve(req), req.user.sub, dto);
  }
}
