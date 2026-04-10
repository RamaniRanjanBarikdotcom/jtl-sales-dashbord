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
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { TenantConnection } from '../entities/tenant-connection.entity';
import { SyncTrigger } from '../entities/sync-trigger.entity';
import { IngestService } from './ingest.service';

@Controller('sync')
export class IngestController {
  constructor(
    @InjectRepository(TenantConnection)
    private readonly connRepo: Repository<TenantConnection>,
    @InjectRepository(SyncTrigger)
    private readonly triggerRepo: Repository<SyncTrigger>,
    private readonly ingestService: IngestService,
  ) {}

  /** Validate sync API key and return the tenant connection */
  private async validateSyncKey(auth: string, tenantId: string) {
    const apiKey = auth?.replace('Bearer ', '').trim();
    if (!apiKey) {
      throw new UnauthorizedException({ code: 'INVALID_SYNC_KEY', message: 'Missing API key' });
    }
    if (!tenantId) {
      throw new UnauthorizedException({ code: 'INVALID_SYNC_KEY', message: 'Missing tenantId' });
    }
    const conn = await this.connRepo.findOne({
      where: { tenant_id: tenantId, is_active: true },
    });
    if (!conn) {
      throw new UnauthorizedException({ code: 'INVALID_SYNC_KEY', message: 'Tenant not found' });
    }
    const valid = await bcrypt.compare(apiKey, conn.sync_api_key_hash);
    if (!valid) {
      throw new UnauthorizedException({ code: 'INVALID_SYNC_KEY', message: 'Invalid API key' });
    }
    return conn;
  }

  @Post('ingest')
  @HttpCode(200)
  async ingest(
    @Body() body: any,
    @Headers('authorization') auth: string,
  ) {
    const conn = await this.validateSyncKey(auth, body.tenantId);

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
    @Query('tenantId') tenantId: string,
  ) {
    await this.validateSyncKey(auth, tenantId);
    const triggers = await this.triggerRepo.find({
      where: { tenant_id: tenantId, status: 'pending' },
      order: { created_at: 'ASC' },
    });
    return { data: triggers };
  }

  /**
   * Sync engine marks a trigger as picked/done/failed.
   */
  @Patch('engine/triggers/:id')
  @HttpCode(200)
  async updateEngineTrigger(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
    @Body() body: { tenantId: string; status: string; resultMessage?: string },
  ) {
    await this.validateSyncKey(auth, body.tenantId);
    const trigger = await this.triggerRepo.findOne({ where: { id } });
    if (!trigger) return { message: 'Trigger not found' };

    trigger.status = body.status;
    if (body.resultMessage) trigger.result_message = body.resultMessage;
    if (body.status === 'picked') trigger.picked_at = new Date();
    if (body.status === 'done' || body.status === 'failed') trigger.completed_at = new Date();

    await this.triggerRepo.save(trigger);
    return { data: trigger };
  }
}
