import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditService } from '../../common/audit/audit.service';
import { sanitizeMetadata } from '../../common/utils/metadata-sanitizer';
import { PlatformConfigService } from '../../config/platform-config.service';
import { SystemLogsService } from '../system-logs/system-logs.service';
import {
  AgentHeartbeatDto, CommandProgressDto, CommandResultDto, CreateSyncCommandDto,
  SYNC_COMMAND_TYPES, SyncCommandType,
} from './sync-control.dto';

const MODULE_COMMANDS: Partial<Record<SyncCommandType, string>> = {
  RESYNC_INVENTORY: 'inventory',
  RESYNC_PRODUCTS: 'products',
  RESYNC_ORDERS: 'orders',
  RESYNC_CUSTOMERS: 'customers',
};

@Injectable()
export class SyncControlService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly flags: PlatformConfigService,
    private readonly events: SystemLogsService,
    private readonly audit: AuditService,
  ) {}

  private requireStatus() {
    if (!this.flags.enabled('SYNC_CONTROL_STATUS_ENABLED')) {
      throw new ServiceUnavailableException({ code: 'FEATURE_DISABLED', message: 'Sync Control status is disabled' });
    }
  }

  private requireHeartbeat() {
    if (!this.flags.enabled('SYNC_CONTROL_HEARTBEAT_ENABLED')) {
      throw new ServiceUnavailableException({ code: 'FEATURE_DISABLED', message: 'Sync agent heartbeat is disabled' });
    }
  }

  private requireCommands(commandType?: SyncCommandType) {
    if (!this.flags.enabled('SYNC_CONTROL_COMMANDS_ENABLED')) {
      throw new ServiceUnavailableException({ code: 'FEATURE_DISABLED', message: 'Remote sync commands are disabled' });
    }
    if (commandType?.startsWith('RESYNC_') &&
      !this.flags.enabled('SYNC_CONTROL_MODULE_RESYNC_ENABLED')) {
      throw new ServiceUnavailableException({ code: 'FEATURE_DISABLED', message: 'Module re-sync commands are disabled' });
    }
    if (commandType === 'RESYNC_FULL' &&
      !this.flags.enabled('SYNC_CONTROL_ADVANCED_COMMANDS_ENABLED')) {
      throw new ServiceUnavailableException({ code: 'FEATURE_DISABLED', message: 'Advanced sync commands are disabled' });
    }
  }

  private leaseSeconds() {
    return this.flags.integer('SYNC_CONTROL_LEASE_SECONDS', 120, 60, 900);
  }

  private assertVersion(version?: string) {
    const minimum = String(process.env.SYNC_CONTROL_MIN_AGENT_VERSION || '').trim();
    if (!minimum || !version) return;
    const parse = (value: string) => value.split('.').slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
    const current = parse(version);
    const required = parse(minimum);
    for (let index = 0; index < 3; index++) {
      if (current[index] > required[index]) return;
      if (current[index] < required[index]) {
        throw new ForbiddenException(`Agent version ${version} is below minimum ${minimum}`);
      }
    }
  }

  private async markInterrupted(tenantId: string) {
    const rows = await this.db.query(
      `UPDATE sync_commands SET status='interrupted',updated_at=now()
       WHERE tenant_id=$1 AND status IN ('claimed','running','cancel_requested')
         AND lease_until IS NOT NULL AND lease_until < now()
       RETURNING id,agent_id,command_type,correlation_id`,
      [tenantId],
    );
    for (const row of rows) {
      await this.record(tenantId,row.id,'interrupted','Command lease expired');
      await this.db.query(
        `UPDATE sync_agents SET current_command_id=NULL,current_job=NULL,updated_at=now()
         WHERE tenant_id=$1 AND agent_id=$2 AND current_command_id=$3`,
        [tenantId,row.agent_id,row.id],
      );
      void this.events.emit({
        tenantId,source: 'backend',eventType: 'sync_command.interrupted',severity: 'warning',
        message: `${row.command_type} interrupted after lease expiry`,agentId: row.agent_id,
        commandId: row.id,correlationId: row.correlation_id,
      });
    }
  }

  async heartbeat(tenantId: string, dto: AgentHeartbeatDto) {
    this.requireHeartbeat();
    this.assertVersion(dto.serviceVersion);
    const existing = await this.db.query(
      `SELECT is_enabled FROM sync_agents WHERE tenant_id=$1 AND agent_id=$2`,
      [tenantId,dto.agentId],
    );
    if (existing[0]?.is_enabled === false) throw new ForbiddenException('Sync agent is disabled');
    const rows = await this.db.query(
      `INSERT INTO sync_agents
       (tenant_id,agent_id,display_name,machine_name,service_version,git_sha,scheduler_state,current_job,
        current_command_id,jtl_connection_status,backend_connection_status,capabilities,last_heartbeat_at,
        last_successful_sync_at,next_scheduled_sync_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),$13,$14,now())
       ON CONFLICT (tenant_id,agent_id) DO UPDATE SET
        display_name=EXCLUDED.display_name,machine_name=EXCLUDED.machine_name,
        service_version=EXCLUDED.service_version,git_sha=EXCLUDED.git_sha,
        scheduler_state=EXCLUDED.scheduler_state,current_job=EXCLUDED.current_job,
        current_command_id=EXCLUDED.current_command_id,
        jtl_connection_status=EXCLUDED.jtl_connection_status,
        backend_connection_status=EXCLUDED.backend_connection_status,
        capabilities=EXCLUDED.capabilities,last_heartbeat_at=now(),
        last_successful_sync_at=COALESCE(EXCLUDED.last_successful_sync_at,sync_agents.last_successful_sync_at),
        next_scheduled_sync_at=EXCLUDED.next_scheduled_sync_at,updated_at=now()
       RETURNING *`,
      [tenantId,dto.agentId,dto.displayName,dto.machineName ?? null,dto.serviceVersion ?? null,
        dto.gitSha ?? null,dto.schedulerState ?? null,dto.currentJob ?? null,
        dto.currentCommandId ?? null,dto.jtlConnectionStatus ?? null,dto.backendConnectionStatus ?? null,
        JSON.stringify(sanitizeMetadata(dto.capabilities ?? {})),dto.lastSuccessfulSyncAt ?? null,
        dto.nextScheduledSyncAt ?? null],
    );
    return {
      agent: rows[0],serverTime: new Date().toISOString(),
      heartbeatIntervalSeconds: this.flags.integer('SYNC_CONTROL_HEARTBEAT_INTERVAL_SECONDS',30,10,300),
      commandPollSeconds: this.flags.integer('SYNC_CONTROL_COMMAND_POLL_SECONDS',10,5,120),
    };
  }

  async status(tenantId: string) {
    this.requireStatus();
    await this.markInterrupted(tenantId);
    const [agents,runs,commands] = await Promise.all([
      this.db.query(
        `SELECT *,CASE
          WHEN last_heartbeat_at IS NULL THEN 'never_connected'
          WHEN last_heartbeat_at >= now()-interval '90 seconds' THEN 'online'
          WHEN last_heartbeat_at >= now()-interval '5 minutes' THEN 'degraded'
          ELSE 'offline' END AS connection_status
         FROM sync_agents WHERE tenant_id=$1
         ORDER BY last_heartbeat_at DESC NULLS LAST`,
        [tenantId],
      ),
      this.db.query(
        `SELECT * FROM sync_runs WHERE tenant_id=$1
         ORDER BY started_at DESC LIMIT 50`,
        [tenantId],
      ),
      this.db.query(
        `SELECT c.*,u.full_name AS requested_by_name
         FROM sync_commands c LEFT JOIN users u ON u.id=c.requested_by
         WHERE c.tenant_id=$1 ORDER BY c.created_at DESC LIMIT 50`,
        [tenantId],
      ),
    ]);
    return {
      agents,runs,commands,
      activeCommand: commands.find((row: { status: string }) =>
        ['queued','claimed','running','cancel_requested'].includes(row.status)) ?? null,
      serverTime: new Date().toISOString(),
    };
  }

  async getAgent(tenantId: string, agentId: string) {
    const result = await this.status(tenantId);
    const agent = result.agents.find((row: { agent_id: string }) => row.agent_id === agentId);
    if (!agent) throw new NotFoundException('Sync agent not found');
    return agent;
  }

  async listCommands(tenantId: string, page = 1, limit = 50) {
    this.requireStatus();
    await this.markInterrupted(tenantId);
    const boundedLimit = Math.min(Math.max(limit,1),200);
    const boundedPage = Math.max(page,1);
    const [rows,count] = await Promise.all([
      this.db.query(
        `SELECT c.*,u.full_name AS requested_by_name FROM sync_commands c
         LEFT JOIN users u ON u.id=c.requested_by
         WHERE c.tenant_id=$1 ORDER BY c.created_at DESC LIMIT $2 OFFSET $3`,
        [tenantId,boundedLimit,(boundedPage-1)*boundedLimit],
      ),
      this.db.query(`SELECT COUNT(*)::int AS total FROM sync_commands WHERE tenant_id=$1`,[tenantId]),
    ]);
    return { rows,pagination: { page: boundedPage,limit: boundedLimit,total: Number(count[0]?.total || 0) } };
  }

  async getCommand(tenantId: string, id: string) {
    this.requireStatus();
    const rows = await this.db.query(
      `SELECT c.*,u.full_name AS requested_by_name FROM sync_commands c
       LEFT JOIN users u ON u.id=c.requested_by WHERE c.id=$1 AND c.tenant_id=$2`,
      [id,tenantId],
    );
    if (!rows[0]) throw new NotFoundException('Sync command not found');
    const history = await this.db.query(
      `SELECT * FROM sync_command_events WHERE tenant_id=$1 AND command_id=$2 ORDER BY created_at`,
      [tenantId,id],
    );
    return { ...rows[0],events: history };
  }

  async create(
    tenantId: string,userId: string,dto: CreateSyncCommandDto,
    ip?: string,userAgent?: string,correlationId?: string,
  ) {
    this.requireCommands(dto.commandType);
    if (!SYNC_COMMAND_TYPES.includes(dto.commandType)) throw new ForbiddenException('Command type is not approved');
    if (['RESYNC_FULL'].includes(dto.commandType) && !dto.reason?.trim()) {
      throw new BadRequestException('A reason is required for protected commands');
    }
    const agents = await this.db.query(
      `SELECT * FROM sync_agents WHERE tenant_id=$1 AND agent_id=$2 AND is_enabled=true`,
      [tenantId,dto.agentId],
    );
    const agent = agents[0];
    if (!agent) throw new NotFoundException('Enabled sync agent not found');
    const isOffline = !agent.last_heartbeat_at ||
      Date.now()-new Date(agent.last_heartbeat_at).getTime() > 5*60_000;
    if (isOffline && !this.flags.enabled('SYNC_CONTROL_ALLOW_OFFLINE_QUEUE')) {
      throw new ConflictException('Agent is offline and offline queueing is disabled');
    }
    this.assertCapability(agent.capabilities,dto.commandType);
    try {
      const rows = await this.db.query(
        `INSERT INTO sync_commands
         (tenant_id,agent_id,command_type,payload,priority,idempotency_key,requested_by,request_reason,
          requested_ip,requested_user_agent,correlation_id,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()+interval '24 hours') RETURNING *`,
        [tenantId,dto.agentId,dto.commandType,JSON.stringify(sanitizeMetadata(dto.payload ?? {})),
          dto.priority ?? 100,dto.idempotencyKey,userId,dto.reason ?? null,ip ?? null,
          userAgent ?? null,correlationId ?? null],
      );
      await this.record(tenantId,rows[0].id,'queued','Command queued',{ requestedBy: userId });
      await this.audit.log({
        action: 'sync.command.queued',actorId: userId,tenantId,targetId: rows[0].id,
        requestId: correlationId,metadata: {
          agentId: dto.agentId,commandType: dto.commandType,reason: dto.reason ?? null,
        },
      });
      void this.events.emit({
        tenantId,source: 'admin',eventType: 'sync_command.queued',severity: 'info',
        message: `${dto.commandType} queued`,actorUserId: userId,commandId: rows[0].id,correlationId,
      });
      return rows[0];
    } catch (error: unknown) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('An active command already uses this idempotency key');
      }
      throw error;
    }
  }

  private assertCapability(capabilities: unknown, commandType: SyncCommandType) {
    const value = typeof capabilities === 'string' ? JSON.parse(capabilities) : capabilities;
    const caps = (value ?? {}) as { commands?: boolean;modules?: string[];pauseResume?: boolean;diagnostics?: boolean };
    if (caps.commands === false) throw new ConflictException('Agent does not support remote commands');
    const module = MODULE_COMMANDS[commandType];
    if (module && Array.isArray(caps.modules) && !caps.modules.includes(module)) {
      throw new ConflictException(`Agent does not support ${module} synchronization`);
    }
    if (['PAUSE_SCHEDULER','RESUME_SCHEDULER'].includes(commandType) && caps.pauseResume === false) {
      throw new ConflictException('Agent does not support scheduler pause/resume');
    }
    if (['RUN_DIAGNOSTICS','TEST_JTL_CONNECTION','TEST_BACKEND_CONNECTION'].includes(commandType) &&
      caps.diagnostics === false) {
      throw new ConflictException('Agent does not support diagnostics');
    }
  }

  async claim(tenantId: string, agentId: string) {
    this.requireCommands();
    await this.markInterrupted(tenantId);
    const lease = this.leaseSeconds();
    const rows = await this.db.query(
      `WITH candidate AS (
         SELECT id FROM sync_commands
         WHERE tenant_id=$1 AND agent_id=$2 AND status='queued'
           AND (expires_at IS NULL OR expires_at>now())
         ORDER BY priority,created_at FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE sync_commands c SET status='claimed',claimed_at=now(),
         lease_until=now()+($3||' seconds')::interval,updated_at=now()
       FROM candidate WHERE c.id=candidate.id RETURNING c.*`,
      [tenantId,agentId,lease],
    );
    if (!rows[0]) return { command: null };
    await this.db.query(
      `UPDATE sync_agents SET current_command_id=$3,current_job=$4,updated_at=now()
       WHERE tenant_id=$1 AND agent_id=$2 AND is_enabled=true`,
      [tenantId,agentId,rows[0].id,rows[0].command_type],
    );
    await this.record(tenantId,rows[0].id,'claimed','Command claimed');
    void this.events.emit({
      tenantId,source: 'sync-engine',eventType: 'sync_command.claimed',severity: 'info',
      message: `${rows[0].command_type} claimed`,agentId,commandId: rows[0].id,
      correlationId: rows[0].correlation_id,
    });
    return { command: rows[0],leaseSeconds: lease };
  }

  async progress(tenantId: string, agentId: string, id: string, dto: CommandProgressDto) {
    this.requireCommands();
    const lease = this.leaseSeconds();
    const rows = await this.db.query(
      `UPDATE sync_commands SET status='running',started_at=COALESCE(started_at,now()),
       progress_percent=COALESCE($4,progress_percent),progress_message=$5,
       rows_processed=COALESCE($6,rows_processed),current_batch=COALESCE($7,current_batch),
       total_batches=COALESCE($8,total_batches),
       lease_until=now()+($9||' seconds')::interval,updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND agent_id=$3 AND status IN ('claimed','running','cancel_requested')
       RETURNING *`,
      [id,tenantId,agentId,dto.progressPercent ?? null,dto.message ?? null,
        dto.rowsProcessed ?? null,dto.currentBatch ?? null,dto.totalBatches ?? null,lease],
    );
    if (!rows[0]) throw new NotFoundException('Active command not found');
    await this.record(tenantId,id,'progress',dto.message ?? 'Progress updated',{
      progressPercent: dto.progressPercent,rowsProcessed: dto.rowsProcessed,
      currentBatch: dto.currentBatch,totalBatches: dto.totalBatches,
    });
    if (!rows[0].started_at || dto.progressPercent === 0) {
      void this.events.emit({
        tenantId,source: 'sync-engine',eventType: 'sync_command.started',severity: 'info',
        message: dto.message ?? 'Command started',agentId,commandId: id,
        correlationId: rows[0].correlation_id,
      });
    }
    return rows[0];
  }

  async renew(tenantId: string, agentId: string, id: string) {
    this.requireCommands();
    const rows = await this.db.query(
      `UPDATE sync_commands SET lease_until=now()+($4||' seconds')::interval,updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND agent_id=$3
         AND status IN ('claimed','running','cancel_requested')
       RETURNING id,status,lease_until`,
      [id,tenantId,agentId,this.leaseSeconds()],
    );
    if (!rows[0]) throw new NotFoundException('Active command not found');
    return rows[0];
  }

  async finish(
    tenantId: string,agentId: string,id: string,
    status: 'completed'|'failed'|'cancelled',body: CommandResultDto,
  ) {
    this.requireCommands();
    const current = await this.db.query(
      `SELECT * FROM sync_commands WHERE id=$1 AND tenant_id=$2 AND agent_id=$3`,
      [id,tenantId,agentId],
    );
    if (!current[0]) throw new NotFoundException('Sync command not found');
    if (current[0].status === status) return current[0];
    if (['completed','failed','cancelled','expired','interrupted','rejected'].includes(current[0].status)) {
      throw new ConflictException(`Command is already ${current[0].status}`);
    }
    const rows = await this.db.query(
      `UPDATE sync_commands SET status=$4,
       progress_percent=CASE WHEN $4='completed' THEN 100 ELSE progress_percent END,
       completed_at=CASE WHEN $4 IN ('completed','failed') THEN now() ELSE completed_at END,
       cancelled_at=CASE WHEN $4='cancelled' THEN now() ELSE cancelled_at END,
       result=$5,error_code=$6,error_message=$7,lease_until=NULL,updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND agent_id=$3 RETURNING *`,
      [id,tenantId,agentId,status,JSON.stringify(sanitizeMetadata(body.result ?? {})),
        body.errorCode ?? null,body.errorMessage ?? null],
    );
    await this.db.query(
      `UPDATE sync_agents SET current_command_id=NULL,current_job=NULL,
       last_failure_at=CASE WHEN $4='failed' THEN now() ELSE last_failure_at END,
       last_failure_message=CASE WHEN $4='failed' THEN $5 ELSE last_failure_message END,
       updated_at=now() WHERE tenant_id=$1 AND agent_id=$2 AND current_command_id=$3`,
      [tenantId,agentId,id,status,body.errorMessage ?? body.message ?? null],
    );
    await this.record(tenantId,id,status,String(body.message || status),{
      errorCode: body.errorCode,result: sanitizeMetadata(body.result ?? {}),
    });
    const eventType = status === 'completed' ? 'sync_command.completed'
      : status === 'failed' ? 'sync_command.failed' : 'sync_command.cancelled';
    void this.events.emit({
      tenantId,source: 'sync-engine',eventType,severity: status === 'failed' ? 'error' : 'info',
      message: body.message ?? `Command ${status}`,agentId,commandId: id,
      correlationId: rows[0].correlation_id,metadata: {
        errorCode: body.errorCode,rowsProcessed: rows[0].rows_processed,
      },
    });
    return rows[0];
  }

  async cancel(tenantId: string, id: string, userId?: string) {
    this.requireCommands();
    const existing = await this.db.query(
      `SELECT c.status,a.capabilities FROM sync_commands c
       LEFT JOIN sync_agents a ON a.tenant_id=c.tenant_id AND a.agent_id=c.agent_id
       WHERE c.id=$1 AND c.tenant_id=$2`,
      [id,tenantId],
    );
    if (!existing[0]) throw new NotFoundException('Sync command not found');
    const capabilities = typeof existing[0].capabilities === 'string'
      ? JSON.parse(existing[0].capabilities) : existing[0].capabilities ?? {};
    if (['claimed','running'].includes(existing[0].status) && capabilities.safeCancellation !== true) {
      throw new ConflictException('This agent supports queued cancellation only');
    }
    const rows = await this.db.query(
      `UPDATE sync_commands SET
       status=CASE WHEN status='queued' THEN 'cancelled' ELSE 'cancel_requested' END,
       cancellation_requested_at=now(),
       cancelled_at=CASE WHEN status='queued' THEN now() ELSE cancelled_at END,
       updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND status IN ('queued','claimed','running')
       RETURNING *`,
      [id,tenantId],
    );
    if (!rows[0]) throw new NotFoundException('Cancellable command not found');
    const eventType = rows[0].status === 'cancelled' ? 'cancelled' : 'cancellation_requested';
    await this.record(tenantId,id,eventType,
      rows[0].status === 'cancelled' ? 'Queued command cancelled' : 'Cancellation requested');
    await this.audit.log({
      action: `sync.command.${eventType}`,actorId: userId,tenantId,targetId: id,
      metadata: { agentId: rows[0].agent_id,commandType: rows[0].command_type },
    });
    void this.events.emit({
      tenantId,source: 'admin',
      eventType: rows[0].status === 'cancelled'
        ? 'sync_command.cancelled' : 'sync_command.cancel_requested',
      severity: 'warning',message: rows[0].status === 'cancelled'
        ? 'Queued command cancelled' : 'Command cancellation requested',
      actorUserId: userId,commandId: id,correlationId: rows[0].correlation_id,
    });
    return rows[0];
  }

  private async record(
    tenantId: string,commandId: string,eventType: string,message: string,
    details: Record<string,unknown> = {},
  ) {
    await this.db.query(
      `INSERT INTO sync_command_events
       (tenant_id,command_id,event_type,message,details) VALUES ($1,$2,$3,$4,$5)`,
      [tenantId,commandId,eventType,message,JSON.stringify(sanitizeMetadata(details))],
    );
  }
}
