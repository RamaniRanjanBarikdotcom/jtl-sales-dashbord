import { Controller, Get, HttpCode, Post, Query, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InventoryService } from './inventory.service';
import { QueryFiltersDto } from '../../common/dto/query-filters.dto';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/permissions/permission-keys';
import { TenantContextService } from '../../common/tenant-context.service';

@Controller('inventory')
@UseGuards(AuthGuard('jwt'))
@RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get('kpis')
  async getKpis(@Req() req: AuthenticatedRequest) {
    const tenantId = await this.tenantContext.resolve(req);
    return this.inventoryService.getKpis(tenantId);
  }

  @Get('alerts')
  async getAlerts(@Req() req: AuthenticatedRequest) {
    const tenantId = await this.tenantContext.resolve(req);
    return this.inventoryService.getAlerts(tenantId);
  }

  @Post('alerts/email')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.SETTINGS_MANAGE)
  async emailAlerts(@Req() req: AuthenticatedRequest) {
    const tenantId = await this.tenantContext.resolve(req);
    return this.inventoryService.emailAlerts(tenantId);
  }

  @Get('alerts-paged')
  async getAlertsPaged(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const tenantId = await this.tenantContext.resolve(req);
    return this.inventoryService.getAlertsPaged(tenantId, q);
  }

  @Get('movements')
  async getMovements(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const tenantId = await this.tenantContext.resolve(req);
    return this.inventoryService.getMovements(tenantId, q);
  }

  @Get()
  async getList(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const tenantId = await this.tenantContext.resolve(req);
    return this.inventoryService.getList(tenantId, q);
  }
}
