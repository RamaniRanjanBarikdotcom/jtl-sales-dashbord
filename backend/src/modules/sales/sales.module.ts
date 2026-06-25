import { Module } from '@nestjs/common';
import { TenantContextModule } from '../../common/tenant-context.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [TenantContextModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
