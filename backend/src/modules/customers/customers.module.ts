import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CacheModule } from '../../cache/cache.module';

@Module({
  imports: [CacheModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
