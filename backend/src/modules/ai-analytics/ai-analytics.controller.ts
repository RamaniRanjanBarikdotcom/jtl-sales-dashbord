import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
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

  @Post('ask')
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
