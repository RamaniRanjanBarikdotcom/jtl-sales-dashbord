import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { CacheModule } from '../../cache/cache.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [DatabaseModule, CacheModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
