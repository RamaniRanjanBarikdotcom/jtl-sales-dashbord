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

    const requestedTenantId = this.getRequestedTenantId(req);
    if (!requestedTenantId) {
      throw new UnauthorizedException({
        code: 'TENANT_ID_REQUIRED',
        message: 'tenantId is required with sync API key',
      });
    }
    if (!this.isUuid(requestedTenantId)) {
      throw new UnauthorizedException({
        code: 'INVALID_TENANT_ID',
        message: 'tenantId must be a UUID',
      });
    }
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

  private getRequestedTenantId(req: SyncRequest): string | undefined {
    const headerValue = req.headers['x-tenant-id'];
    const headerTenantId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    return req.body?.tenantId || req.query?.tenantId || headerTenantId;
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private async findValidConnection(apiKey: string, tenantId?: string) {
    if (!tenantId) return null;
    const tenantConn = await this.connRepo.findOne({
      where: { tenant_id: tenantId, is_active: true },
    });
    if (tenantConn && await bcrypt.compare(apiKey, tenantConn.sync_api_key_hash)) {
      return tenantConn;
    }
    return null;
  }
}
