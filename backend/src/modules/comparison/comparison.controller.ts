import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../common/permissions/permission-keys';
import { TenantContextService } from '../../common/tenant-context.service';
import { AuthenticatedRequest } from '../../common/types/auth-request';
import { ComparisonQueryDto, ProductCompareDto, SavedViewDto } from './comparison.dto';
import { ComparisonService } from './comparison.service';

@Controller('comparison')
@UseGuards(AuthGuard('jwt'))
@RequirePermissions(PERMISSIONS.COMPARISON_VIEW)
export class ComparisonController {
  constructor(
    private readonly service: ComparisonService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private scope(req: AuthenticatedRequest) {
    return this.tenantContext.resolveScope(req);
  }

  @Get('summary')
  summary(@Query() query: ComparisonQueryDto, @Req() req: AuthenticatedRequest) {
    return this.scope(req).then((scope) => this.service.summary(scope, query));
  }

  @Get('sales/trend')
  @RequirePermissions(PERMISSIONS.COMPARISON_SALES_VIEW)
  salesTrend(@Query() query: ComparisonQueryDto, @Req() req: AuthenticatedRequest) {
    return this.scope(req).then((scope) => this.service.salesTrend(scope, query));
  }

  @Get('channels')
  @RequirePermissions(PERMISSIONS.COMPARISON_SALES_VIEW)
  channels(@Query() query: ComparisonQueryDto, @Req() req: AuthenticatedRequest) {
    return this.scope(req).then((scope) => this.service.channels(scope, query));
  }

  @Get('channel-options')
  @RequirePermissions(PERMISSIONS.COMPARISON_SALES_VIEW)
  channelOptions(@Req() req: AuthenticatedRequest) {
    return this.scope(req).then((scope) => this.service.channelOptions(scope));
  }

  @Get('channels/compare-pair')
  @RequirePermissions(PERMISSIONS.COMPARISON_SALES_VIEW, PERMISSIONS.COMPARISON_PRODUCTS_VIEW)
  channelPair(@Query() query: ComparisonQueryDto, @Req() req: AuthenticatedRequest) {
    return this.scope(req).then((scope) => this.service.compareChannelPair(scope, query));
  }

  @Get('channels/:channelId')
  @RequirePermissions(PERMISSIONS.COMPARISON_SALES_VIEW)
  channel(@Param('channelId') channelId: string, @Query() query: ComparisonQueryDto, @Req() req: AuthenticatedRequest) {
    return this.scope(req).then((scope) => this.service.channelDetail(scope, channelId, query));
  }

  @Get('channels/:channelId/products')
  @RequirePermissions(PERMISSIONS.COMPARISON_PRODUCTS_VIEW)
  channelProducts(@Param('channelId') channelId: string, @Query() query: ComparisonQueryDto, @Req() req: AuthenticatedRequest) {
    return this.scope(req).then((scope) => this.service.products(scope, { ...query, channels: channelId }));
  }

  @Get('product-channel-matrix')
  @RequirePermissions(PERMISSIONS.COMPARISON_PRODUCTS_VIEW)
  matrix(@Query() query: ComparisonQueryDto, @Req() req: AuthenticatedRequest) {
    return this.scope(req).then((scope) => this.service.productChannelMatrix(scope, query));
  }

  @Post('products/compare')
  @RequirePermissions(PERMISSIONS.COMPARISON_PRODUCTS_VIEW)
  compareProducts(@Body() body: ProductCompareDto, @Req() req: AuthenticatedRequest) {
    return this.scope(req).then((scope) => this.service.compareProducts(scope, body));
  }

  @Get('products')
  @RequirePermissions(PERMISSIONS.COMPARISON_PRODUCTS_VIEW)
  products(@Query() query: ComparisonQueryDto, @Req() req: AuthenticatedRequest) {
    return this.scope(req).then((scope) => this.service.products(scope, query));
  }

  @Get('products/:productId')
  @RequirePermissions(PERMISSIONS.COMPARISON_PRODUCTS_VIEW)
  product(@Param('productId', ParseIntPipe) productId: number, @Query() query: ComparisonQueryDto, @Req() req: AuthenticatedRequest) {
    return this.scope(req).then((scope) => this.service.productDetail(scope, productId, query));
  }

  @Get('inventory')
  @RequirePermissions(PERMISSIONS.COMPARISON_INVENTORY_VIEW)
  inventory(@Query() query: ComparisonQueryDto, @Req() req: AuthenticatedRequest) {
    return this.scope(req).then((scope) => this.service.inventory(scope, query));
  }

  @Get('customers')
  @RequirePermissions(PERMISSIONS.COMPARISON_CUSTOMERS_VIEW)
  customers(@Query() query: ComparisonQueryDto, @Req() req: AuthenticatedRequest) {
    return this.scope(req).then((scope) => this.service.customers(scope, query));
  }

  @Get('customers/segments')
  @RequirePermissions(PERMISSIONS.COMPARISON_CUSTOMERS_VIEW)
  segments(@Req() req: AuthenticatedRequest) {
    return this.scope(req).then((scope) => this.service.customerSegments(scope));
  }

  @Get('orders')
  @RequirePermissions(PERMISSIONS.COMPARISON_SALES_VIEW)
  orders(@Query() query: ComparisonQueryDto, @Req() req: AuthenticatedRequest) {
    return this.scope(req).then((scope) => this.service.orders(scope, query));
  }

  @Get('reviews')
  @RequirePermissions(PERMISSIONS.COMPARISON_SALES_VIEW)
  reviews(@Query() query: ComparisonQueryDto, @Req() req: AuthenticatedRequest) {
    return this.scope(req).then((scope) => this.service.reviews(scope, query));
  }

  @Get('metric-definitions')
  metricDefinitions() {
    return this.service.metricDefinitions();
  }

  @Get('export')
  @RequirePermissions(PERMISSIONS.COMPARISON_EXPORT)
  async export(@Query() query: ComparisonQueryDto, @Req() req: AuthenticatedRequest, @Res() response: Response) {
    const scope = await this.scope(req);
    const csv = await this.service.exportCsv(scope, query);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="comparison-${query.dataset || 'channels'}-${new Date().toISOString().slice(0, 10)}.csv"`);
    response.send(csv);
  }

  @Get('saved-views')
  savedViews(@Req() req: AuthenticatedRequest) {
    return this.scope(req).then((scope) => this.service.listSavedViews(scope, req.user.sub));
  }

  @Post('saved-views')
  @RequirePermissions(PERMISSIONS.COMPARISON_SAVED_VIEWS_MANAGE)
  saveView(@Body() body: SavedViewDto, @Req() req: AuthenticatedRequest) {
    return this.scope(req).then((scope) => this.service.saveView(scope, req.user.sub, body));
  }

  @Delete('saved-views/:id')
  @RequirePermissions(PERMISSIONS.COMPARISON_SAVED_VIEWS_MANAGE)
  deleteView(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.scope(req).then((scope) => this.service.deleteSavedView(scope, req.user.sub, id));
  }
}
