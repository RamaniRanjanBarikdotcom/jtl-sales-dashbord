import { Module } from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { MatviewRefreshCoordinator } from './matview-refresh-coordinator.service';

@Module({
  providers: [MaintenanceService, MatviewRefreshCoordinator],
  exports: [MatviewRefreshCoordinator],
})
export class MaintenanceModule {}
