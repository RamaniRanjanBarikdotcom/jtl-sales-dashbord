import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../cache/cache.module';
import { ActivityService } from '../../activity/activity.service';
import { TenantConnection } from '../../entities/tenant-connection.entity';
import { Tenant } from '../../entities/tenant.entity';
import { CircuitBreaker } from '../../common/utils/circuit-breaker';
import { getBuildInfo } from '../../common/utils/build-info';
import { inventoryAggregationSql } from '../inventory/inventory-stock';
import { CanonicalChannelPaymentSchemaService } from '../../database/canonical-channel-payment-schema.service';
import { statfs } from 'node:fs/promises';
import { CacheService } from '../../cache/cache.service';

@Injectable()
export class HealthService {
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
    private readonly schemaCapabilities: CanonicalChannelPaymentSchemaService,
    private readonly cache: CacheService,
  ) {}

  private async filesystemHealth() {
    try {
      const stats = await statfs('/');
      const totalBytes = Number(stats.blocks) * Number(stats.bsize);
      const availableBytes = Number(stats.bavail) * Number(stats.bsize);
      const usedPct = totalBytes > 0
        ? Math.round(((totalBytes - availableBytes) / totalBytes) * 10_000) / 100
        : 0;
      const totalInodes = Number(stats.files);
      const freeInodes = Number(stats.ffree);
      const inodeUsedPct = totalInodes > 0
        ? Math.round(((totalInodes - freeInodes) / totalInodes) * 10_000) / 100
        : 0;
      return {
        status: usedPct >= 90 || inodeUsedPct >= 90 ? 'critical' : usedPct >= 80 || inodeUsedPct >= 80 ? 'warning' : 'ok',
        total_bytes: totalBytes,
        available_bytes: availableBytes,
        used_pct: usedPct,
        inode_used_pct: inodeUsedPct,
      };
    } catch (error) {
      return {
        status: 'unknown',
        error: error instanceof Error ? error.message : 'filesystem metrics unavailable',
      };
    }
  }

  async detailedHealth() {
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
    const [tenants, tenantTotal, activities, connections, orderIntegrity, inventoryIntegrity, filesystem, cacheStats] = await Promise.all([
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
      this.db.query(
        `WITH inventory_totals AS (
           ${inventoryAggregationSql('ARRAY(SELECT id FROM tenants WHERE is_active)')}
         )
         SELECT COUNT(*)::int AS mismatched_products
         FROM products p
         LEFT JOIN inventory_totals i
           ON i.tenant_id = p.tenant_id
          AND i.jtl_product_id = p.jtl_product_id
         WHERE ABS(
           COALESCE(p.stock_quantity, 0) - COALESCE(i.total_available, 0)
         ) > 0.001`,
      ),
      this.filesystemHealth(),
      this.cache.stats().catch(() => null),
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
      mismatched_products: Number(inventoryIntegrity?.[0]?.mismatched_products ?? 0),
    };

    const integrityOk =
      integrity.tenants_missing_connections === 0 &&
      integrity.orphan_connections === 0 &&
      integrity.orders_missing_date === 0 &&
      integrity.mismatched_products === 0;
    const resourceOk = filesystem.status !== 'critical';

    return {
      status: pgOk && redisOk && integrityOk && resourceOk ? 'ok' : 'degraded',
      ...getBuildInfo(),
      uptime_seconds: Math.floor(process.uptime()),
      checks: {
        postgres: { status: pgOk ? 'ok' : 'error', response_ms: pgMs },
        redis: { status: redisOk ? 'ok' : 'error', response_ms: redisMs },
        cache: cacheStats,
        resilience: {
          db_circuit: this.dbBreaker.getState(),
          redis_circuit: this.redisBreaker.getState(),
        },
        integrity: { status: integrityOk ? 'ok' : 'warning', ...integrity },
        schema_capabilities: this.schemaCapabilities.current(),
        filesystem,
        process: {
          memory_bytes: process.memoryUsage(),
          active_resources: process.getActiveResourcesInfo().length,
        },
      },
      tenants: tenantInfos,
      tenant_sample: { returned: tenantInfos.length, total_active: tenantTotal, limit: sampleLimit },
    };
  }
}
