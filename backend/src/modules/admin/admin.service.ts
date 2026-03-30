import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../../entities/user.entity';
import { Tenant } from '../../entities/tenant.entity';
import { TenantConnection } from '../../entities/tenant-connection.entity';
import { SyncLog } from '../../entities/sync-log.entity';
import { SyncWatermark } from '../../entities/sync-watermark.entity';
import { CacheService } from '../../cache/cache.service';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Tenant) private tenantRepo: Repository<Tenant>,
    @InjectRepository(TenantConnection)
    private connRepo: Repository<TenantConnection>,
    @InjectRepository(SyncLog) private syncLogRepo: Repository<SyncLog>,
    @InjectRepository(SyncWatermark)
    private watermarkRepo: Repository<SyncWatermark>,
    private readonly cache: CacheService,
  ) {}

  // ── Users ──────────────────────────────────────────────────────────────────

  async getUsers(
    callerRole: string,
    callerTenantId: string,
    queryTenantId?: string,
  ) {
    const tenantId =
      callerRole === 'super_admin'
        ? queryTenantId || undefined
        : callerTenantId;
    const where = tenantId ? { tenant_id: tenantId } : {};
    const users = await this.userRepo.find({
      where,
      order: { created_at: 'DESC' },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      full_name: u.full_name,
      role: u.role,
      user_level: u.user_level,
      dept: u.dept,
      is_active: u.is_active,
      must_change_pwd: u.must_change_pwd,
      last_login_at: u.last_login_at,
      created_at: u.created_at,
    }));
  }

  async createUser(
    callerRole: string,
    callerTenantId: string,
    body: any,
  ) {
    if (callerRole === 'admin' && body.role && body.role !== 'user') {
      throw new ForbiddenException('Admins can only create user-role accounts');
    }
    const hash = await bcrypt.hash(body.password || 'Welcome@123', 12);
    const user = await this.userRepo.save({
      tenant_id:
        callerRole === 'super_admin'
          ? body.tenantId || callerTenantId
          : callerTenantId,
      email: body.email,
      password_hash: hash,
      full_name: body.full_name,
      role: body.role || 'user',
      user_level: body.user_level || 'viewer',
      dept: body.dept || null,
      must_change_pwd: true,
    });
    return { id: user.id, email: user.email, full_name: user.full_name };
  }

  async updateUser(
    id: string,
    callerRole: string,
    callerTenantId: string,
    body: any,
  ) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (callerRole === 'admin' && user.tenant_id !== callerTenantId) {
      throw new ForbiddenException();
    }
    Object.assign(user, {
      full_name: body.full_name ?? user.full_name,
      user_level: body.user_level ?? user.user_level,
      dept: body.dept ?? user.dept,
      is_active: body.is_active ?? user.is_active,
    });
    const saved = await this.userRepo.save(user);
    return {
      id: saved.id,
      email: saved.email,
      full_name: saved.full_name,
      user_level: saved.user_level,
      dept: saved.dept,
      is_active: saved.is_active,
    };
  }

  async deactivateUser(
    id: string,
    callerRole: string,
    callerTenantId: string,
  ) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (callerRole === 'admin' && user.tenant_id !== callerTenantId) {
      throw new ForbiddenException();
    }
    user.is_active = false;
    return this.userRepo.save(user);
  }

  async resetPassword(
    id: string,
    callerRole: string,
    callerTenantId: string,
  ) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException();
    if (callerRole === 'admin' && user.tenant_id !== callerTenantId) {
      throw new ForbiddenException();
    }
    user.must_change_pwd = true;
    user.password_hash = await bcrypt.hash('Welcome@123', 12);
    await this.userRepo.save(user);
    return { ok: true, temp_password: 'Welcome@123' };
  }

  // ── Tenants (super_admin only) ─────────────────────────────────────────────

  async getTenants() {
    return this.tenantRepo.find({ order: { created_at: 'DESC' } });
  }

  async createTenant(body: any, createdBy: string) {
    const tenant = await this.tenantRepo.save({
      name: body.name,
      slug: body.slug,
      timezone: body.timezone || 'Europe/Berlin',
      currency: body.currency || 'EUR',
      vat_rate: body.vat_rate || 0.19,
      created_by: createdBy,
    });

    // Generate sync API key
    const rawKey =
      uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
    const keyHash = await bcrypt.hash(rawKey, 10);
    await this.connRepo.save({
      tenant_id: tenant.id,
      sync_api_key_hash: keyHash,
      sync_api_key_prefix: rawKey.slice(0, 8),
      sync_api_key_last_rotated: new Date(),
    });

    // Create first admin user
    const adminHash = await bcrypt.hash(
      body.admin_password || 'Welcome@123',
      12,
    );
    const adminUser = await this.userRepo.save({
      tenant_id: tenant.id,
      email: body.admin_email,
      password_hash: adminHash,
      full_name: body.admin_name || 'Admin',
      role: 'admin',
      must_change_pwd: true,
      created_by: createdBy,
    });

    return {
      tenant,
      admin_user_id: adminUser.id,
      sync_api_key: rawKey,
    };
  }

  async updateTenant(id: string, body: any) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException();
    const allowedFields = [
      'name',
      'slug',
      'timezone',
      'currency',
      'vat_rate',
      'is_active',
    ];
    for (const f of allowedFields) {
      if (body[f] !== undefined) (tenant as any)[f] = body[f];
    }
    return this.tenantRepo.save(tenant);
  }

  async deactivateTenant(id: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException();
    tenant.is_active = false;
    return this.tenantRepo.save(tenant);
  }

  async rotateSyncKey(tenantId: string) {
    const conn = await this.connRepo.findOne({
      where: { tenant_id: tenantId },
    });
    if (!conn) throw new NotFoundException();

    const rawKey =
      uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
    conn.sync_api_key_hash = await bcrypt.hash(rawKey, 10);
    conn.sync_api_key_prefix = rawKey.slice(0, 8);
    conn.sync_api_key_last_rotated = new Date();
    await this.connRepo.save(conn);

    // Invalidate all cached data for this tenant
    await this.cache.del(`jtl:${tenantId}:*`);

    return { sync_api_key: rawKey };
  }

  async getPlatformOverview() {
    const tenantCount = await this.tenantRepo.count();
    const activeCount = await this.tenantRepo.count({
      where: { is_active: true },
    });
    const userCount = await this.userRepo.count();
    const recentLogs = await this.syncLogRepo.find({
      order: { started_at: 'DESC' },
      take: 10,
    });
    return {
      tenant_count: tenantCount,
      active_tenant_count: activeCount,
      user_count: userCount,
      recent_sync_logs: recentLogs,
    };
  }

  async getSyncStatus(tenantId: string) {
    const logs = await this.syncLogRepo.find({
      where: { tenant_id: tenantId },
      order: { started_at: 'DESC' },
      take: 20,
    });
    const watermarks = await this.watermarkRepo.find({
      where: { tenant_id: tenantId },
    });
    const conn = await this.connRepo.findOne({
      where: { tenant_id: tenantId },
    });
    return {
      logs,
      watermarks,
      last_ingest_at: conn?.last_ingest_at,
      last_ingest_module: conn?.last_ingest_module,
      sync_key_prefix: conn?.sync_api_key_prefix,
    };
  }

  async getSyncLogs(tenantId: string, page = 1, limit = 20) {
    const take = Math.min(limit, 100);
    const skip = (page - 1) * take;
    const [logs, total] = await this.syncLogRepo.findAndCount({
      where: { tenant_id: tenantId },
      order: { started_at: 'DESC' },
      take,
      skip,
    });
    return { logs, total, page, limit: take };
  }
}
