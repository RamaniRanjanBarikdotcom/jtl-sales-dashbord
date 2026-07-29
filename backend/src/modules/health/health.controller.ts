import { Controller, Get, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Public } from '../../common/decorators/public.decorator';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';
import { getBuildInfo } from '../../common/utils/build-info';

@Public()
@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({
    summary: 'Public liveness check',
    description: 'Returns a minimal liveness response. Use /admin/health for detailed diagnostics.',
  })
  async health() {
    return {
      status: 'ok',
      ...getBuildInfo(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}

@Public()
@Controller('healthz')
export class HealthzController {
  @Get()
  healthz() {
    return {
      status: 'ok',
      ...getBuildInfo(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}

@Controller('admin/health')
@UseGuards(AuthGuard('jwt'))
export class AdminHealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async adminHealth(@Req() req: { user?: { role?: string } }) {
    if (!['admin', 'super_admin'].includes(req.user?.role || '')) {
      throw new ForbiddenException();
    }
    return this.healthService.detailedHealth();
  }
}
