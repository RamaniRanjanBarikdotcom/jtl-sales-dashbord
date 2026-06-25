import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { TenantConnection } from '../../entities/tenant-connection.entity';
import { Tenant } from '../../entities/tenant.entity';

type SyncRequest = {
  headers: Record<string, string | string[] | undefined>;
  body?: { tenantId?: string };
  query?: { tenantId?: string };
  syncTenantId?: string;
  syncConnection?: TenantConnection;
};

@Injectable()
export class SyncApiKeyGuard implements CanActivate {
  constructor(
    @InjectRepository(TenantConnection)
    private readonly connRepo: Repository<TenantConnection>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<SyncRequest>();
    const auth = String(req.headers.authorization || '');
    const apiKey = auth.replace(/^Bearer\s+/i, '').trim();
    if (!apiKey) {
      throw new UnauthorizedException({
        code: 'INVALID_SYNC_KEY',
        message: 'Missing API key',
      });
    }

    const requestedTenantId = req.body?.tenantId || req.query?.tenantId;
    const connection = await this.findValidConnection(apiKey, requestedTenantId);
    if (!connection) {
      throw new UnauthorizedException({
        code: 'INVALID_SYNC_KEY',
        message: 'Invalid API key or tenantId',
      });
    }

    const tenant = await this.tenantRepo.findOne({
      where: { id: connection.tenant_id, is_active: true },
      select: { id: true, is_active: true },
    });
    if (!tenant) {
      throw new UnauthorizedException({
        code: 'TENANT_INACTIVE',
        message: 'Tenant is inactive',
      });
    }

    req.syncTenantId = connection.tenant_id;
    req.syncConnection = connection;
    return true;
  }

  private async findValidConnection(apiKey: string, tenantId?: string) {
    if (tenantId) {
      const tenantConn = await this.connRepo.findOne({
        where: { tenant_id: tenantId, is_active: true },
      });
      if (tenantConn && await bcrypt.compare(apiKey, tenantConn.sync_api_key_hash)) {
        return tenantConn;
      }
    }

    const keyPrefix = apiKey.slice(0, 8);
    if (keyPrefix.length !== 8) return null;

    const candidates = await this.connRepo.find({
      where: { sync_api_key_prefix: keyPrefix, is_active: true },
    });
    for (const candidate of candidates) {
      if (await bcrypt.compare(apiKey, candidate.sync_api_key_hash)) {
        return candidate;
      }
    }
    return null;
  }
}
