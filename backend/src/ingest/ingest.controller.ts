import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Headers,
  Query,
  HttpCode,
  UnauthorizedException,
  BadRequestException,
  UsePipes,
  ValidationPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Throttle } from '@nestjs/throttler';
import { TenantConnection } from '../entities/tenant-connection.entity';
import { SyncTrigger } from '../entities/sync-trigger.entity';
import { IngestService } from './ingest.service';
import {
  IngestDto,
  EngineTriggerQueryDto,
  TriggerUpdateDto,
  VALID_SYNC_MODULES,
  VALID_TRIGGER_STATUS,
} from './dto/ingest.dto';
import { Public } from '../common/decorators/public.decorator';

@Public()
@Controller('sync')
@Throttle({ default: { limit: 240, ttl: 60_000 } })
export class IngestController {
  constructor(
    @InjectRepository(TenantConnection)
    private readonly connRepo: Repository<TenantConnection>,
    @InjectRepository(SyncTrigger)
    private readonly triggerRepo: Repository<SyncTrigger>,
    private readonly ingestService: IngestService,
  ) {}

  /** Validate sync API key and return the tenant connection */
  private async validateSyncKey(auth: string, tenantId?: string) {
    const apiKey = auth?.replace('Bearer ', '').trim();
    if (!apiKey) {
      throw new UnauthorizedException({ code: 'INVALID_SYNC_KEY', message: 'Missing API key' });
    }

    // Fast path: validate against provided tenant id if present.
    if (tenantId) {
      const tenantConn = await this.connRepo.findOne({
        where: { tenant_id: tenantId, is_active: true },
      });
      if (tenantConn) {
        const valid = await bcrypt.compare(apiKey, tenantConn.sync_api_key_hash);
        if (valid) return tenantConn;
      }
    }

    // Fallback path: validate by key prefix (helps when tenantId is stale/misconfigured
    // in the sync engine settings but key itself is correct).
    const keyPrefix = apiKey.slice(0, 8);
    if (keyPrefix.length === 8) {
      const candidates = await this.connRepo.find({
        where: { sync_api_key_prefix: keyPrefix, is_active: true },
      });
      for (const candidate of candidates) {
        const valid = await bcrypt.compare(apiKey, candidate.sync_api_key_hash);
        if (valid) return candidate;
      }
    }

    throw new UnauthorizedException({ code: 'INVALID_SYNC_KEY', message: 'Invalid API key or tenantId' });
  }

  @Post('ingest')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: false }))
  async ingest(
    @Body() body: IngestDto,
    @Headers('authorization') auth: string,
  ) {
    if (!VALID_SYNC_MODULES.includes(body?.module)) {
      throw new BadRequestException({
        code: 'INVALID_SYNC_MODULE',
        message: `Invalid module: ${body?.module}`,
      });
    }
    const conn = await this.validateSyncKey(auth, body.tenantId);
    body.tenantId = conn.tenant_id;

    // Update last ingest time
    conn.last_ingest_at = new Date();
    conn.last_ingest_module = body.module;
    await this.connRepo.save(conn);

    return this.ingestService.processIngest(body);
  }

  /**
   * Sync engine polls this to check for manual triggers.
   * Auth: sync API key (same as ingest).
   */
  @Get('engine/triggers')
  async getEngineTriggers(
    @Headers('authorization') auth: string,
    @Query() query: EngineTriggerQueryDto,
  ) {
    const conn = await this.validateSyncKey(auth, query.tenantId);
    const triggers = await this.triggerRepo.find({
      where: { tenant_id: conn.tenant_id, status: 'pending' },
      order: { created_at: 'ASC' },
    });
    return { data: triggers };
  }

  /**
   * Sync engine marks a trigger as picked/done/failed.
   */
  @Patch('engine/triggers/:id')
  @HttpCode(200)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: false }))
  async updateEngineTrigger(
    @Headers('authorization') auth: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: TriggerUpdateDto,
  ) {
    if (!VALID_TRIGGER_STATUS.includes(body?.status)) {
      throw new BadRequestException({
        code: 'INVALID_TRIGGER_STATUS',
        message: `Invalid trigger status: ${body?.status}`,
      });
    }
    const conn = await this.validateSyncKey(auth, body.tenantId);
    const trigger = await this.triggerRepo.findOne({
      where: { id, tenant_id: conn.tenant_id },
    });
    if (!trigger) return { message: 'Trigger not found' };

    trigger.status = body.status;
    if (body.resultMessage) trigger.result_message = body.resultMessage;
    if (body.status === 'picked') trigger.picked_at = new Date();
    if (body.status === 'done' || body.status === 'failed') trigger.completed_at = new Date();

    await this.triggerRepo.save(trigger);
    return { data: trigger };
  }
}
