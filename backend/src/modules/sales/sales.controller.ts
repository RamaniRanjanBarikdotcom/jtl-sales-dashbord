import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SalesService } from './sales.service';
import { QueryFiltersDto } from '../../common/dto/query-filters.dto';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/permissions/permission-keys';

@Controller('sales')
@UseGuards(AuthGuard('jwt'))
@RequirePermissions(PERMISSIONS.SALES_VIEW)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get('kpis')
  getKpis(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.salesService.getKpis(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('revenue')
  getRevenue(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.salesService.getRevenue(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('daily')
  getDaily(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.salesService.getDaily(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('heatmap')
  getHeatmap(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.salesService.getHeatmap(req.user.tenantId, q);
  }

  @Get('orders')
  getOrders(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.salesService.getOrders(req.user.tenantId, q);
  }

  @Get('channels')
  getChannels(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.salesService.getChannels(req.user.tenantId, q);
  }

  @Get('regional')
  getRegional(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.salesService.getRegional(req.user.tenantId, q);
  }

  @Get('filters/payment-methods')
  getPaymentMethodOptions(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.salesService.getPaymentMethodOptions(req.user.tenantId, q);
  }

  @Get('filters/channels')
  getSalesChannelOptions(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.salesService.getSalesChannelOptions(req.user.tenantId, q);
  }

  @Get('filters/platforms')
  getPlatformOptions(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.salesService.getPlatformOptions(req.user.tenantId, q);
  }

  @Get('payment-shipping')
  getPaymentShipping(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.salesService.getPaymentShipping(req.user.tenantId, q);
  }
}
