import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host:     config.get('PG_HOST', 'localhost'),
        port:     parseInt(config.get('PG_PORT', '5432'), 10),
        database: config.get('PG_DATABASE', 'jtl_analytics'),
        username: config.get('PG_USER', 'jtl_api'),
        password: config.get('PG_PASSWORD', ''),
        entities: [__dirname + '/../entities/*.entity{.ts,.js}'],
        synchronize: false,
        logging: config.get('NODE_ENV') === 'development',
        ssl: config.get('PG_SSL') === 'true' ? { rejectUnauthorized: false } : false,
        extra: {
          max: parseInt(config.get('PG_POOL_MAX', '20'), 10),
          family: 4,
        },
      }),
    }),
  ],
})
export class DatabaseModule {}
