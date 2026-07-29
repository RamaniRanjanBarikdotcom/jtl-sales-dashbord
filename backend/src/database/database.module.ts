import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { configurePostgresTypeParsers } from './pg-types';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        configurePostgresTypeParsers();
        return {
          type: 'postgres' as const,
          host:     config.get<string>('PG_HOST', 'localhost'),
          port:     parseInt(config.get<string>('PG_PORT', '5432'), 10),
          database: config.get<string>('PG_DATABASE', 'jtl_analytics'),
          username: config.get<string>('PG_USER', 'jtl_api'),
          password: config.get<string>('PG_PASSWORD', ''),
          entities: [__dirname + '/../entities/*.entity{.ts,.js}'],
          synchronize: false,
          logging: config.get<string>('NODE_ENV') === 'development',
          ssl: config.get<string>('PG_SSL') === 'true'
            ? { rejectUnauthorized: config.get<string>('PG_SSL_VERIFY') !== 'false' }
            : false,
          extra: {
            max: parseInt(config.get<string>('PG_POOL_MAX', '10'), 10),
            family: 4,
            keepAlive: true,
            options: [
              `-c statement_timeout=${config.get<string>('PG_STATEMENT_TIMEOUT', '30s')}`,
              `-c lock_timeout=${config.get<string>('PG_LOCK_TIMEOUT', '5s')}`,
              `-c idle_in_transaction_session_timeout=${config.get<string>('PG_IDLE_IN_TRANSACTION_TIMEOUT', '30s')}`,
            ].join(' '),
            connectionTimeoutMillis: parseInt(config.get<string>('PG_CONNECTION_TIMEOUT_MS', '15000'), 10),
            idleTimeoutMillis: parseInt(config.get<string>('PG_IDLE_TIMEOUT_MS', '30000'), 10),
          },
        };
      },
    }),
  ],
})
export class DatabaseModule {}
