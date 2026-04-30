import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import Redis from 'ioredis';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { REDIS_CLIENT } from '../../cache/cache.module';
import { ActivityService } from '../../activity/activity.service';
import { TenantConnection } from '../../entities/tenant-connection.entity';
import { Tenant } from '../../entities/tenant.entity';
import { CircuitBreaker } from '../../common/utils/circuit-breaker';

@Public()
@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly dbBreaker = new CircuitBreaker({
    failureThreshold: 4,
    resetTimeoutMs: 10_000,
  });
  private readonly redisBreaker = new CircuitBreaker({
    failureThreshold: 4,
    resetTimeoutMs: 10_000,
  });

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
  @ApiOperation({
    summary: 'Service health and data integrity check',
    description:
      'Returns PostgreSQL/Redis health, latency, tenant sync activity, and core data integrity metrics.',
  })
  async health() {
    let pgOk = false;
    let pgMs = 0;
    let redisOk = false;
    let redisMs = 0;

    try {
      const t = Date.now();
      await this.dbBreaker.execute(() => this.db.query('SELECT 1'));
      pgMs = Date.now() - t;
      pgOk = true;
    } catch {}

    try {
      const t = Date.now();
      await this.redisBreaker.execute(() => this.redis.ping());
      redisMs = Date.now() - t;
      redisOk = true;
    } catch {}

    const sampleLimit = Math.min(
      500,
      Math.max(10, Number.parseInt(process.env.HEALTH_TENANT_SAMPLE_LIMIT || '200', 10) || 200),
    );
    const [tenants, tenantTotal, activities, connections, orderIntegrity] = await Promise.all([
      this.tenantRepo.find({ where: { is_active: true }, take: sampleLimit, order: { created_at: 'DESC' } }),
      this.tenantRepo.count({ where: { is_active: true } }),
      this.activityService.getAllTenantActivities(),
      this.connRepo.find(),
      this.db.query(
        `SELECT
           COUNT(*)::int AS orders,
           COUNT(*) FILTER (WHERE gross_revenue IS NULL)::int AS orders_missing_revenue,
           COUNT(*) FILTER (WHERE order_date IS NULL)::int AS orders_missing_date
         FROM orders`,
      ),
    ]);

    const activeTenantIds = new Set(tenants.map((t) => t.id));
    const connectionsByTenant = new Map(connections.map((c) => [c.tenant_id, c]));
    const missingConnections = tenants.filter((t) => !connectionsByTenant.has(t.id)).map((t) => t.id);
    const orphanConnections = connections.filter((c) => !activeTenantIds.has(c.tenant_id)).map((c) => c.tenant_id);

    const tenantInfos = tenants.map((t) => {
      const conn = connectionsByTenant.get(t.id);
      return {
        tenantId: t.id,
        name: t.name,
        last_dashboard_activity: activities[t.id] || null,
        last_ingest_at: conn?.last_ingest_at || null,
        last_ingest_module: conn?.last_ingest_module || null,
      };
    });

    const integrity = {
      tenants_missing_connections: missingConnections.length,
      orphan_connections: orphanConnections.length,
      orders_missing_revenue: Number(orderIntegrity?.[0]?.orders_missing_revenue ?? 0),
      orders_missing_date: Number(orderIntegrity?.[0]?.orders_missing_date ?? 0),
      total_orders: Number(orderIntegrity?.[0]?.orders ?? 0),
    };

    const integrityOk =
      integrity.tenants_missing_connections === 0 &&
      integrity.orphan_connections === 0 &&
      integrity.orders_missing_date === 0;

    return {
      status: pgOk && redisOk && integrityOk ? 'ok' : 'degraded',
      version: '1.0.0',
      uptime_seconds: Math.floor(process.uptime()),
      checks: {
        postgres: { status: pgOk ? 'ok' : 'error', response_ms: pgMs },
        redis: { status: redisOk ? 'ok' : 'error', response_ms: redisMs },
        resilience: {
          db_circuit: this.dbBreaker.getState(),
          redis_circuit: this.redisBreaker.getState(),
        },
        integrity: { status: integrityOk ? 'ok' : 'warning', ...integrity },
      },
      tenants: tenantInfos,
      tenant_sample: { returned: tenantInfos.length, total_active: tenantTotal, limit: sampleLimit },
    };
  }
}
