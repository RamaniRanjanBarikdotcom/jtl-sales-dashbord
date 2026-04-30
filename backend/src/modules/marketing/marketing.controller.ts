import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { MarketingService } from './marketing.service';
import { QueryFiltersDto } from '../../common/dto/query-filters.dto';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/permissions/permission-keys';

@Controller('marketing')
@UseGuards(AuthGuard('jwt'))
@RequirePermissions(PERMISSIONS.MARKETING_VIEW)
export class MarketingController {
  constructor(private readonly mktService: MarketingService) {}

  @Get('kpis')
  getKpis(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.mktService.getKpis(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('channels')
  getChannels(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.mktService.getChannels(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('campaigns')
  getCampaigns(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.mktService.getCampaigns(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('roas-trend')
  getRoasTrend(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.mktService.getRoasTrend(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }
}
