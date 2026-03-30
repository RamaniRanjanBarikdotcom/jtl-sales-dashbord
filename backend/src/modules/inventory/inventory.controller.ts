import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InventoryService } from './inventory.service';
import { QueryFiltersDto } from '../../common/dto/query-filters.dto';

@Controller('inventory')
@UseGuards(AuthGuard('jwt'))
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('kpis')
  getKpis(@Req() req: any) {
    return this.inventoryService.getKpis(req.user.tenantId);
  }

  @Get('alerts')
  getAlerts(@Req() req: any) {
    return this.inventoryService.getAlerts(req.user.tenantId);
  }

  @Get('movements')
  getMovements(@Query() q: QueryFiltersDto, @Req() req: any) {
    return this.inventoryService.getMovements(req.user.tenantId, q);
  }

  @Get()
  getList(@Query() q: QueryFiltersDto, @Req() req: any) {
    return this.inventoryService.getList(req.user.tenantId, q);
  }
}
