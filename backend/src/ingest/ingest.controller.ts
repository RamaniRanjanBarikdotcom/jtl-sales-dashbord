import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  BadRequestException,
  HttpStatus,
  NotFoundException,
  Res,
  ServiceUnavailableException,
  UsePipes,
  ValidationPipe,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Throttle } from '@nestjs/throttler';
import { TenantConnection } from '../entities/tenant-connection.entity';
import { SyncTrigger } from '../entities/sync-trigger.entity';
import { SyncEngineInstallation } from '../entities/sync-engine-installation.entity';
import { Public } from '../common/decorators/public.decorator';
import {
  IngestDto,
  EngineTriggerQueryDto,
  TriggerUpdateDto,
  VALID_SYNC_MODULES,
  VALID_TRIGGER_STATUS,
} from './dto/ingest.dto';
import { SyncApiKeyGuard } from '../common/guards/sync-api-key.guard';
import { SyncQueueService } from './sync-queue.service';

@Controller('sync')
@Public()
@UseGuards(SyncApiKeyGuard)
@Throttle({ default: { limit: 240, ttl: 60_000 } })
export class IngestController {
  constructor(
    @InjectRepository(TenantConnection)
    private readonly connRepo: Repository<TenantConnection>,
    @InjectRepository(SyncTrigger)
    private readonly triggerRepo: Repository<SyncTrigger>,
    @InjectRepository(SyncEngineInstallation)
    private readonly engineInstallationRepo: Repository<SyncEngineInstallation>,
    private readonly syncQueue: SyncQueueService,
  ) {}

  @Post('ingest')
  @HttpCode(HttpStatus.ACCEPTED)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: false }))
  async ingest(
    @Body() body: IngestDto,
    @Req() req: { syncConnection: TenantConnection },
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!VALID_SYNC_MODULES.includes(body?.module)) {
      throw new BadRequestException({
        code: 'INVALID_SYNC_MODULE',
        message: `Invalid module: ${body?.module}`,
      });
    }
    const conn = req.syncConnection;
    if (body.tenantId !== conn.tenant_id) {
      throw new BadRequestException({
        code: 'TENANT_ID_MISMATCH',
        message: 'tenantId must match the tenant assigned to the sync API key',
      });
    }
    body.tenantId = conn.tenant_id;

    conn.last_attempt_at = new Date();
    conn.last_attempt_module = body.module;
    await this.connRepo.save(conn);

    try {
      return await this.syncQueue.enqueue(body, conn);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) {
        res.setHeader('Retry-After', String(this.syncQueue.getRetryAfterSeconds()));
      }
      throw err;
    }
  }

  /**
   * Sync engine polls this to check for manual triggers.
   * Auth: sync API key (same as ingest).
   */
  @Get('engine/triggers')
  async getEngineTriggers(
    @Req() req: { syncConnection: TenantConnection },
    @Query() _query: EngineTriggerQueryDto,
  ) {
    const conn = req.syncConnection;
    await this.triggerRepo.query(
      `UPDATE sync_triggers
       SET status = 'expired', result_message = 'Sync trigger expired', updated_at = now()
       WHERE tenant_id = $1
         AND status = 'pending'
         AND expires_at IS NOT NULL
         AND expires_at < now()`,
      [conn.tenant_id],
    );
    const triggers = await this.triggerRepo.find({
      where: { tenant_id: conn.tenant_id, status: 'pending' },
      order: { priority: 'ASC', created_at: 'ASC' },
      take: 5,
    });
    return {
      triggers: triggers.map((trigger) => ({
        id: trigger.id,
        module: trigger.module,
        syncMode: trigger.sync_mode,
        status: trigger.status,
        createdAt: trigger.created_at,
      })),
      data: triggers,
    };
  }

  @Post('engine/heartbeat')
  @HttpCode(200)
  async heartbeat(
    @Req() req: { syncConnection: TenantConnection; ip?: string; headers?: Record<string, unknown> },
    @Body() body: {
      machineId?: string;
      machineName?: string;
      engineVersion?: string;
      osVersion?: string;
      status?: string;
    },
  ) {
    const forwardedFor = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    if (!body.machineId) {
      throw new BadRequestException({ code: 'MACHINE_ID_REQUIRED', message: 'machineId is required' });
    }
    await this.engineInstallationRepo.query(
      `INSERT INTO sync_engine_installations (
         tenant_id, machine_id, machine_name, engine_version, os_version,
         last_seen_at, last_ip, status, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, now(), NULLIF($6, '')::inet, $7, now())
       ON CONFLICT (tenant_id, machine_id)
       DO UPDATE SET
         machine_name = EXCLUDED.machine_name,
         engine_version = EXCLUDED.engine_version,
         os_version = EXCLUDED.os_version,
         last_seen_at = now(),
         last_ip = EXCLUDED.last_ip,
         status = EXCLUDED.status,
         updated_at = now()`,
      [
        req.syncConnection.tenant_id,
        body.machineId,
        body.machineName || null,
        body.engineVersion || null,
        body.osVersion || null,
        forwardedFor || req.ip || '',
        ['online', 'offline', 'running', 'idle', 'unknown'].includes(String(body.status || 'idle'))
          ? String(body.status || 'idle')
          : 'idle',
      ],
    );
    const pendingTriggers = await this.triggerRepo.count({
      where: { tenant_id: req.syncConnection.tenant_id, status: 'pending' },
    });
    return { ok: true, serverTime: new Date().toISOString(), pendingTriggerCount: pendingTriggers, pendingTriggers };
  }

  /**
   * Sync engine atomically claims a pending trigger.
   */
  @Post('engine/triggers/:id/claim')
  @HttpCode(200)
  async claimEngineTrigger(
    @Req() req: { syncConnection: TenantConnection },
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { machineId?: string },
  ) {
    const machineId = String(body.machineId || '').trim();
    if (!machineId) {
      throw new BadRequestException({ code: 'MACHINE_ID_REQUIRED', message: 'machineId is required' });
    }
    const rows = await this.triggerRepo.query(
      `UPDATE sync_triggers
       SET status = 'picked',
           picked_at = now(),
           engine_id = $3,
           result_message = 'Picked by sync engine',
           updated_at = now()
       WHERE id = $1
         AND tenant_id = $2
         AND status = 'pending'
         AND (expires_at IS NULL OR expires_at > now())
       RETURNING *`,
      [id, req.syncConnection.tenant_id, machineId],
    );
    const trigger = rows?.[0];
    if (!trigger) {
      return { claimed: false, reason: 'Trigger is already claimed or no longer pending' };
    }
    return {
      claimed: true,
      trigger: {
        id: trigger.id,
        module: trigger.module,
        syncMode: trigger.sync_mode,
        status: trigger.status,
      },
    };
  }

  /**
   * Sync engine reports running/completed/failed progress for a claimed trigger.
   */
  @Patch('engine/triggers/:id/status')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: false }))
  async updateEngineTrigger(
    @Req() req: { syncConnection: TenantConnection },
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: TriggerUpdateDto,
  ) {
    if (!VALID_TRIGGER_STATUS.includes(body?.status)) {
      throw new BadRequestException({
        code: 'INVALID_TRIGGER_STATUS',
        message: `Invalid trigger status: ${body?.status}`,
      });
    }
    const conn = req.syncConnection;
    const trigger = await this.triggerRepo.findOne({
      where: { id, tenant_id: conn.tenant_id },
    });
    if (!trigger) throw new NotFoundException('Trigger not found');
    if (!trigger.engine_id) {
      throw new BadRequestException('Trigger has not been claimed');
    }
    if (!['picked', 'running'].includes(trigger.status)) {
      throw new BadRequestException(`Cannot update trigger in status ${trigger.status}`);
    }

    trigger.status = body.status;
    const resultMessage = body.resultMessage || body.message;
    if (resultMessage) trigger.result_message = resultMessage;
    if (typeof body.progressPercent === 'number') trigger.progress_percent = body.progressPercent;
    if (typeof body.currentBatch === 'number') trigger.current_batch = body.currentBatch;
    if (typeof body.totalBatches === 'number') trigger.total_batches = body.totalBatches;
    if (typeof body.rowsSynced === 'number') trigger.rows_synced = body.rowsSynced;
    if (body.status === 'running') {
      trigger.started_at = trigger.started_at || new Date();
    }
    if (body.status === 'completed') {
      trigger.completed_at = new Date();
      trigger.progress_percent = 100;
    }
    if (body.status === 'failed') {
      trigger.failed_at = new Date();
      trigger.error_message = body.errorMessage || body.resultMessage || body.message || 'Sync failed';
    }

    await this.triggerRepo.save(trigger);
    return { data: trigger };
  }

  /**
   * Backward-compatible legacy endpoint used by older engines.
   */
  @Patch('engine/triggers/:id')
  @HttpCode(200)
  async updateLegacyEngineTrigger(
    @Req() req: { syncConnection: TenantConnection },
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { status?: string; resultMessage?: string },
  ) {
    const mappedStatus = body.status === 'done' ? 'completed' : body.status;
    if (mappedStatus === 'picked') {
      const trigger = await this.triggerRepo.findOne({
        where: { id, tenant_id: req.syncConnection.tenant_id },
      });
      if (!trigger) throw new NotFoundException('Trigger not found');
      trigger.status = 'picked';
      trigger.picked_at = new Date();
      trigger.engine_id = trigger.engine_id || 'legacy-engine';
      await this.triggerRepo.save(trigger);
      return { data: trigger };
    }
    return this.updateEngineTrigger(req, id, {
      status: mappedStatus as 'running' | 'completed' | 'failed',
      resultMessage: body.resultMessage,
    });
  }
}
