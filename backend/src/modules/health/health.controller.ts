import { Controller, Get, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../cache/cache.module';
import { ActivityService } from '../../activity/activity.service';
import { TenantConnection } from '../../entities/tenant-connection.entity';
import { Tenant } from '../../entities/tenant.entity';

@Controller('health')
export class HealthController {
  constructor(
    @InjectRepository(TenantConnection)
    private connRepo: Repository<TenantConnection>,
    @InjectRepository(Tenant)
    private tenantRepo: Repository<Tenant>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly activityService: ActivityService,
    private readonly db: DataSource,
  ) {}

  @Get()
  async health() {
    let pgOk = false;
    let pgMs = 0;
    let redisOk = false;
    let redisMs = 0;

    try {
      const t = Date.now();
      await this.db.query('SELECT 1');
      pgMs = Date.now() - t;
      pgOk = true;
    } catch {}

    try {
      const t = Date.now();
      await this.redis.ping();
      redisMs = Date.now() - t;
      redisOk = true;
    } catch {}

    const tenants = await this.tenantRepo.find({
      where: { is_active: true },
    });
    const activities = await this.activityService.getAllTenantActivities();
    const connections = await this.connRepo.find();

    const tenantInfos = tenants.map((t) => {
      const conn = connections.find((c) => c.tenant_id === t.id);
      return {
        tenantId: t.id,
        name: t.name,
        last_dashboard_activity: activities[t.id] || null,
        last_ingest_at: conn?.last_ingest_at || null,
        last_ingest_module: conn?.last_ingest_module || null,
      };
    });

    return {
      status: pgOk && redisOk ? 'ok' : 'degraded',
      version: '1.0.0',
      uptime_seconds: Math.floor(process.uptime()),
      checks: {
        postgres: { status: pgOk ? 'ok' : 'error', response_ms: pgMs },
        redis: { status: redisOk ? 'ok' : 'error', response_ms: redisMs },
      },
      tenants: tenantInfos,
    };
  }
}
