import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditService } from '../../common/audit/audit.service';
import { SYSTEM_EVENT_TYPES } from '../../common/events/event-types';
import { sanitizeMetadata } from '../../common/utils/metadata-sanitizer';
import { PlatformConfigService } from '../../config/platform-config.service';
import { CreateAgentEventDto, LogsExportDto, LogsQueryDto } from './system-logs.dto';

export interface LogsScope {
  tenantIds: string[];
  includePlatform: boolean;
}

export interface SystemEventInput {
  tenantId?: string | null;
  source: string;
  module?: string;
  eventType: string;
  severity: 'debug' | 'info' | 'warning' | 'error' | 'critical';
  status?: string;
  message: string;
  actorUserId?: string;
  agentId?: string;
  correlationId?: string;
  requestId?: string;
  syncRunId?: string;
  commandId?: string;
  rowsProcessed?: number;
  durationMs?: number;
  serviceVersion?: string;
  gitSha?: string;
  eventKey?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

type QueryParts = { where: string; params: unknown[]; orderBy: string; page: number; limit: number };

@Injectable()
export class SystemLogsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SystemLogsService.name);
  private retentionTimer: NodeJS.Timeout | null = null;
  private readonly allowedEvents = new Set<string>(SYSTEM_EVENT_TYPES);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly flags: PlatformConfigService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    if (!this.flags.enabled('SYSTEM_LOGS_RETENTION_ENABLED')) return;
    const hours = this.flags.integer('SYSTEM_LOGS_RETENTION_INTERVAL_HOURS', 24, 1, 168);
    this.retentionTimer = setInterval(() => void this.runRetention(), hours * 60 * 60 * 1000);
    this.retentionTimer.unref();
  }

  onModuleDestroy() {
    if (this.retentionTimer) clearInterval(this.retentionTimer);
  }

  private requireApi() {
    if (!this.flags.enabled('SYSTEM_LOGS_ENABLED') || !this.flags.enabled('SYSTEM_LOGS_API_ENABLED')) {
      throw new ServiceUnavailableException({ code: 'FEATURE_DISABLED', message: 'System Logs API is disabled' });
    }
  }

  /**
   * Operational event writes are deliberately best-effort. A logging outage
   * is written to the normal application logger and never breaks sync/auth.
   */
  async emit(event: SystemEventInput): Promise<boolean> {
    if (!this.flags.enabled('SYSTEM_LOGS_ENABLED')) return false;
    if (!this.allowedEvents.has(event.eventType)) {
      this.logger.warn(`Rejected unregistered system event type: ${event.eventType}`);
      return false;
    }
    try {
      const maxBytes = this.flags.integer('SYSTEM_LOGS_METADATA_MAX_BYTES', 32768, 1024, 65536);
      const metadata = sanitizeMetadata(event.metadata ?? {}, { maxBytes });
      const safeMessage = String(sanitizeMetadata({ message: event.message }, { maxBytes }).message ?? '');
      await this.db.query(
        `INSERT INTO system_events
         (tenant_id,source,module,event_type,severity,status,message,actor_user_id,agent_id,
          correlation_id,request_id,sync_run_id,command_id,rows_processed,duration_ms,
          service_version,git_sha,event_key,metadata,occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (tenant_id,agent_id,event_key) WHERE event_key IS NOT NULL DO NOTHING`,
        [event.tenantId ?? null,event.source,event.module ?? null,event.eventType,event.severity,
          event.status ?? null,safeMessage,event.actorUserId ?? null,event.agentId ?? null,
          event.correlationId ?? null,event.requestId ?? null,event.syncRunId ?? null,
          event.commandId ?? null,event.rowsProcessed ?? null,event.durationMs ?? null,
          event.serviceVersion ?? null,event.gitSha ?? null,event.eventKey ?? null,
          JSON.stringify(metadata),event.occurredAt ? new Date(event.occurredAt) : new Date()],
      );
      return true;
    } catch (error: unknown) {
      this.logger.error(`System event persistence failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async ingestAgentEvent(tenantId: string, dto: CreateAgentEventDto) {
    if (!this.flags.enabled('SYSTEM_LOGS_ENABLED') || !this.flags.enabled('SYSTEM_LOGS_AGENT_EVENTS_ENABLED')) {
      throw new ServiceUnavailableException({ code: 'FEATURE_DISABLED', message: 'Agent events are disabled' });
    }
    const agents = await this.db.query(
      `SELECT agent_id FROM sync_agents WHERE tenant_id=$1 AND agent_id=$2`, [tenantId,dto.agentId],
    );
    if (!agents[0]) throw new NotFoundException('Registered sync agent not found');
    const persisted = await this.emit({
      tenantId,source: 'windows-service',agentId: dto.agentId,occurredAt: dto.occurredAt,
      severity: dto.severity,eventType: dto.eventType,module: dto.module,status: dto.status,
      message: dto.message,correlationId: dto.correlationId,syncRunId: dto.syncRunId,
      commandId: dto.commandId,rowsProcessed: dto.rowsProcessed,durationMs: dto.durationMs,
      serviceVersion: dto.serviceVersion,gitSha: dto.gitSha,eventKey: dto.eventKey,
      metadata: dto.metadata,
    });
    return { accepted: persisted };
  }

  async summary(scope: LogsScope, query: LogsQueryDto) {
    this.requireApi();
    const eventFilter = this.buildSummaryEventFilter(scope,query);
    const [events, syncs, agents, critical] = await Promise.all([
      this.db.query(
        `SELECT
           COUNT(*) FILTER (WHERE severity IN ('error','critical'))::int AS errors,
           COUNT(*) FILTER (WHERE severity='warning')::int AS warnings,
           COUNT(*) FILTER (WHERE event_type='access.denied')::int AS access_denials
         FROM system_events
         WHERE ${eventFilter.where}`,
        eventFilter.params,
      ),
      this.db.query(
        `SELECT COUNT(*)::int AS failed FROM sync_runs
         WHERE tenant_id=ANY($1::uuid[]) AND status IN ('failed','error')
           AND COALESCE(failed_at,started_at) >= now()-interval '24 hours'`, [scope.tenantIds],
      ),
      this.db.query(
        `SELECT
           COUNT(*) FILTER (WHERE last_heartbeat_at >= now()-interval '90 seconds')::int AS active,
           COUNT(*) FILTER (WHERE last_heartbeat_at IS NULL OR last_heartbeat_at < now()-interval '5 minutes')::int AS offline
         FROM sync_agents WHERE tenant_id=ANY($1::uuid[])`, [scope.tenantIds],
      ),
      this.db.query(
        `SELECT id,event_type,message,occurred_at FROM system_events
         WHERE (tenant_id=ANY($1::uuid[]) OR ($2::boolean AND tenant_id IS NULL))
           AND severity='critical' ORDER BY occurred_at DESC LIMIT 1`,
        [scope.tenantIds,scope.includePlatform],
      ),
    ]);
    return {
      errorsLast24Hours: Number(events[0]?.errors || 0),
      warningsLast24Hours: Number(events[0]?.warnings || 0),
      failedSyncsLast24Hours: Number(syncs[0]?.failed || 0),
      accessDenialsLast24Hours: Number(events[0]?.access_denials || 0),
      activeAgents: Number(agents[0]?.active || 0),
      offlineAgents: Number(agents[0]?.offline || 0),
      lastCriticalEvent: critical[0] ?? null,
      dataFreshness: { generatedAt: new Date().toISOString() },
      filters: { from: query.from ?? null, to: query.to ?? null },
    };
  }

  async listEvents(scope: LogsScope, query: LogsQueryDto, exportLimit?: number) {
    this.requireApi();
    return this.executeEventQuery(scope,query,exportLimit,false);
  }

  private async executeEventQuery(
    scope: LogsScope,
    query: LogsQueryDto,
    exportLimit: number | undefined,
    securityOnly: boolean,
  ) {
    const parts = this.buildEventQuery(scope, query, exportLimit,securityOnly);
    const select = `SELECT e.id,e.tenant_id,t.name AS tenant_name,e.source,e.module,e.event_type,
      e.severity,e.status,e.message,e.actor_user_id,u.full_name AS actor_name,e.agent_id,
      e.correlation_id,e.request_id,e.sync_run_id,e.command_id,e.rows_processed,e.duration_ms,
      e.service_version,e.git_sha,(e.metadata-'stackTrace'-'stack_trace') AS metadata,
      e.occurred_at,e.created_at`;
    const rows = await this.db.query(
      `${select} FROM system_events e
       LEFT JOIN tenants t ON t.id=e.tenant_id
       LEFT JOIN users u ON u.id=e.actor_user_id
       WHERE ${parts.where} ORDER BY ${parts.orderBy}
       LIMIT $${parts.params.length+1} OFFSET $${parts.params.length+2}`,
      [...parts.params,parts.limit,(parts.page-1)*parts.limit],
    );
    if (exportLimit) return { data: rows, pagination: { page: 1, limit: parts.limit, total: rows.length } };
    const count = await this.db.query(
      `SELECT COUNT(*)::int AS total FROM system_events e WHERE ${parts.where}`, parts.params,
    );
    return {
      data: rows,
      pagination: { page: parts.page,limit: parts.limit,total: Number(count[0]?.total || 0),
        totalPages: Math.ceil(Number(count[0]?.total || 0)/parts.limit) },
      dataFreshness: { generatedAt: new Date().toISOString() },
    };
  }

  async listAudit(scope: LogsScope, query: LogsQueryDto) {
    this.requireApi();
    this.assertDateRange(query);
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, this.maxPageSize());
    const params: unknown[] = [scope.tenantIds,scope.includePlatform];
    const filters = [`(a.tenant_id=ANY($1::text[]) OR ($2::boolean AND a.tenant_id IS NULL))`];
    const from = query.from ?? new Date(Date.now()-7*86400000).toISOString();
    params.push(from); filters.push(`a.at >= $${params.length}::timestamptz`);
    if (query.to) { params.push(query.to); filters.push(`a.at <= $${params.length}::timestamptz`); }
    if (query.actorUserId) { params.push(query.actorUserId); filters.push(`a.actor_id=$${params.length}`); }
    if (query.eventType) { params.push(query.eventType); filters.push(`a.action=$${params.length}`); }
    if (query.correlationId) { params.push(query.correlationId); filters.push(`a.correlation_id=$${params.length}`); }
    if (query.search) {
      params.push(query.search);
      filters.push(`(a.action ILIKE '%'||$${params.length}||'%' OR COALESCE(a.reason,'') ILIKE '%'||$${params.length}||'%')`);
    }
    const where = filters.join(' AND ');
    const rows = await this.db.query(
      `SELECT a.id,a.action,a.actor_id AS "actorId",u.full_name AS "actorName",
        a.tenant_id AS "tenantId",t.name AS "tenantName",a.target_id AS "targetId",
        a.request_id AS "requestId",a.correlation_id AS "correlationId",a.outcome,a.reason,
        a.metadata,a.at FROM audit_logs a
       LEFT JOIN tenants t ON t.id::text=a.tenant_id
       LEFT JOIN users u ON u.id::text=a.actor_id
       WHERE ${where} ORDER BY a.at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`,
      [...params,limit,(page-1)*limit],
    );
    const count = await this.db.query(`SELECT COUNT(*)::int AS total FROM audit_logs a WHERE ${where}`, params);
    return { data: rows,pagination: { page,limit,total: Number(count[0]?.total || 0) },
      dataFreshness: { generatedAt: new Date().toISOString() } };
  }

  async listSecurity(scope: LogsScope, query: LogsQueryDto) {
    this.requireApi();
    if (!this.flags.enabled('SYSTEM_LOGS_SECURITY_TAB_ENABLED')) {
      throw new ServiceUnavailableException({ code: 'FEATURE_DISABLED',message: 'Security Logs is disabled' });
    }
    return this.executeEventQuery(scope,query,undefined,true);
  }

  async detail(scope: LogsScope, id: string, includeStackTrace: boolean) {
    this.requireApi();
    const rows = await this.db.query(
      `SELECT e.*,t.name AS tenant_name,u.full_name AS actor_name FROM system_events e
       LEFT JOIN tenants t ON t.id=e.tenant_id LEFT JOIN users u ON u.id=e.actor_user_id
       WHERE e.id=$1 AND (e.tenant_id=ANY($2::uuid[]) OR ($3::boolean AND e.tenant_id IS NULL))`,
      [id,scope.tenantIds,scope.includePlatform],
    );
    if (!rows[0]) throw new NotFoundException('Event not found');
    if (!includeStackTrace && rows[0].metadata) {
      delete rows[0].metadata.stackTrace;
      delete rows[0].metadata.stack_trace;
    }
    return rows[0];
  }

  async related(scope: LogsScope, id: string) {
    const event = await this.detail(scope,id,false);
    if (!event.correlation_id) return [];
    return this.db.query(
      `SELECT id,event_type,severity,status,message,source,module,occurred_at
       FROM system_events WHERE correlation_id=$1
         AND (tenant_id=ANY($2::uuid[]) OR ($3::boolean AND tenant_id IS NULL))
       ORDER BY occurred_at ASC LIMIT 200`,
      [event.correlation_id,scope.tenantIds,scope.includePlatform],
    );
  }

  async sources(scope: LogsScope) {
    this.requireApi();
    return this.db.query(
      `SELECT source,COUNT(*)::int AS count,MAX(occurred_at) AS last_event_at
       FROM system_events WHERE (tenant_id=ANY($1::uuid[]) OR ($2::boolean AND tenant_id IS NULL))
         AND occurred_at >= now()-interval '90 days'
       GROUP BY source ORDER BY source`, [scope.tenantIds,scope.includePlatform],
    );
  }

  async export(scope: LogsScope, userId: string, query: LogsExportDto, requestId?: string) {
    if (!this.flags.enabled('SYSTEM_LOGS_EXPORT_ENABLED')) {
      throw new ServiceUnavailableException({ code: 'FEATURE_DISABLED', message: 'Logs export is disabled' });
    }
    const maxRows = this.flags.integer('SYSTEM_LOGS_EXPORT_MAX_ROWS',5000,1,20000);
    await this.audit.log({ action: 'logs.export.requested',actorId: userId,requestId,
      tenantId: scope.tenantIds.length === 1 ? scope.tenantIds[0] : null,
      metadata: { format: query.format,filters: query,maxRows } });
    try {
      const result = await this.listEvents(scope,{ ...query,page: 1,limit: 200 },maxRows);
      const rows = result.data.slice(0,maxRows);
      const content = query.format === 'json'
        ? JSON.stringify(rows,null,2)
        : this.toCsv(rows);
      await this.audit.log({ action: 'logs.export.completed',actorId: userId,requestId,
        tenantId: scope.tenantIds.length === 1 ? scope.tenantIds[0] : null,
        metadata: { format: query.format,rowCount: rows.length } });
      return { content,contentType: query.format === 'json' ? 'application/json' : 'text/csv',
        filename: `system-logs-${new Date().toISOString().slice(0,10)}.${query.format}` };
    } catch (error: unknown) {
      await this.audit.log({ action: 'logs.export.failed',actorId: userId,requestId,outcome: 'failure',
        reason: error instanceof Error ? error.message : 'unknown export error' });
      throw error;
    }
  }

  async runRetention() {
    if (!this.flags.enabled('SYSTEM_LOGS_RETENTION_ENABLED')) return;
    const categories = [
      { name: 'debug',where: `severity='debug' AND occurred_at<now()-interval '14 days'` },
      { name: 'info',where: `severity='info' AND occurred_at<now()-interval '90 days'` },
      { name: 'warning_error',where: `severity IN ('warning','error','critical') AND occurred_at<now()-interval '180 days'` },
    ];
    const deleted: Record<string, number> = {};
    try {
      for (const category of categories) {
        deleted[category.name] = await this.deleteBatches('system_events',category.where);
      }
      deleted.audit = await this.deleteBatches(
        'audit_logs',
        `at<now()-interval '730 days' AND COALESCE(metadata->>'incidentActive','false')<>'true'`,
      );
      await this.emit({ source: 'backend',eventType: 'logs.retention.completed',severity: 'info',
        message: 'Logs retention completed',metadata: { deleted } });
    } catch (error: unknown) {
      this.logger.error(`Logs retention failed: ${error instanceof Error ? error.message : String(error)}`);
      await this.emit({ source: 'backend',eventType: 'logs.retention.failed',severity: 'error',
        message: 'Logs retention failed' });
    }
  }

  private async deleteBatches(table: 'system_events'|'audit_logs', where: string): Promise<number> {
    let total = 0;
    for (let batch = 0; batch < 20; batch++) {
      const result = await this.db.query(
        `WITH doomed AS (SELECT id FROM ${table} WHERE ${where} LIMIT 1000)
         DELETE FROM ${table} target USING doomed WHERE target.id=doomed.id RETURNING target.id`,
      );
      const count = Array.isArray(result) ? result.length : 0;
      total += count;
      if (count < 1000) break;
    }
    return total;
  }

  private buildEventQuery(
    scope: LogsScope,
    query: LogsQueryDto,
    exportLimit?: number,
    securityOnly = false,
  ): QueryParts {
    this.assertDateRange(query);
    const params: unknown[] = [scope.tenantIds,scope.includePlatform];
    const filters = [`(e.tenant_id=ANY($1::uuid[]) OR ($2::boolean AND e.tenant_id IS NULL))`];
    const from = query.from ?? new Date(Date.now()-7*86400000).toISOString();
    params.push(from); filters.push(`e.occurred_at >= $${params.length}::timestamptz`);
    if (query.category === 'sync') {
      filters.push(`(e.event_type LIKE 'sync.%' OR e.event_type LIKE 'sync_command.%'
        OR e.source IN ('sync-engine','windows-service'))`);
    } else if (query.category === 'errors') {
      filters.push(`e.severity IN ('warning','error','critical')`);
    } else if (query.category === 'security') {
      filters.push(`(e.event_type LIKE 'auth.%' OR e.event_type LIKE 'access.%'
        OR e.event_type LIKE 'rate_limit.%' OR e.event_type LIKE 'request.validation_%')`);
    } else if (query.category === 'infrastructure') {
      filters.push(`(e.source IN ('database','redis','deployment')
        OR e.event_type LIKE 'backend.%' OR e.event_type LIKE 'database.%'
        OR e.event_type LIKE 'redis.%' OR e.event_type LIKE 'cache.%'
        OR e.event_type LIKE 'materialized_view.%' OR e.event_type LIKE 'migration.%'
        OR e.event_type LIKE 'deployment.%')`);
    }
    if (securityOnly) {
      filters.push(`(e.event_type LIKE 'auth.%' OR e.event_type LIKE 'access.%'
        OR e.event_type LIKE 'rate_limit.%' OR e.event_type LIKE 'request.validation_%')`);
    }
    if (query.to) { params.push(query.to); filters.push(`e.occurred_at <= $${params.length}::timestamptz`); }
    const fields: Array<[unknown,string]> = [
      [query.source,'e.source'],[query.module,'e.module'],[query.severity,'e.severity'],
      [query.status,'e.status'],[query.eventType,'e.event_type'],
      [query.actorUserId,'e.actor_user_id'],[query.agentId,'e.agent_id'],
      [query.syncRunId,'e.sync_run_id'],[query.commandId,'e.command_id'],
      [query.correlationId,'e.correlation_id'],
    ];
    for (const [value,column] of fields) {
      if (value) { params.push(value); filters.push(`${column}=$${params.length}`); }
    }
    if (query.search) {
      params.push(query.search);
      filters.push(`(e.message ILIKE '%'||$${params.length}||'%' OR e.event_type ILIKE '%'||$${params.length}||'%')`);
    }
    const sortMap = {
      occurredAt: 'e.occurred_at',severity: 'e.severity',
      durationMs: 'e.duration_ms',rowsProcessed: 'e.rows_processed',
    };
    const sort = sortMap[query.sortBy ?? 'occurredAt'];
    const direction = String(query.sortDirection || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    return {
      where: filters.join(' AND '),params,orderBy: `${sort} ${direction} NULLS LAST,e.id ${direction}`,
      page: exportLimit ? 1 : query.page ?? 1,
      limit: exportLimit ?? Math.min(query.limit ?? 50,this.maxPageSize()),
    };
  }

  private buildSummaryEventFilter(scope: LogsScope, query: LogsQueryDto) {
    const params: unknown[] = [scope.tenantIds,scope.includePlatform];
    const filters = [
      `(tenant_id=ANY($1::uuid[]) OR ($2::boolean AND tenant_id IS NULL))`,
      `occurred_at >= now()-interval '24 hours'`,
    ];
    const fields: Array<[unknown,string]> = [
      [query.source,'source'],[query.module,'module'],[query.status,'status'],
      [query.eventType,'event_type'],[query.actorUserId,'actor_user_id'],
      [query.agentId,'agent_id'],[query.syncRunId,'sync_run_id'],
      [query.commandId,'command_id'],[query.correlationId,'correlation_id'],
    ];
    for (const [value,column] of fields) {
      if (value) { params.push(value);filters.push(`${column}=$${params.length}`); }
    }
    if (query.search) {
      params.push(query.search);
      filters.push(`(message ILIKE '%'||$${params.length}||'%' OR event_type ILIKE '%'||$${params.length}||'%')`);
    }
    return { where: filters.join(' AND '),params };
  }

  private assertDateRange(query: LogsQueryDto) {
    if (!query.from || !query.to) return;
    const from = new Date(query.from).getTime();
    const to = new Date(query.to).getTime();
    if (to < from) throw new BadRequestException('to must be after from');
    if (to-from > 366*86400000) {
      throw new BadRequestException('Log query range cannot exceed 366 days');
    }
  }

  private maxPageSize() {
    return this.flags.integer('SYSTEM_LOGS_MAX_PAGE_SIZE',200,1,200);
  }

  private toCsv(rows: Array<Record<string, unknown>>) {
    const columns = ['occurred_at','severity','tenant_name','source','module','event_type','message',
      'status','actor_name','agent_id','correlation_id','request_id','sync_run_id','command_id',
      'rows_processed','duration_ms','service_version','git_sha'];
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g,'""')}"`;
    return [columns.join(','),...rows.map((row) => columns.map((column) => escape(row[column])).join(','))].join('\n');
  }
}
