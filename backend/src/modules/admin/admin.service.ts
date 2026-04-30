import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes, randomInt } from 'crypto';
import { User } from '../../entities/user.entity';
import { Tenant } from '../../entities/tenant.entity';
import { TenantConnection } from '../../entities/tenant-connection.entity';
import { SyncLog } from '../../entities/sync-log.entity';
import { SyncWatermark } from '../../entities/sync-watermark.entity';
import { SyncTrigger } from '../../entities/sync-trigger.entity';
import { CacheService } from '../../cache/cache.service';
import { AuditService } from '../../common/audit/audit.service';
import { buildPaginatedResult } from '../../common/utils/pagination';
import { PermissionsService } from '../../common/permissions/permissions.service';
import { DEFAULT_ADMIN_PERMISSIONS } from '../../common/permissions/permission-keys';

interface UserMutationBody {
  tenantId?: string;
  password?: string;
  email?: string;
  full_name?: string;
  role?: string;
  user_level?: string;
  dept?: string | null;
  is_active?: boolean;
}

interface TenantMutationBody {
  name?: string;
  slug?: string;
  timezone?: string;
  currency?: string;
  vat_rate?: number;
  is_active?: boolean;
  admin_password?: string;
  admin_email?: string;
  admin_name?: string;
}

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
    @InjectRepository(SyncTrigger)
    private triggerRepo: Repository<SyncTrigger>,
    private readonly cache: CacheService,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly permissionsService: PermissionsService,
  ) {}

  private generateTempPassword(length = 18): string {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const nums = '23456789';
    const special = '!@#$%^&*';
    const all = upper + lower + nums + special;

    // Ensure at least one char from each class.
    const seed = [
      upper[randomInt(upper.length)],
      lower[randomInt(lower.length)],
      nums[randomInt(nums.length)],
      special[randomInt(special.length)],
    ];

    const bytes = randomBytes(Math.max(0, length - seed.length));
    for (let i = 0; i < bytes.length; i++) {
      seed.push(all[bytes[i] % all.length]);
    }
    // Fisher-Yates shuffle using crypto randomInt.
    for (let i = seed.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [seed[i], seed[j]] = [seed[j], seed[i]];
    }
    return seed.join('');
  }

  // ── Users ──────────────────────────────────────────────────────────────────

  async getUsers(
    callerRole: string,
    callerTenantId: string,
    queryTenantId?: string,
    page = 1,
    limit = 100,
  ) {
    const tenantId =
      callerRole === 'super_admin'
        ? queryTenantId || callerTenantId || undefined
        : callerTenantId;
    const where = tenantId ? { tenant_id: tenantId } : {};
    const take = Math.min(Math.max(limit, 1), 500);
    const skip = (Math.max(page, 1) - 1) * take;
    const [users, total] = await this.userRepo.findAndCount({
      where,
      order: { created_at: 'DESC' },
      take,
      skip,
    });
    const rows = users.map((u) => ({
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
    return buildPaginatedResult(rows, total, page, take);
  }

  async createUser(
    callerId: string,
    callerRole: string,
    callerTenantId: string,
    body: UserMutationBody,
  ) {
    if (callerRole === 'admin' && body.role && body.role !== 'user') {
      throw new ForbiddenException('Admins can only create user-role accounts');
    }
    const tenantId =
      callerRole === 'super_admin'
        ? body.tenantId || callerTenantId
        : callerTenantId;
    if (!tenantId) {
      throw new ForbiddenException('Tenant scope required');
    }
    if (!body.email || typeof body.email !== 'string') {
      throw new BadRequestException('email is required');
    }
    if (!body.full_name || typeof body.full_name !== 'string') {
      throw new BadRequestException('full_name is required');
    }

    const tempPassword = body.password || this.generateTempPassword();
    const hash = await bcrypt.hash(tempPassword, 12);
    const user = await this.userRepo.save({
      tenant_id: tenantId,
      email: body.email,
      password_hash: hash,
      full_name: body.full_name,
      role: body.role || 'user',
      user_level: body.user_level || 'viewer',
      dept: body.dept || (null as any),
      must_change_pwd: true,
      created_by: callerId || null,
    } as any) as User;

    const defaultPerms =
      user.role === 'admin'
        ? DEFAULT_ADMIN_PERMISSIONS
        : [];
    if (defaultPerms.length > 0) {
      await this.permissionsService.setUserPermissions(
        callerId,
        user.id,
        defaultPerms,
        callerRole === 'super_admin',
      );
    }

    await this.audit.log({
      action: 'admin.user.create',
      tenantId,
      actorId: callerId,
      targetId: user.id,
      metadata: { role: user.role, userLevel: user.user_level, email: user.email },
    });
    return {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      temp_password: tempPassword,
    };
  }

  async updateUser(
    id: string,
    callerRole: string,
    callerTenantId: string,
    body: UserMutationBody,
  ) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (
      (callerRole === 'admin' || callerRole === 'super_admin') &&
      callerTenantId &&
      user.tenant_id !== callerTenantId
    ) {
      throw new ForbiddenException();
    }
    Object.assign(user, {
      full_name: body.full_name ?? user.full_name,
      user_level: body.user_level ?? user.user_level,
      dept: body.dept ?? user.dept,
      is_active: body.is_active ?? user.is_active,
    });
    const saved = await this.userRepo.save(user);
    await this.audit.log({
      action: 'admin.user.update',
      tenantId: saved.tenant_id,
      actorId: callerRole,
      targetId: saved.id,
      metadata: {
        userLevel: saved.user_level,
        dept: saved.dept,
        isActive: saved.is_active,
      },
    });
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
    if (
      (callerRole === 'admin' || callerRole === 'super_admin') &&
      callerTenantId &&
      user.tenant_id !== callerTenantId
    ) {
      throw new ForbiddenException();
    }
    user.is_active = false;
    const saved = await this.userRepo.save(user);
    await this.audit.log({
      action: 'admin.user.deactivate',
      tenantId: saved.tenant_id,
      actorId: callerRole,
      targetId: saved.id,
      metadata: { email: saved.email },
    });
    return saved;
  }

  async resetPassword(
    id: string,
    callerRole: string,
    callerTenantId: string,
  ) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException();
    if (
      (callerRole === 'admin' || callerRole === 'super_admin') &&
      callerTenantId &&
      user.tenant_id !== callerTenantId
    ) {
      throw new ForbiddenException();
    }
    user.must_change_pwd = true;
    const tempPassword = this.generateTempPassword();
    user.password_hash = await bcrypt.hash(tempPassword, 12);
    await this.userRepo.save(user);
    await this.audit.log({
      action: 'admin.user.reset_password',
      tenantId: user.tenant_id,
      actorId: callerRole,
      targetId: user.id,
      metadata: { email: user.email },
    });
    return { ok: true, temp_password: tempPassword };
  }

  // ── Tenants (super_admin only) ─────────────────────────────────────────────

  async getTenants(page = 1, limit = 100) {
    const take = Math.min(Math.max(limit, 1), 500);
    const skip = (Math.max(page, 1) - 1) * take;
    const [tenants, total] = await this.tenantRepo.findAndCount({
      order: { created_at: 'DESC' },
      take,
      skip,
    });
    const tenantIds = tenants.map((t) => t.id);
    const [connections, userCounts] = await Promise.all([
      this.connRepo.find(),
      tenantIds.length > 0
        ? this.dataSource.query<{ tenant_id: string; cnt: string }[]>(
            `SELECT tenant_id, COUNT(*)::int AS cnt FROM users WHERE tenant_id = ANY($1) GROUP BY tenant_id`,
            [tenantIds],
          )
        : Promise.resolve([] as { tenant_id: string; cnt: string }[]),
    ]);
    const connMap = new Map(connections.map((c) => [c.tenant_id, c]));
    const countMap = new Map(userCounts.map((r) => [r.tenant_id, Number(r.cnt)]));
    const rows = tenants.map((t) => ({
        ...t,
        sync_key_prefix: connMap.get(t.id)?.sync_api_key_prefix ?? null,
        last_sync: connMap.get(t.id)?.last_ingest_at ?? null,
        user_count: countMap.get(t.id) ?? 0,
      }));
    return buildPaginatedResult(rows, total, page, take);
  }

  async createTenant(body: TenantMutationBody, createdBy: string) {
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
    const adminTempPassword = body.admin_password || this.generateTempPassword();
    const adminHash = await bcrypt.hash(adminTempPassword, 12);
    const adminUser = await this.userRepo.save({
      tenant_id: tenant.id,
      email: body.admin_email,
      password_hash: adminHash,
      full_name: body.admin_name || 'Admin',
      role: 'admin',
      must_change_pwd: true,
      created_by: createdBy,
    });
    await this.permissionsService.setUserPermissions(
      createdBy,
      adminUser.id,
      DEFAULT_ADMIN_PERMISSIONS,
      true,
    );
    await this.audit.log({
      action: 'admin.tenant.create',
      tenantId: tenant.id,
      actorId: createdBy,
      targetId: tenant.id,
      metadata: { slug: tenant.slug, adminEmail: adminUser.email },
    });

    return {
      tenant,
      admin_user_id: adminUser.id,
      sync_api_key: rawKey,
      admin_temp_password: adminTempPassword,
    };
  }

  async updateTenant(id: string, body: TenantMutationBody) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException();
    const allowedFields = [
      'name',
      'slug',
      'timezone',
      'currency',
      'vat_rate',
      'is_active',
    ] as const;
    const updates: Partial<Tenant> = {};
    for (const f of allowedFields) {
      if (body[f] !== undefined) {
        (updates as Record<string, unknown>)[f] = body[f];
      }
    }
    Object.assign(tenant, updates);
    const saved = await this.tenantRepo.save(tenant);
    await this.audit.log({
      action: 'admin.tenant.update',
      tenantId: saved.id,
      targetId: saved.id,
      metadata: { isActive: saved.is_active, slug: saved.slug },
    });
    return saved;
  }

  async deactivateTenant(id: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException();
    tenant.is_active = false;
    const saved = await this.tenantRepo.save(tenant);
    await this.audit.log({
      action: 'admin.tenant.deactivate',
      tenantId: saved.id,
      targetId: saved.id,
      metadata: { slug: saved.slug },
    });
    return saved;
  }

  async rotateSyncKey(tenantId: string) {
    const rawKey =
      uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
    const keyHash = await bcrypt.hash(rawKey, 10);

    await this.dataSource.transaction(async (manager) => {
      const conn = await manager
        .getRepository(TenantConnection)
        .createQueryBuilder('conn')
        .setLock('pessimistic_write')
        .where('conn.tenant_id = :tenantId', { tenantId })
        .getOne();
      if (!conn) throw new NotFoundException();

      conn.sync_api_key_hash = keyHash;
      conn.sync_api_key_prefix = rawKey.slice(0, 8);
      conn.sync_api_key_last_rotated = new Date();
      await manager.getRepository(TenantConnection).save(conn);
    });

    // Invalidate all cached data for this tenant
    await this.cache.del(`jtl:${tenantId}:*`);
    await this.audit.log({
      action: 'admin.sync.rotate_key',
      tenantId,
      targetId: tenantId,
    });

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
    const paged = buildPaginatedResult(logs, total, page, take);
    return {
      ...paged,
      logs: paged.rows,
    };
  }

  async createSyncTrigger(tenantId: string, module: string, triggeredBy: string) {
    // Prevent duplicate pending triggers for the same module
    const existing = await this.triggerRepo.findOne({
      where: { tenant_id: tenantId, module, status: 'pending' },
    });
    if (existing) {
      return { message: `${module} sync already queued`, trigger: existing };
    }

    const trigger = await this.triggerRepo.save({
      tenant_id: tenantId,
      module,
      status: 'pending',
      triggered_by: triggeredBy,
    });
    await this.audit.log({
      action: 'admin.sync.trigger',
      tenantId,
      actorId: triggeredBy,
      targetId: trigger.id,
      metadata: { module, status: trigger.status },
    });
    return { message: `${module} sync triggered`, trigger };
  }

  async getPendingTriggers(tenantId: string) {
    const triggers = await this.triggerRepo.find({
      where: { tenant_id: tenantId, status: 'pending' },
      order: { created_at: 'ASC' },
    });
    return { triggers };
  }

  async getAuditLogs(limit?: number) {
    const events = await this.audit.getRecentLogs(limit ?? 200);
    return { data: events, count: events.length };
  }

  async getPermissionCatalog() {
    return this.permissionsService.getCatalog();
  }

  async getUserPermissions(
    callerRole: string,
    callerTenantId: string,
    userId: string,
  ) {
    const target = await this.userRepo.findOne({
      where: { id: userId },
      select: { id: true, tenant_id: true },
    });
    if (!target) throw new NotFoundException('User not found');
    if (callerRole === 'admin' && target.tenant_id !== callerTenantId) {
      throw new ForbiddenException('Cross-tenant permission access denied');
    }
    return this.permissionsService.getUserPermissionBundle(userId);
  }

  async setUserPermissions(
    callerId: string,
    callerRole: string,
    callerTenantId: string,
    userId: string,
    permissions: string[],
  ) {
    const target = await this.userRepo.findOne({
      where: { id: userId },
      select: { id: true, tenant_id: true },
    });
    if (!target) throw new NotFoundException('User not found');
    if (callerRole === 'admin' && target.tenant_id !== callerTenantId) {
      throw new ForbiddenException('Cross-tenant permission update denied');
    }

    const updated = await this.permissionsService.setUserPermissions(
      callerId,
      userId,
      permissions,
      callerRole === 'super_admin',
    );
    await this.audit.log({
      action: 'admin.permissions.set',
      tenantId: target.tenant_id,
      actorId: callerId,
      targetId: userId,
      metadata: { permissions: updated.direct_permissions },
    });
    return updated;
  }
}
