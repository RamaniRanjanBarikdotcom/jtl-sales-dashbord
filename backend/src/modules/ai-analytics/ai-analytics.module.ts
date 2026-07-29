import { Module } from '@nestjs/common';
import { TenantContextModule } from '../../common/tenant-context.module';
import { AiAnalyticsController } from './ai-analytics.controller';
import { AiAnalyticsService } from './ai-analytics.service';

@Module({
  imports: [TenantContextModule],
  controllers: [AiAnalyticsController],
  providers: [AiAnalyticsService],
})
export class AiAnalyticsModule {}
