import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SalesService } from './sales.service';
import { QueryFiltersDto } from '../../common/dto/query-filters.dto';

@Controller('sales')
@UseGuards(AuthGuard('jwt'))
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get('kpis')
  getKpis(@Query() q: QueryFiltersDto, @Req() req: any) {
    return this.salesService.getKpis(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('revenue')
  getRevenue(@Query() q: QueryFiltersDto, @Req() req: any) {
    return this.salesService.getRevenue(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('daily')
  getDaily(@Query() q: QueryFiltersDto, @Req() req: any) {
    return this.salesService.getDaily(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('heatmap')
  getHeatmap(@Query() q: QueryFiltersDto, @Req() req: any) {
    return this.salesService.getHeatmap(req.user.tenantId, q);
  }

  @Get('orders')
  getOrders(@Query() q: any, @Req() req: any) {
    return this.salesService.getOrders(req.user.tenantId, q);
  }

  @Get('channels')
  getChannels(@Query() q: QueryFiltersDto, @Req() req: any) {
    return this.salesService.getChannels(req.user.tenantId, q);
  }

  @Get('regional')
  getRegional(@Query() q: QueryFiltersDto, @Req() req: any) {
    return this.salesService.getRegional(req.user.tenantId, q);
  }
}
