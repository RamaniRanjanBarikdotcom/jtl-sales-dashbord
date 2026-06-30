import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/permissions/permission-keys';
import { TenantContextService } from '../../common/tenant-context.service';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import { AnalyticsService } from './analytics.service';
import { RevenueTrendQueryDto } from './dto/revenue-trend-query.dto';

@Controller('analytics')
@UseGuards(AuthGuard('jwt'))
@RequirePermissions(PERMISSIONS.SALES_VIEW)
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get('revenue-trend')
  async getRevenueTrend(
    @Query() q: RevenueTrendQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.analyticsService.getRevenueTrend(
      scope,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('category-revenue-trend')
  async getCategoryRevenueTrend(
    @Query() q: RevenueTrendQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.analyticsService.getCategoryRevenueTrend(
      scope,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('category-breakdown')
  async getCategoryBreakdown(
    @Query() q: RevenueTrendQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.analyticsService.getCategoryBreakdown(
      scope,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('cancelled-trend')
  async getCancelledTrend(
    @Query() q: RevenueTrendQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.analyticsService.getCancelledTrend(
      scope,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('orders-trend')
  async getOrdersTrend(
    @Query() q: RevenueTrendQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.analyticsService.getOrdersTrend(
      scope,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('customers-trend')
  async getCustomersTrend(
    @Query() q: RevenueTrendQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.analyticsService.getCustomersTrend(
      scope,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('customers-trend-records')
  async getCustomersTrendRecords(
    @Query() q: RevenueTrendQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.analyticsService.getCustomersTrendRecords(
      scope,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('active-products-trend')
  async getActiveProductsTrend(
    @Query() q: RevenueTrendQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.analyticsService.getActiveProductsTrend(
      scope,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('top-products-breakdown')
  async getTopProductsBreakdown(
    @Query() q: RevenueTrendQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.analyticsService.getTopProductsBreakdown(
      scope,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }
}
