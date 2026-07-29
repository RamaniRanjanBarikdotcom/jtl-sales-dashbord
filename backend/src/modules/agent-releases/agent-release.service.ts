import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { AuditService } from '../../common/audit/audit.service';
import { sanitizeMetadata } from '../../common/utils/metadata-sanitizer';
import { PlatformConfigService } from '../../config/platform-config.service';
import { SystemLogsService } from '../system-logs/system-logs.service';
import {
  AgentUpdateProgressDto, AgentUpdateResultDto, ClaimAgentUpdateDto,
  CreateAgentReleaseDto, RequestAgentUpdateDto,
} from './agent-release.dto';
import {
  AgentReleaseManifest, signManifest, verifyManifest,
} from './agent-release-manifest';
import { AgentReleaseStorageService } from './agent-release-storage.service';

type ReleaseRow = {
  id: string; application_id: string; channel: string; version: string; git_sha: string;
  protocol_version: number; package_path: string; package_size: string | number | null;
  package_sha256: string | null; manifest: AgentReleaseManifest | string | null;
  manifest_signature: string | null; publisher_thumbprint: string;
  minimum_supported_version: string | null; release_notes: string | null;
  health_timeout_seconds: number; requires_service_restart: boolean;
  requires_machine_restart: boolean; status: string; published_at: Date | string | null;
};

const ACTIVE_UPDATE_STATUSES = [
  'requested','approved','claimed','downloading','verifying','staged',
  'waiting_for_window','installing','restarting','verifying_health','rollback_started',
];

@Injectable()
export class AgentReleaseService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly storage: AgentReleaseStorageService,
    private readonly flags: PlatformConfigService,
    private readonly audit: AuditService,
    private readonly events: SystemLogsService,
  ) {}

  private requireFeature(name:
    'SYNC_AGENT_UPDATE_ENABLED'|'SYNC_AGENT_UPDATE_REQUEST_ENABLED'|
    'SYNC_AGENT_RELEASE_MANAGEMENT_ENABLED',
  ) {
    if (!this.flags.enabled(name)) {
      throw new ServiceUnavailableException({ code: 'FEATURE_DISABLED', message: `${name} is disabled` });
    }
  }

  private privateKey(): string {
    const key = String(process.env.SYNC_AGENT_MANIFEST_PRIVATE_KEY_PEM || '').replace(/\\n/g, '\n').trim();
    if (!key) throw new ServiceUnavailableException('Manifest signing key is not configured');
    return key;
  }

  private publicKey(): string {
    const key = String(process.env.SYNC_AGENT_MANIFEST_PUBLIC_KEY_PEM || '').replace(/\\n/g, '\n').trim();
    if (!key) throw new ServiceUnavailableException('Manifest verification key is not configured');
    return key;
  }

  private parseManifest(value: AgentReleaseManifest | string | null): AgentReleaseManifest {
    if (!value) throw new ConflictException('Release manifest is unavailable');
    return typeof value === 'string' ? JSON.parse(value) as AgentReleaseManifest : value;
  }

  private compareVersions(left: string, right: string): number {
    const parse = (value: string) => value.split('-')[0].split('.').slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);
    const a = parse(left); const b = parse(right);
    for (let index = 0; index < 3; index++) {
      if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
    }
    return 0;
  }

  private async release(id: string): Promise<ReleaseRow> {
    const rows = await this.db.query(`SELECT * FROM agent_releases WHERE id=$1`, [id]);
    if (!rows[0]) throw new NotFoundException('Agent release not found');
    return rows[0];
  }

  private publicUpdate(row: Record<string, unknown>, release: ReleaseRow) {
    return {
      id: row.id, releaseId: row.release_id,
      updateTransactionId: row.update_transaction_id,
      currentVersion: row.current_version, currentGitSha: row.current_git_sha,
      targetVersion: row.target_version, targetGitSha: row.target_git_sha,
      installMode: row.install_mode ?? 'maintenance',
      retryFailed: row.allow_retry === true,
      status: row.status, release: this.publicRelease(release),
    };
  }

  async create(userId: string, dto: CreateAgentReleaseDto) {
    this.requireFeature('SYNC_AGENT_RELEASE_MANAGEMENT_ENABLED');
    this.storage.resolvePackage(dto.packageFileName);
    try {
      const rows = await this.db.query(
        `INSERT INTO agent_releases
         (channel,version,git_sha,protocol_version,package_path,publisher_thumbprint,
          minimum_supported_version,release_notes,health_timeout_seconds,
          requires_service_restart,requires_machine_restart,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [dto.channel,dto.version,dto.gitSha.toLowerCase(),dto.protocolVersion,dto.packageFileName,
          dto.publisherThumbprint.replace(/\s/g, '').toUpperCase(),dto.minimumSupportedVersion ?? null,
          dto.releaseNotes ?? null,dto.healthTimeoutSeconds ?? 120,
          dto.requiresServiceRestart ?? true,dto.requiresMachineRestart ?? false,userId],
      );
      await this.audit.log({
        action: 'agent_update.release_created',actorId: userId,targetId: rows[0].id,
        metadata: { channel: dto.channel,version: dto.version,packageFileName: dto.packageFileName },
      });
      return rows[0];
    } catch (error: unknown) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('This channel and version already exist');
      }
      throw error;
    }
  }

  async validate(id: string, userId: string) {
    this.requireFeature('SYNC_AGENT_RELEASE_MANAGEMENT_ENABLED');
    const release = await this.release(id);
    if (!['draft','validated'].includes(release.status)) {
      throw new ConflictException(`Release cannot be validated from ${release.status}`);
    }
    const stats = await this.storage.stat(release.package_path);
    const maximum = Number.parseInt(
      process.env.SYNC_AGENT_RELEASE_MAX_PACKAGE_BYTES || String(512 * 1024 * 1024), 10,
    );
    if (stats.size <= 0 || stats.size > maximum) throw new BadRequestException('Release package size is not allowed');
    const hash = createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      const stream = this.storage.stream(release.package_path);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    const digest = hash.digest('hex');
    const rows = await this.db.query(
      `UPDATE agent_releases SET package_size=$2,package_sha256=$3,status='validated',
       updated_at=now() WHERE id=$1 RETURNING *`, [id,stats.size,digest],
    );
    await this.audit.log({
      action: 'agent_update.release_validated',actorId: userId,targetId: id,
      metadata: { version: release.version,size: stats.size,sha256: digest },
    });
    return rows[0];
  }

  async publish(id: string, userId: string) {
    this.requireFeature('SYNC_AGENT_RELEASE_MANAGEMENT_ENABLED');
    const release = await this.release(id);
    if (release.status !== 'validated' || !release.package_sha256 || !release.package_size) {
      throw new ConflictException('Release must be validated before publishing');
    }
    const publishedAt = new Date().toISOString();
    const manifest: AgentReleaseManifest = {
      applicationId: 'JtlSyncEngine',channel: release.channel,version: release.version,
      gitSha: release.git_sha,protocolVersion: release.protocol_version,
      minimumSupportedVersion: release.minimum_supported_version,
      packagePath: `/api/sync-agent/releases/${release.id}/package`,
      packageSize: Number(release.package_size),sha256: release.package_sha256,
      publisherCertificateThumbprints: [release.publisher_thumbprint],
      publishedAt,requiresServiceRestart: release.requires_service_restart,
      requiresMachineRestart: release.requires_machine_restart,
      healthTimeoutSeconds: release.health_timeout_seconds,releaseNotes: release.release_notes,
    };
    const signature = signManifest(manifest, this.privateKey());
    if (!verifyManifest(manifest, signature, this.publicKey())) {
      throw new ServiceUnavailableException('Manifest signing-key verification failed');
    }
    const rows = await this.db.query(
      `UPDATE agent_releases SET manifest=$2,manifest_signature=$3,status='published',
       published_at=$4,updated_at=now() WHERE id=$1 RETURNING *`,
      [id,JSON.stringify(manifest),signature,publishedAt],
    );
    await this.db.query(
      `UPDATE agent_releases SET status='superseded',updated_at=now()
       WHERE channel=$1 AND status='published' AND id<>$2`, [release.channel,id],
    );
    await this.audit.log({
      action: 'agent_update.release_published',actorId: userId,targetId: id,
      metadata: { channel: release.channel,version: release.version,gitSha: release.git_sha },
    });
    return rows[0];
  }

  async revoke(id: string, userId: string) {
    this.requireFeature('SYNC_AGENT_RELEASE_MANAGEMENT_ENABLED');
    const release = await this.release(id);
    if (!['published','validated','blocked'].includes(release.status)) {
      throw new ConflictException(`Release cannot be revoked from ${release.status}`);
    }
    const rows = await this.db.query(
      `UPDATE agent_releases SET status='revoked',updated_at=now() WHERE id=$1 RETURNING *`, [id],
    );
    await this.audit.log({
      action: 'agent_update.release_revoked',actorId: userId,targetId: id,
      metadata: { version: release.version },
    });
    return rows[0];
  }

  async list() {
    this.requireFeature('SYNC_AGENT_RELEASE_MANAGEMENT_ENABLED');
    return this.db.query(
      `SELECT id,application_id,channel,version,git_sha,protocol_version,package_path,
       package_size,package_sha256,publisher_thumbprint,minimum_supported_version,
       release_notes,health_timeout_seconds,requires_service_restart,
       requires_machine_restart,status,published_at,created_by,created_at,updated_at
       FROM agent_releases ORDER BY created_at DESC`,
    );
  }

  async get(id: string) {
    this.requireFeature('SYNC_AGENT_RELEASE_MANAGEMENT_ENABLED');
    const release = await this.release(id);
    return { ...release,manifest_signature: release.manifest_signature ? '[configured]' : null };
  }

  async current(tenantId: string, agentId: string, currentVersion: string, channel = 'stable') {
    this.requireFeature('SYNC_AGENT_UPDATE_ENABLED');
    const agents = await this.db.query(
      `SELECT * FROM sync_agents WHERE tenant_id=$1 AND agent_id=$2 AND is_enabled=true`, [tenantId,agentId],
    );
    if (!agents[0]) throw new NotFoundException('Registered sync agent not found');
    const rows = await this.db.query(
      `SELECT r.* FROM agent_releases r
       WHERE r.channel=$1 AND r.status='published'
         AND NOT EXISTS (
           SELECT 1 FROM agent_bad_releases b
           WHERE b.tenant_id=$2 AND b.agent_id=$3 AND b.release_id=r.id
             AND (b.permanently_blocked=true OR b.suppressed_until>now())
         )
       ORDER BY r.published_at DESC LIMIT 1`, [channel,tenantId,agentId],
    );
    const release = rows[0] as ReleaseRow | undefined;
    if (!release || this.compareVersions(release.version,currentVersion) <= 0) {
      return { updateAvailable: false,currentVersion,release: null };
    }
    if (release.minimum_supported_version &&
      this.compareVersions(currentVersion,release.minimum_supported_version) < 0) {
      return { updateAvailable: false,upgradeRequired: true,currentVersion,release: null };
    }
    return {
      updateAvailable: true,currentVersion,
      release: this.publicRelease(release),
    };
  }

  private publicRelease(release: ReleaseRow) {
    const manifest = this.parseManifest(release.manifest);
    if (!release.manifest_signature || !verifyManifest(manifest,release.manifest_signature,this.publicKey())) {
      throw new ConflictException('Published manifest signature is invalid');
    }
    return { id: release.id,manifest,signature: release.manifest_signature };
  }

  async request(
    tenantId: string,agentId: string,userId: string,dto: RequestAgentUpdateDto,
    ip?: string,userAgent?: string,correlationId?: string,
  ) {
    this.requireFeature('SYNC_AGENT_UPDATE_REQUEST_ENABLED');
    const [agentRows,release] = await Promise.all([
      this.db.query(`SELECT * FROM sync_agents WHERE tenant_id=$1 AND agent_id=$2 AND is_enabled=true`, [tenantId,agentId]),
      this.release(dto.releaseId),
    ]);
    const agent = agentRows[0];
    if (!agent) throw new NotFoundException('Registered sync agent not found');
    if (release.status !== 'published') throw new ConflictException('Only published releases can be requested');
    const capabilities = typeof agent.capabilities === 'string' ? JSON.parse(agent.capabilities) : agent.capabilities ?? {};
    if (capabilities.safeUpdate !== true) throw new ConflictException('Agent does not report safeUpdate capability');
    if (this.compareVersions(release.version,agent.service_version || '0.0.0') <= 0) {
      throw new ConflictException('Target release is not newer than the installed version');
    }
    const bad = await this.db.query(
      `SELECT * FROM agent_bad_releases WHERE tenant_id=$1 AND agent_id=$2 AND release_id=$3
       AND (permanently_blocked=true OR suppressed_until>now())`, [tenantId,agentId,release.id],
    );
    if (bad[0] && !dto.retryFailed) throw new ConflictException('Release is suppressed for this agent');
    try {
      const rows = await this.db.query(
        `INSERT INTO agent_update_requests
         (tenant_id,agent_id,release_id,requested_by,request_reason,status,current_version,
          current_git_sha,target_version,target_git_sha,install_mode,correlation_id,
          requested_ip,requested_user_agent,allow_retry)
         VALUES ($1,$2,$3,$4,$5,'approved',$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [tenantId,agentId,release.id,userId,dto.reason,agent.service_version ?? null,
          agent.git_sha ?? null,release.version,release.git_sha,dto.installMode ?? 'maintenance',
          correlationId ?? null,ip ?? null,userAgent ?? null,dto.retryFailed === true],
      );
      await this.audit.log({
        action: 'agent_update.requested',actorId: userId,tenantId,targetId: rows[0].id,
        correlationId,metadata: { agentId,currentVersion: agent.service_version,targetVersion: release.version,
          releaseId: release.id,reason: dto.reason },
      });
      await this.emit(tenantId,agentId,'agent_update.requested','info','Update requested',rows[0],userId);
      return rows[0];
    } catch (error: unknown) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('This agent already has an active update request');
      }
      throw error;
    }
  }

  async claim(tenantId: string, dto: ClaimAgentUpdateDto) {
    this.requireFeature('SYNC_AGENT_UPDATE_ENABLED');
    const active = await this.db.query(
      `SELECT * FROM agent_update_requests
       WHERE tenant_id=$1 AND agent_id=$2 AND status IN (
         'claimed','downloading','verifying','staged','waiting_for_window'
       ) ORDER BY claimed_at DESC NULLS LAST LIMIT 1`,
      [tenantId,dto.agentId],
    );
    if (active[0]) {
      const activeRelease = await this.release(active[0].release_id);
      return { update: this.publicUpdate(active[0],activeRelease) };
    }
    const rows = await this.db.query(
      `WITH candidate AS (
         SELECT id FROM agent_update_requests
         WHERE tenant_id=$1 AND agent_id=$2 AND status='approved'
         ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE agent_update_requests u SET status='claimed',claimed_at=now(),
         current_version=$3,current_git_sha=$4,updated_at=now()
       FROM candidate WHERE u.id=candidate.id RETURNING u.*`,
      [tenantId,dto.agentId,dto.currentVersion,dto.currentGitSha],
    );
    if (!rows[0]) return { update: null };
    const release = await this.release(rows[0].release_id);
    await this.emit(tenantId,dto.agentId,'agent_update.claimed','info','Update claimed',rows[0]);
    return { update: this.publicUpdate(rows[0],release) };
  }

  async progress(tenantId: string,id: string,dto: AgentUpdateProgressDto) {
    this.requireFeature('SYNC_AGENT_UPDATE_ENABLED');
    const timestampColumn: Record<string,string> = {
      downloading: 'download_started_at',staged: 'staged_at',installing: 'install_started_at',
    };
    const column = timestampColumn[dto.status];
    const rows = await this.db.query(
      `UPDATE agent_update_requests SET status=$4,
       result=COALESCE($5::jsonb,result),updated_at=now()
       ${column ? `,${column}=COALESCE(${column},now())` : ''}
       WHERE id=$1 AND tenant_id=$2 AND agent_id=$3
         AND status=ANY($6::varchar[]) RETURNING *`,
      [id,tenantId,dto.agentId,dto.status,
        dto.result ? JSON.stringify(sanitizeMetadata(dto.result)) : null,ACTIVE_UPDATE_STATUSES],
    );
    if (!rows[0]) throw new NotFoundException('Active update request not found');
    const eventType = dto.eventType?.startsWith('agent_update.') ? dto.eventType : `agent_update.${dto.status}`;
    await this.emit(tenantId,dto.agentId,eventType,'info',dto.message ?? dto.status,rows[0]);
    return rows[0];
  }

  async complete(tenantId: string,id: string,dto: AgentUpdateResultDto) {
    this.requireFeature('SYNC_AGENT_UPDATE_ENABLED');
    const requestRows = await this.db.query(
      `SELECT * FROM agent_update_requests WHERE id=$1 AND tenant_id=$2 AND agent_id=$3`,
      [id,tenantId,dto.agentId],
    );
    const request = requestRows[0];
    if (!request) throw new NotFoundException('Update request not found');
    if (request.status === 'completed') return request;
    const healthTimeout = Math.max(30,Math.min(900,Number(
      (await this.db.query(
        `SELECT health_timeout_seconds FROM agent_releases WHERE id=$1`,
        [request.release_id],
      ))[0]?.health_timeout_seconds ?? 120,
    )));
    const agents = await this.db.query(
      `SELECT * FROM sync_agents WHERE tenant_id=$1 AND agent_id=$2
       AND last_heartbeat_at>=now()-make_interval(secs => $3)
       AND backend_connection_status='connected'
       AND scheduler_state IS NOT NULL`, [tenantId,dto.agentId,healthTimeout],
    );
    const agent = agents[0];
    if (!agent || agent.service_version !== request.target_version ||
      String(agent.git_sha || '').toLowerCase() !== String(request.target_git_sha).toLowerCase()) {
      throw new ConflictException('Authoritative heartbeat does not report the target build');
    }
    const rows = await this.db.query(
      `UPDATE agent_update_requests SET status='completed',completed_at=now(),
       result=$4,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND agent_id=$3 RETURNING *`,
      [id,tenantId,dto.agentId,JSON.stringify(sanitizeMetadata(dto.result ?? {}))],
    );
    await this.db.query(
      `UPDATE sync_agents SET last_update_attempt_at=now(),last_update_status='completed',
       last_update_result=$3,updated_at=now() WHERE tenant_id=$1 AND agent_id=$2`,
      [tenantId,dto.agentId,JSON.stringify(sanitizeMetadata(dto.result ?? {}))],
    );
    await this.emit(tenantId,dto.agentId,'agent_update.completed','info','Update completed',rows[0]);
    return rows[0];
  }

  async fail(tenantId: string,id: string,dto: AgentUpdateResultDto) {
    this.requireFeature('SYNC_AGENT_UPDATE_ENABLED');
    const existing = await this.db.query(
      `SELECT * FROM agent_update_requests WHERE id=$1 AND tenant_id=$2 AND agent_id=$3`,
      [id,tenantId,dto.agentId],
    );
    if (existing[0]?.status === 'failed') return existing[0];
    const rows = await this.db.query(
      `UPDATE agent_update_requests SET status='failed',error_code=$4,error_message=$5,
       result=$6,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND agent_id=$3 RETURNING *`,
      [id,tenantId,dto.agentId,dto.errorCode ?? 'UPDATE_FAILED',dto.errorMessage ?? null,
        JSON.stringify(sanitizeMetadata(dto.result ?? {}))],
    );
    if (!rows[0]) throw new NotFoundException('Update request not found');
    await this.suppress(rows[0],dto.errorCode ?? 'UPDATE_FAILED',null);
    await this.db.query(
      `UPDATE sync_agents SET last_update_attempt_at=now(),last_update_status='failed',
       last_update_result=$3,updated_at=now() WHERE tenant_id=$1 AND agent_id=$2`,
      [tenantId,dto.agentId,JSON.stringify(sanitizeMetadata(dto.result ?? {}))],
    );
    await this.emit(tenantId,dto.agentId,'agent_update.failed','error',
      dto.errorMessage ?? 'Update failed',rows[0]);
    return rows[0];
  }

  async rollback(tenantId: string,id: string,dto: AgentUpdateResultDto) {
    this.requireFeature('SYNC_AGENT_UPDATE_ENABLED');
    const requestRows = await this.db.query(
      `SELECT * FROM agent_update_requests
       WHERE id=$1 AND tenant_id=$2 AND agent_id=$3`,
      [id,tenantId,dto.agentId],
    );
    const request = requestRows[0];
    if (!request) throw new NotFoundException('Update request not found');
    if (request.status === 'rolled_back' ||
      (request.status === 'failed' && request.error_code === 'ROLLBACK_FAILED')) return request;
    const rollbackFailed = dto.errorCode === 'ROLLBACK_FAILED';
    if (!rollbackFailed) {
      const recovered = await this.db.query(
        `SELECT 1 FROM sync_agents
         WHERE tenant_id=$1 AND agent_id=$2
           AND last_heartbeat_at>=now()-interval '120 seconds'
           AND service_version=$3
           AND lower(COALESCE(git_sha,''))=lower(COALESCE($4,''))
           AND backend_connection_status='connected'`,
        [tenantId,dto.agentId,request.current_version,request.current_git_sha],
      );
      if (!recovered[0]) {
        throw new ConflictException('Previous-version heartbeat has not verified rollback recovery');
      }
    }
    const rows = await this.db.query(
      `UPDATE agent_update_requests SET status=$4,
       rolled_back_at=CASE WHEN $4='rolled_back' THEN now() ELSE rolled_back_at END,
       error_code=$5,error_message=$6,result=$7,updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND agent_id=$3 RETURNING *`,
      [id,tenantId,dto.agentId,rollbackFailed ? 'failed' : 'rolled_back',
        dto.errorCode ?? 'HEALTH_VERIFICATION_FAILED',dto.errorMessage ?? null,
        JSON.stringify(sanitizeMetadata(dto.result ?? {}))],
    );
    await this.suppress(
      rows[0],dto.errorCode ?? 'HEALTH_VERIFICATION_FAILED',
      rollbackFailed ? 'failed' : 'completed',
    );
    await this.db.query(
      `UPDATE sync_agents SET last_update_attempt_at=now(),last_update_status=$3,
       last_rollback_result=$4,updated_at=now() WHERE tenant_id=$1 AND agent_id=$2`,
      [tenantId,dto.agentId,rollbackFailed ? 'failed' : 'rolled_back',
        JSON.stringify(sanitizeMetadata(dto.result ?? {}))],
    );
    await this.emit(tenantId,dto.agentId,
      rollbackFailed ? 'agent_update.rollback_failed' : 'agent_update.rollback_completed',
      rollbackFailed ? 'error' : 'warning',
      dto.errorMessage ?? 'Update rolled back',rows[0]);
    return rows[0];
  }

  private async suppress(request: Record<string,unknown>,category: string,rollbackResult: string|null) {
    await this.db.query(
      `INSERT INTO agent_bad_releases
       (tenant_id,agent_id,release_id,version,failure_category,rollback_result,suppressed_until)
       VALUES ($1,$2,$3,$4,$5,$6,now()+interval '24 hours')
       ON CONFLICT (tenant_id,agent_id,release_id) DO UPDATE SET
        failure_category=EXCLUDED.failure_category,
        attempt_count=agent_bad_releases.attempt_count+1,
        rollback_result=EXCLUDED.rollback_result,
        suppressed_until=CASE WHEN agent_bad_releases.attempt_count>=2 THEN NULL
          ELSE now()+interval '24 hours' END,
        permanently_blocked=agent_bad_releases.attempt_count>=2,
        last_failed_at=now(),updated_at=now()`,
      [request.tenant_id,request.agent_id,request.release_id,request.target_version,category,rollbackResult],
    );
  }

  async updateStatus(tenantId: string,agentId: string) {
    const [requests,agent,available] = await Promise.all([
      this.db.query(
        `SELECT u.*,r.release_notes,r.channel FROM agent_update_requests u
         JOIN agent_releases r ON r.id=u.release_id
         WHERE u.tenant_id=$1 AND u.agent_id=$2 ORDER BY u.requested_at DESC LIMIT 20`,
        [tenantId,agentId],
      ),
      this.db.query(`SELECT * FROM sync_agents WHERE tenant_id=$1 AND agent_id=$2`,[tenantId,agentId]),
      this.db.query(
        `SELECT id,version,git_sha,channel,release_notes,published_at FROM agent_releases
         WHERE status='published'
           AND NOT EXISTS (
             SELECT 1 FROM agent_bad_releases b
             WHERE b.tenant_id=$1 AND b.agent_id=$2 AND b.release_id=agent_releases.id
               AND (b.permanently_blocked=true OR b.suppressed_until>now())
           )
         ORDER BY published_at DESC LIMIT 1`,
        [tenantId,agentId],
      ),
    ]);
    if (!agent[0]) throw new NotFoundException('Sync agent not found');
    const compatible = available[0] &&
      this.compareVersions(available[0].version,agent[0].service_version || '0.0.0') > 0
      ? available[0]
      : null;
    return { agent: agent[0],current: requests[0] ?? null,history: requests,available: compatible };
  }

  async listRequests(tenantId?: string,id?: string) {
    const params: unknown[] = [];
    const where: string[] = [];
    if (tenantId) { params.push(tenantId); where.push(`u.tenant_id=$${params.length}`); }
    if (id) { params.push(id); where.push(`u.id=$${params.length}`); }
    const rows = await this.db.query(
      `SELECT u.*,r.channel,r.release_notes FROM agent_update_requests u
       JOIN agent_releases r ON r.id=u.release_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY u.requested_at DESC LIMIT 200`,params,
    );
    if (id && !rows[0]) throw new NotFoundException('Update request not found');
    return id ? rows[0] : rows;
  }

  async cancel(tenantId: string,id: string,userId: string) {
    const rows = await this.db.query(
      `UPDATE agent_update_requests SET status='cancelled',updated_at=now()
       WHERE id=$1 AND tenant_id=$2
         AND status IN ('requested','approved','claimed','downloading','verifying','staged','waiting_for_window')
       RETURNING *`,[id,tenantId],
    );
    if (!rows[0]) throw new ConflictException('Update cannot be cancelled in its current state');
    await this.audit.log({
      action: 'agent_update.cancelled',actorId: userId,tenantId,targetId: id,
      metadata: { agentId: rows[0].agent_id,targetVersion: rows[0].target_version },
    });
    return rows[0];
  }

  async packageFor(tenantId: string,releaseId: string,agentId: string) {
    this.requireFeature('SYNC_AGENT_UPDATE_ENABLED');
    const rows = await this.db.query(
      `SELECT r.* FROM agent_releases r
       WHERE r.id=$1 AND r.status='published'
         AND EXISTS (
           SELECT 1 FROM agent_update_requests u
           WHERE u.tenant_id=$2 AND u.agent_id=$3 AND u.release_id=r.id
             AND u.status=ANY($4::varchar[])
         )`,[releaseId,tenantId,agentId,ACTIVE_UPDATE_STATUSES],
    );
    if (!rows[0]) throw new ForbiddenException('No active approved update for this package');
    const release = rows[0] as ReleaseRow;
    const stats = await this.storage.stat(release.package_path);
    if (Number(release.package_size) !== stats.size) throw new ConflictException('Stored package size changed');
    return { release,stats,stream: this.storage.stream(release.package_path) };
  }

  async manifestFor(tenantId: string,releaseId: string,agentId: string) {
    const packaged = await this.packageFor(tenantId,releaseId,agentId);
    packaged.stream.destroy();
    return this.publicRelease(packaged.release);
  }

  private async emit(
    tenantId: string,agentId: string,eventType: string,
    severity: 'info'|'warning'|'error',message: string,
    request: Record<string,unknown>,actorUserId?: string,
  ) {
    void this.events.emit({
      tenantId,source: actorUserId ? 'admin' : 'windows-service',eventType,severity,
      status: String(request.status || ''),message,actorUserId,agentId,
      correlationId: request.correlation_id ? String(request.correlation_id) : undefined,
      serviceVersion: request.current_version ? String(request.current_version) : undefined,
      gitSha: request.current_git_sha ? String(request.current_git_sha) : undefined,
      eventKey: `${eventType}-${request.id}-${request.status}`,
      metadata: { updateRequestId: request.id,releaseId: request.release_id,
        targetVersion: request.target_version,targetGitSha: request.target_git_sha },
    });
  }
}
