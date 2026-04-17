import { Controller, Get, Query, UseGuards, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ProductsService } from './products.service';
import { QueryFiltersDto } from '../../common/dto/query-filters.dto';
import { AuthenticatedRequest } from '../../common/types/auth-request';

@Controller('products')
@UseGuards(AuthGuard('jwt'))
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get('kpis')
  getKpis(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.productsService.getKpis(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('categories')
  getCategories(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.productsService.getCategories(req.user.tenantId, q);
  }

  @Get('top')
  getTop(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.productsService.getTop(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }

  @Get('export')
  async exportList(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    const csv = await this.productsService.exportList(
      req.user.tenantId,
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
  getList(@Query() q: QueryFiltersDto, @Req() req: AuthenticatedRequest) {
    return this.productsService.getList(
      req.user.tenantId,
      q,
      req.user.role,
      req.user.userLevel,
    );
  }
}
