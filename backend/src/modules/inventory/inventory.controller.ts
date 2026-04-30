import { Controller, Get, Query, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InventoryService } from './inventory.service';
import { QueryFiltersDto } from '../../common/dto/query-filters.dto';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/permissions/permission-keys';

@Controller('inventory')
@UseGuards(AuthGuard('jwt'))
@RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('kpis')
  getKpis(@Req() req: AuthenticatedRequest) {
    return this.inventoryService.getKpis(req.user.tenantId);
  }

  @Get('alerts')
  getAlerts(@Req() req: AuthenticatedRequest) {
    return this.inventoryService.getAlerts(req.user.tenantId);
  }

  @Get('movements')
  getMovements(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.inventoryService.getMovements(req.user.tenantId, q);
  }

  @Get()
  getList(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.inventoryService.getList(req.user.tenantId, q);
  }
}
