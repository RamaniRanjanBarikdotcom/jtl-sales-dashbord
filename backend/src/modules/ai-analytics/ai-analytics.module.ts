import { Module } from '@nestjs/common';
import { TenantContextModule } from '../../common/tenant-context.module';
import { AiAnalyticsController } from './ai-analytics.controller';
import { AiAnalyticsService } from './ai-analytics.service';
import { AiProviderService } from './ai-provider.service';

@Module({
  imports: [TenantContextModule],
  controllers: [AiAnalyticsController],
  providers: [AiAnalyticsService, AiProviderService],
})
export class AiAnalyticsModule {}
