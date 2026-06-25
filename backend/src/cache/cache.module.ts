import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from './cache.service';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './cache.constants';

export { REDIS_CLIENT };

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new Redis({
        host:     config.get('REDIS_HOST', 'localhost'),
        port:     parseInt(config.get('REDIS_PORT', '6379'), 10),
        password: config.get('REDIS_PASSWORD', '') || undefined,
        lazyConnect: true,
      }),
    },
    CacheService,
  ],
  exports: [CacheService, REDIS_CLIENT],
})
export class CacheModule {}
