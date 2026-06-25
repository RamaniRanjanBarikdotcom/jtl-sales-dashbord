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
        ssl: config.get('PG_SSL') === 'true'
          ? { rejectUnauthorized: config.get('PG_SSL_VERIFY') !== 'false' }
          : false,
        extra: {
          max: parseInt(config.get('PG_POOL_MAX', '10'), 10),
          family: 4,
          keepAlive: true,
          options: [
            `-c statement_timeout=${config.get('PG_STATEMENT_TIMEOUT', '30s')}`,
            `-c lock_timeout=${config.get('PG_LOCK_TIMEOUT', '5s')}`,
            `-c idle_in_transaction_session_timeout=${config.get('PG_IDLE_IN_TRANSACTION_TIMEOUT', '30s')}`,
          ].join(' '),
          connectionTimeoutMillis: parseInt(config.get('PG_CONNECTION_TIMEOUT_MS', '15000'), 10),
          idleTimeoutMillis: parseInt(config.get('PG_IDLE_TIMEOUT_MS', '30000'), 10),
        },
      }),
    }),
  ],
})
export class DatabaseModule {}
