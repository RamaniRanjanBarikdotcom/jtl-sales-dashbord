import { Module } from '@nestjs/common';
import { TenantContextModule } from '../../common/tenant-context.module';
import { CacheModule } from '../../cache/cache.module';
import { ComparisonController } from './comparison.controller';
import { ComparisonService } from './comparison.service';

@Module({
  imports: [TenantContextModule, CacheModule],
  controllers: [ComparisonController],
  providers: [ComparisonService],
  exports: [ComparisonService],
})
export class ComparisonModule {}
