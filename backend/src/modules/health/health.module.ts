import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminHealthController, HealthController, HealthzController } from './health.controller';
import { TenantConnection } from '../../entities/tenant-connection.entity';
import { Tenant } from '../../entities/tenant.entity';
import { HealthService } from './health.service';

@Module({
  imports: [TypeOrmModule.forFeature([TenantConnection, Tenant])],
  controllers: [HealthController, HealthzController, AdminHealthController],
  providers: [HealthService],
})
export class HealthModule {}
