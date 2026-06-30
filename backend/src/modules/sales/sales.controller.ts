import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SalesService } from './sales.service';
import { QueryFiltersDto } from '../../common/dto/query-filters.dto';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/permissions/permission-keys';
import { TenantContextService } from '../../common/tenant-context.service';

@Controller('sales')
@UseGuards(AuthGuard('jwt'))
@RequirePermissions(PERMISSIONS.SALES_VIEW)
export class SalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get('kpis')
  async getKpis(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.salesService.getKpis(
      scope,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('revenue')
  async getRevenue(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.salesService.getRevenue(
      scope,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('daily')
  async getDaily(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.salesService.getDaily(
      scope,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('heatmap')
  async getHeatmap(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.salesService.getHeatmap(scope, q);
  }

  @Get('orders')
  async getOrders(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.salesService.getOrders(scope, q);
  }

  @Get('channels')
  async getChannels(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.salesService.getChannels(scope, q);
  }

  @Get('regional')
  async getRegional(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.salesService.getRegional(scope, q);
  }

  @Get('filters/payment-methods')
  async getPaymentMethodOptions(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.salesService.getPaymentMethodOptions(scope, q);
  }

  @Get('filters/channels')
  async getSalesChannelOptions(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.salesService.getSalesChannelOptions(scope, q);
  }

  @Get('filters/platforms')
  async getPlatformOptions(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.salesService.getPlatformOptions(scope, q);
  }

  @Get('payment-shipping')
  async getPaymentShipping(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const scope = await this.tenantContext.resolveScope(req);
    return this.salesService.getPaymentShipping(scope, q);
  }
}
