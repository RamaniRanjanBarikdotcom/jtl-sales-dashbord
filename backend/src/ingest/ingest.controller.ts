import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { TenantConnection } from '../entities/tenant-connection.entity';
import { IngestService } from './ingest.service';

@Controller('sync')
export class IngestController {
  constructor(
    @InjectRepository(TenantConnection)
    private readonly connRepo: Repository<TenantConnection>,
    private readonly ingestService: IngestService,
  ) {}

  @Post('ingest')
  @HttpCode(200)
  async ingest(
    @Body() body: any,
    @Headers('authorization') auth: string,
  ) {
    const apiKey = auth?.replace('Bearer ', '').trim();
    if (!apiKey) {
      throw new UnauthorizedException({
        code: 'INVALID_SYNC_KEY',
        message: 'Missing API key',
      });
    }

    if (!body.tenantId) {
      throw new UnauthorizedException({
        code: 'INVALID_SYNC_KEY',
        message: 'Missing tenantId in body',
      });
    }

    const conn = await this.connRepo.findOne({
      where: { tenant_id: body.tenantId, is_active: true },
    });
    if (!conn) {
      throw new UnauthorizedException({
        code: 'INVALID_SYNC_KEY',
        message: 'Tenant not found',
      });
    }

    const valid = await bcrypt.compare(apiKey, conn.sync_api_key_hash);
    if (!valid) {
      throw new UnauthorizedException({
        code: 'INVALID_SYNC_KEY',
        message: 'Invalid API key',
      });
    }

    // Update last ingest time
    conn.last_ingest_at = new Date();
    conn.last_ingest_module = body.module;
    await this.connRepo.save(conn);

    return this.ingestService.processIngest(body);
  }
}
