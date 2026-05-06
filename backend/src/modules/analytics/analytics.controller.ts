import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/permissions/permission-keys';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import { AnalyticsService } from './analytics.service';
import { RevenueTrendQueryDto } from './dto/revenue-trend-query.dto';

@Controller('analytics')
@UseGuards(AuthGuard('jwt'))
@RequirePermissions(PERMISSIONS.SALES_VIEW)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('revenue-trend')
  getRevenueTrend(
    @Query() q: RevenueTrendQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.analyticsService.getRevenueTrend(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('category-revenue-trend')
  getCategoryRevenueTrend(
    @Query() q: RevenueTrendQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.analyticsService.getCategoryRevenueTrend(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('category-breakdown')
  getCategoryBreakdown(
    @Query() q: RevenueTrendQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.analyticsService.getCategoryBreakdown(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('cancelled-trend')
  getCancelledTrend(
    @Query() q: RevenueTrendQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.analyticsService.getCancelledTrend(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('orders-trend')
  getOrdersTrend(
    @Query() q: RevenueTrendQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.analyticsService.getOrdersTrend(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('customers-trend')
  getCustomersTrend(
    @Query() q: RevenueTrendQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.analyticsService.getCustomersTrend(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('customers-trend-records')
  getCustomersTrendRecords(
    @Query() q: RevenueTrendQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.analyticsService.getCustomersTrendRecords(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('active-products-trend')
  getActiveProductsTrend(
    @Query() q: RevenueTrendQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.analyticsService.getActiveProductsTrend(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }
}
