import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CacheModule } from '../../cache/cache.module';
import { TenantContextModule } from '../../common/tenant-context.module';

@Module({
  imports: [CacheModule, TenantContextModule],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
