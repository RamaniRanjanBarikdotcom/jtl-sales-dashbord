import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { MarketplaceSchedulerService } from '../modules/marketplaces/scheduler/marketplace-scheduler.service';
import { MarketplaceWorkerRuntimeService } from '../modules/marketplaces/monitoring/marketplace-worker-runtime.service';
import { MarketplaceShadowSyncService } from '../modules/marketplaces/sync/marketplace-shadow-sync.service';
import { MarketplacesModule } from '../modules/marketplaces/marketplaces.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, MarketplacesModule],
  providers: [MarketplaceSchedulerService, MarketplaceWorkerRuntimeService, MarketplaceShadowSyncService],
})
export class MarketplaceWorkerModule {}
