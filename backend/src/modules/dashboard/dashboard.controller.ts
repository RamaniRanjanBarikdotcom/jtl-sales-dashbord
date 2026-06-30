import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DashboardService } from './dashboard.service';
import { QueryFiltersDto } from '../../common/dto/query-filters.dto';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/permissions/permission-keys';
import { TenantContextService } from '../../common/tenant-context.service';

@Controller('dashboard')
@UseGuards(AuthGuard('jwt'))
@RequirePermissions(PERMISSIONS.DASHBOARD_VIEW)
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get('overview')
  async overview(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const scope = await this.tenantContext.resolveScope(req);
    const data = await this.dashboardService.getOverview(
      scope,
      q,
      req.user.role,
      req.user.userLevel,
    );
    return data;
  }
}
