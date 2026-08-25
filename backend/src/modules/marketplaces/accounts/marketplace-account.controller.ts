import {
  Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../../../common/permissions/permission-keys';
import { TenantContextService } from '../../../common/tenant-context.service';
import { AuthenticatedRequest } from '../../../common/types/auth-request';
import { MarketplaceFeatureService } from '../core/marketplace-feature.service';
import {
  CreateMarketplaceAccountDto,
  QueueMarketplaceSyncDto,
  RotateMarketplaceCredentialDto,
  UpdateMarketplaceAccountDto,
} from './marketplace-account.dto';
import { MarketplaceAccountService } from './marketplace-account.service';

@Controller('marketplaces')
@UseGuards(AuthGuard('jwt'))
export class MarketplaceAccountController {
  constructor(
    private readonly service: MarketplaceAccountService,
    private readonly tenants: TenantContextService,
    private readonly features: MarketplaceFeatureService,
  ) {}

  @Get('status')
  @RequirePermissions(PERMISSIONS.MARKETPLACES_VIEW)
  status() {
    this.features.assertApiEnabled();
    return this.features.state();
  }

  @Get('accounts')
  @RequirePermissions(PERMISSIONS.MARKETPLACES_VIEW)
  async accounts(@Req() req: AuthenticatedRequest) {
    return this.service.list(await this.tenants.resolve(req));
  }

  @Post('accounts')
  @RequirePermissions(PERMISSIONS.MARKETPLACES_MANAGE)
  async create(@Req() req: AuthenticatedRequest, @Body() dto: CreateMarketplaceAccountDto) {
    return this.service.create(await this.tenants.resolve(req), req.user.sub, dto);
  }

  @Patch('accounts/:id')
  @RequirePermissions(PERMISSIONS.MARKETPLACES_MANAGE)
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMarketplaceAccountDto,
  ) {
    return this.service.update(await this.tenants.resolve(req), req.user.sub, id, dto);
  }

  @Post('accounts/:id/credentials/rotate')
  @RequirePermissions(PERMISSIONS.MARKETPLACES_MANAGE)
  async rotate(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RotateMarketplaceCredentialDto,
  ) {
    return this.service.rotateCredential(await this.tenants.resolve(req), req.user.sub, id, dto);
  }

  @Post('accounts/:id/test')
  @RequirePermissions(PERMISSIONS.MARKETPLACES_MANAGE)
  async test(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.testConnection(await this.tenants.resolve(req), req.user.sub, id);
  }

  @Post('accounts/:id/sync')
  @RequirePermissions(PERMISSIONS.MARKETPLACES_SYNC)
  async sync(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QueueMarketplaceSyncDto,
  ) {
    return this.service.queueSync(await this.tenants.resolve(req), req.user.sub, id, dto);
  }

  @Get('accounts/:id/runs')
  @RequirePermissions(PERMISSIONS.MARKETPLACES_VIEW)
  async runs(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.recentRuns(await this.tenants.resolve(req), id);
  }

  @Get('accounts/:id/reconciliation')
  @RequirePermissions(PERMISSIONS.MARKETPLACES_VIEW)
  async reconciliation(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.reconciliationSummary(await this.tenants.resolve(req), id);
  }
}
