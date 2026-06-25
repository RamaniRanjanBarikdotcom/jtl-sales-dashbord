import { Controller, Get, Query, UseGuards, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ProductsService } from './products.service';
import { QueryFiltersDto } from '../../common/dto/query-filters.dto';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/permissions/permission-keys';
import { TenantContextService } from '../../common/tenant-context.service';

@Controller('products')
@UseGuards(AuthGuard('jwt'))
@RequirePermissions(PERMISSIONS.PRODUCTS_VIEW)
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get('kpis')
  async getKpis(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const tenantId = await this.tenantContext.resolve(req);
    return this.productsService.getKpis(
      tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('categories')
  async getCategories(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const tenantId = await this.tenantContext.resolve(req);
    return this.productsService.getCategories(tenantId, q);
  }

  @Get('top')
  async getTop(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const tenantId = await this.tenantContext.resolve(req);
    return this.productsService.getTop(
      tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('trend')
  async getTrend(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const tenantId = await this.tenantContext.resolve(req);
    return this.productsService.getTrend(tenantId, q);
  }

  @Get('export')
  @RequirePermissions(PERMISSIONS.PRODUCTS_EXPORT)
  async exportList(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    const tenantId = await this.tenantContext.resolve(req);
    const csv = await this.productsService.exportList(
      tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
    const date = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="products-${date}.csv"`);
    res.send(csv);
  }

  @Get()
  async getList(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    const tenantId = await this.tenantContext.resolve(req);
    return this.productsService.getList(
      tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }
}
