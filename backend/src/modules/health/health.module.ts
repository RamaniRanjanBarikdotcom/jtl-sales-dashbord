import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { TenantConnection } from '../../entities/tenant-connection.entity';
import { Tenant } from '../../entities/tenant.entity';

@Module({
  imports: [TypeOrmModule.forFeature([TenantConnection, Tenant])],
  controllers: [HealthController],
})
export class HealthModule {}
