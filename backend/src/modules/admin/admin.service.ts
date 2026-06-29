import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
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
import { UserTenantMembership } from '../../entities/user-tenant-membership.entity';
import { MembershipPermission } from '../../entities/membership-permission.entity';
import { SyncEngineInstallation } from '../../entities/sync-engine-installation.entity';
import { CacheService } from '../../cache/cache.service';
import { AuditService } from '../../common/audit/audit.service';
import { buildPaginatedResult } from '../../common/utils/pagination';
import { PermissionsService } from '../../common/permissions/permissions.service';
import { DEFAULT_ADMIN_PERMISSIONS } from '../../common/permissions/permission-keys';
import { MailService } from '../mail/mail.service';

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

const DEFAULT_COMPANY_SETTINGS = {
  data_freshness_threshold_minutes: 60,
  default_dashboard_range: '30D',
  alert_recipients: [],
};

const DEFAULT_SYNC_CONFIG = {
  sync_schedule: 'manual',
  modules: {
    orders: true,
    products: true,
    customers: true,
    inventory: true,
  },
};

const DEFAULT_PLATFORM_SETTINGS = {
  feature_flags: {
    marketing: false,
    sales_export: false,
  },
  tenant_defaults: {
    timezone: 'Europe/Berlin',
    currency: 'EUR',
    vat_rate: 0.19,
  },
  security_policy: {
    password_min_length: 8,
    company_selection_token_minutes: 5,
  },
  audit_retention_days: 365,
  sync_freshness_default_minutes: 60,
  maintenance_mode: false,
};

const ACTIVE_TRIGGER_STATUSES = ['pending', 'picked', 'running'] as const;
const ACTIVE_TRIGGER_STATUS_SET = new Set<string>(ACTIVE_TRIGGER_STATUSES);
const SYNC_ALL_MODULES = ['products', 'customers', 'orders', 'inventory'];
const ALLOWED_SYNC_MODULES = [...SYNC_ALL_MODULES, 'all'];
type SyncMode = 'incremental' | 'full';

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
    @InjectRepository(UserTenantMembership)
    private membershipRepo: Repository<UserTenantMembership>,
    @InjectRepository(MembershipPermission)
    private membershipPermissionRepo: Repository<MembershipPermission>,
    @InjectRepository(SyncEngineInstallation)
    private engineInstallationRepo: Repository<SyncEngineInstallation>,
    private readonly cache: CacheService,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly permissionsService: PermissionsService,
    private readonly mail: MailService,
  ) {}

  private normalizeEmail(value: string): string {
    return value.trim().toLowerCase().normalize('NFKC');
  }

  private async trySendMail(
    action: string,
    tenantId: string | null | undefined,
    targetId: string | null | undefined,
    send: () => Promise<{ ok: boolean; skipped?: boolean; reason?: string }>,
  ) {
    try {
      const result = await send();
      await this.audit.log({
        action,
        tenantId: tenantId || undefined,
        targetId: targetId || undefined,
        metadata: result,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown mail error';
      await this.audit.log({
        action: `${action}.failed`,
        tenantId: tenantId || undefined,
        targetId: targetId || undefined,
        metadata: { message },
      });
      return { ok: false, skipped: true, reason: message };
    }
  }

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

  private normalizeMembershipRole(role?: string): string {
    if (role === 'admin' || role === 'company_admin') return 'company_admin';
    if (['manager', 'analyst', 'viewer'].includes(role || '')) return role as string;
    return 'user';
  }

  private legacyRoleForMembership(role: string): string {
    return role === 'company_admin' ? 'admin' : 'user';
  }

  private userLevelForMembership(role: string, userLevel?: string | null): string | null {
    if (['manager', 'analyst', 'viewer'].includes(role)) return role;
    return userLevel || null;
  }

  private async getActiveMembershipOrThrow(userId: string, tenantId: string) {
    const membership = await this.membershipRepo.findOne({
      where: { user_id: userId, tenant_id: tenantId, is_active: true },
    });
    if (!membership) {
      throw new ForbiddenException('Company membership not found');
    }
    return membership;
  }

  private async getMembershipPermissionKeys(membershipId: string): Promise<string[]> {
    const rows = await this.membershipPermissionRepo.find({
      where: { membership_id: membershipId },
      select: { permission_key: true },
      order: { permission_key: 'ASC' },
    });
    return this.permissionsService.normalizePermissionKeys(rows.map((row) => row.permission_key));
  }

  private async setMembershipPermissionKeys(
    membershipId: string,
    keys: string[],
    actorId?: string,
  ): Promise<string[]> {
    const uniqueKeys = await this.permissionsService.validatePermissionKeys(keys);
    await this.membershipPermissionRepo.delete({ membership_id: membershipId });
    if (uniqueKeys.length > 0) {
      await this.membershipPermissionRepo.save(
        uniqueKeys.map((permission_key) => ({
          membership_id: membershipId,
          permission_key,
          granted_by: actorId || undefined,
        })),
      );
    }
    return uniqueKeys;
  }

  private async getMembershipPermissionBundle(userId: string, tenantId: string) {
    const membership = await this.getActiveMembershipOrThrow(userId, tenantId);
    const direct = await this.getMembershipPermissionKeys(membership.id);
    return {
      role: this.legacyRoleForMembership(membership.role),
      user_level: membership.user_level,
      membership_role: membership.role,
      direct_permissions: direct,
      effective_permissions: direct,
    };
  }

  private async assertCanGrantMembershipPermissions(
    actorId: string,
    actorRole: string,
    tenantId: string,
    targetMembership: UserTenantMembership,
    keys: string[],
  ) {
    if (actorRole === 'super_admin') return;
    if (actorRole !== 'admin') {
      throw new ForbiddenException('Only admin/super_admin can grant permissions');
    }
    if (targetMembership.role === 'company_admin') {
      throw new ForbiddenException('Admin can grant permissions to user accounts only');
    }
    const actorMembership = await this.getActiveMembershipOrThrow(actorId, tenantId);
    if (actorMembership.role !== 'company_admin') {
      throw new ForbiddenException('Only company admins can grant permissions');
    }
    const actorPermissions = new Set(await this.getMembershipPermissionKeys(actorMembership.id));
    for (const key of this.permissionsService.normalizePermissionKeys(keys)) {
      if (!actorPermissions.has(key)) {
        throw new ForbiddenException(`You cannot grant permission you do not have: ${key}`);
      }
    }
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
    const take = Math.min(Math.max(limit, 1), 100);
    const skip = (Math.max(page, 1) - 1) * take;
    if (tenantId) {
      const rows = await this.dataSource.query(
        `SELECT
           u.id,
           u.email,
           u.full_name,
           COALESCE(m.role, CASE WHEN u.role = 'admin' THEN 'company_admin' ELSE u.role END) AS membership_role,
           u.role AS global_role,
           COALESCE(m.user_level, u.user_level) AS user_level,
           COALESCE(m.dept, u.dept) AS dept,
           COALESCE(m.is_active, u.is_active) AS is_active,
           u.must_change_pwd,
           u.last_login_at,
           u.created_at,
           m.id AS membership_id,
           m.tenant_id
         FROM users u
         LEFT JOIN user_tenant_memberships m
           ON m.user_id = u.id AND m.tenant_id = $1
         WHERE (m.tenant_id = $1 OR u.tenant_id = $1)
         ORDER BY u.created_at DESC
         LIMIT $2 OFFSET $3`,
        [tenantId, take, skip],
      );
      const totalRows = await this.dataSource.query(
        `SELECT COUNT(*)::int AS total
         FROM users u
         LEFT JOIN user_tenant_memberships m
           ON m.user_id = u.id AND m.tenant_id = $1
         WHERE (m.tenant_id = $1 OR u.tenant_id = $1)`,
        [tenantId],
      );
      const mapped = rows.map((u: Record<string, any>) => ({
        id: u.id,
        email: u.email,
        full_name: u.full_name,
        role: u.global_role,
        membership_role: u.membership_role,
        user_level: u.user_level,
        dept: u.dept,
        is_active: u.is_active,
        must_change_pwd: u.must_change_pwd,
        last_login_at: u.last_login_at,
        created_at: u.created_at,
        membership_id: u.membership_id,
        tenant_id: u.tenant_id ?? tenantId,
      }));
      return buildPaginatedResult(mapped, Number(totalRows[0]?.total || 0), page, take);
    }

    const [users, total] = await this.userRepo.findAndCount({
      order: { created_at: 'DESC' },
      take,
      skip,
    });
    const rows = users.map((u) => ({
      id: u.id,
      email: u.email,
      full_name: u.full_name,
      role: u.role,
      membership_role: u.role === 'admin' ? 'company_admin' : u.role,
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

    const normalizedEmail = this.normalizeEmail(body.email);
    const tempPassword = body.password || this.generateTempPassword();
    let passwordForInvite: string | undefined;
    let user = await this.userRepo.findOne({ where: { email: normalizedEmail } });

    // Cross-tenant guard: a tenant admin must not be able to silently attach an
    // account that already exists in ANOTHER company, nor learn (via the success
    // response) that the email exists platform-wide along with its owner's name.
    // If the existing account already belongs to the caller's tenant, this is a
    // legitimate re-invite/reactivate and proceeds below. Only super_admins may
    // link an existing user into a new tenant.
    if (user && callerRole !== 'super_admin') {
      const existingMembership = await this.membershipRepo.findOne({
        where: { user_id: user.id, tenant_id: tenantId },
      });
      const belongsToCallerTenant = Boolean(existingMembership) || user.tenant_id === tenantId;
      if (!belongsToCallerTenant) {
        // Generic message + no identifiers — avoids existence/identity disclosure.
        throw new ConflictException('A user with this email already exists');
      }
    }

    // Defense-in-depth: user_level must NOT be able to drive the privileged
    // membership-role decision. Only an explicit, known user level may be used
    // as the fallback for role derivation — anything else (e.g. a tampered
    // 'admin'/'company_admin' that bypassed DTO validation) is ignored so it
    // cannot escalate to company_admin via the `role` slot.
    const safeUserLevel = ['manager', 'analyst', 'viewer'].includes(body.user_level || '')
      ? body.user_level
      : undefined;
    const membershipRole = this.normalizeMembershipRole(body.role || safeUserLevel || 'viewer');

    // Hard guard at the decision point, BEFORE any row is written: company_admin
    // is privileged and may only be granted by a super_admin. This holds
    // regardless of how membershipRole was derived, so it survives future
    // refactors of the role/level plumbing — and throwing here avoids creating
    // an orphaned users row.
    if (callerRole !== 'super_admin' && membershipRole === 'company_admin') {
      throw new ForbiddenException('Only super admins can create admin accounts');
    }

    if (!user) {
      const hash = await bcrypt.hash(tempPassword, 12);
      user = await this.userRepo.save({
        tenant_id: tenantId,
        email: normalizedEmail,
        password_hash: hash,
        full_name: body.full_name,
        role: this.legacyRoleForMembership(membershipRole),
        user_level: body.user_level || 'viewer',
        dept: body.dept || (null as any),
        must_change_pwd: true,
        created_by: callerId || null,
      } as any) as User;
      passwordForInvite = tempPassword;
    } else if (!user.tenant_id) {
      user.tenant_id = tenantId;
      await this.userRepo.save(user);
    }

    let membership = await this.membershipRepo.findOne({
      where: { user_id: user.id, tenant_id: tenantId },
    });
    if (membership) {
      membership.is_active = true;
      membership.deactivated_at = null as any;
      membership.deactivated_by = null as any;
      membership.role = membershipRole;
      membership.user_level = this.userLevelForMembership(membershipRole, body.user_level);
      membership.dept = body.dept || (null as any);
      membership = await this.membershipRepo.save(membership);
    } else {
      membership = await this.membershipRepo.save({
        user_id: user.id,
        tenant_id: tenantId,
        role: membershipRole,
        user_level: this.userLevelForMembership(membershipRole, body.user_level),
        dept: body.dept || (null as any),
        is_active: true,
        created_by: callerId || null,
      } as Partial<UserTenantMembership>);
    }

    const defaultPerms =
      membership.role === 'company_admin'
        ? DEFAULT_ADMIN_PERMISSIONS
        : [];
    if (defaultPerms.length > 0) {
      await this.setMembershipPermissionKeys(membership.id, defaultPerms, callerId);
    }

    await this.audit.log({
      action: 'admin.user.create',
      tenantId,
      actorId: callerId,
      targetId: user.id,
      metadata: {
        role: user.role,
        membershipRole: membership.role,
        userLevel: membership.user_level,
        email: user.email,
      },
    });
    if (passwordForInvite) {
      await this.trySendMail(
        'admin.user.invite_email',
        tenantId,
        user.id,
        () => this.mail.sendInviteEmail({
          to: user.email,
          name: user.full_name,
          tempPassword: passwordForInvite as string,
        }),
      );
    }
    return {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      membership_id: membership.id,
      temp_password: passwordForInvite,
    };
  }

  // A tenant admin (company_admin → JWT role 'admin') must not be able to manage
  // other admin/super_admin accounts within their tenant — otherwise a peer admin
  // could reset another admin's password (and read the temp password from the
  // response), or deactivate/edit a co-admin. Only super_admins may act on
  // elevated accounts. Acting on your own account is allowed here; specific
  // self-protections (e.g. self-deactivation) are enforced at the call site.
  // Mirrors the role check in deleteUserPermanently, but also honours the
  // in-tenant membership role, which is the source of truth for scoped authz.
  private assertCanManageTarget(
    callerId: string,
    callerRole: string,
    targetUser: User,
    targetMembership: UserTenantMembership | null,
  ): void {
    if (callerRole === 'super_admin') return;
    if (targetUser.role === 'super_admin') {
      throw new ForbiddenException('Super admin accounts cannot be managed here');
    }
    const targetIsAdmin =
      targetUser.role === 'admin' || targetMembership?.role === 'company_admin';
    if (targetIsAdmin && targetUser.id !== callerId) {
      throw new ForbiddenException('Admins cannot manage other admin accounts');
    }
  }

  async updateUser(
    id: string,
    callerId: string,
    callerRole: string,
    callerTenantId: string,
    body: UserMutationBody,
  ) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    const membership = callerTenantId
      ? await this.membershipRepo.findOne({ where: { user_id: id, tenant_id: callerTenantId } })
      : null;
    if (callerTenantId && user.tenant_id !== callerTenantId && !membership) {
      throw new ForbiddenException();
    }
    this.assertCanManageTarget(callerId, callerRole, user, membership);

    // full_name is a global attribute — the person's name has no per-tenant
    // equivalent on the membership — so it is written to the users row.
    if (body.full_name !== undefined) {
      user.full_name = body.full_name;
    }

    if (membership) {
      // Tenant-scoped attributes (level/dept/active) are owned by the
      // membership. Writing them to the global users row would leak this
      // tenant's changes into the user's OTHER tenants — e.g. is_active=false
      // would lock the user out everywhere (the JWT strategy checks
      // users.is_active). Mutate only the membership here.
      membership.user_level = body.user_level ?? membership.user_level;
      membership.dept = body.dept ?? membership.dept;
      membership.is_active = body.is_active ?? membership.is_active;
      await this.membershipRepo.save(membership);
      if (body.full_name !== undefined) {
        await this.userRepo.save(user);
      }
    } else {
      // Legacy single-tenant user with no membership: the users row is the
      // source of truth for these attributes.
      user.user_level = body.user_level ?? user.user_level;
      user.dept = body.dept ?? user.dept;
      user.is_active = body.is_active ?? user.is_active;
      await this.userRepo.save(user);
    }

    // Report the EFFECTIVE values for the caller's tenant — the membership
    // when one exists, otherwise the global row.
    const effective = membership
      ? {
          user_level: membership.user_level,
          dept: membership.dept,
          is_active: membership.is_active,
        }
      : {
          user_level: user.user_level,
          dept: user.dept,
          is_active: user.is_active,
        };

    await this.audit.log({
      action: 'admin.user.update',
      tenantId: callerTenantId || user.tenant_id,
      actorId: callerId,
      targetId: user.id,
      metadata: {
        membershipId: membership?.id ?? null,
        userLevel: effective.user_level,
        dept: effective.dept,
        isActive: effective.is_active,
      },
    });
    return {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      user_level: effective.user_level,
      dept: effective.dept,
      is_active: effective.is_active,
    };
  }

  async deactivateUser(
    id: string,
    callerId: string,
    callerRole: string,
    callerTenantId: string,
  ) {
    if (id === callerId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    const membership = callerTenantId
      ? await this.membershipRepo.findOne({ where: { user_id: id, tenant_id: callerTenantId } })
      : null;
    this.assertCanManageTarget(callerId, callerRole, user, membership);
    if (membership) {
      membership.is_active = false;
      membership.deactivated_at = new Date();
      await this.membershipRepo.save(membership);
    } else if (callerTenantId && user.tenant_id !== callerTenantId) {
      throw new ForbiddenException();
    } else {
      user.is_active = false;
      await this.userRepo.save(user);
    }
    await this.audit.log({
      action: membership ? 'admin.membership.deactivate' : 'admin.user.deactivate',
      tenantId: callerTenantId || user.tenant_id,
      actorId: callerId,
      targetId: user.id,
      metadata: { email: user.email, membershipId: membership?.id ?? null },
    });
    return { ok: true };
  }

  async deleteUserPermanently(
    id: string,
    actorId: string,
    callerRole: string,
    callerTenantId: string,
  ) {
    if (id === actorId) {
      throw new BadRequestException('You cannot permanently delete your own account');
    }

    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'super_admin') {
      throw new ForbiddenException('Super admin accounts cannot be permanently deleted here');
    }
    if (callerRole === 'admin' && user.role !== 'user') {
      throw new ForbiddenException('Admins can only permanently delete regular users');
    }

    const memberships = await this.membershipRepo.find({ where: { user_id: id } });
    const inScopedTenant = memberships.some((membership) => membership.tenant_id === callerTenantId);
    if (callerTenantId && user.tenant_id !== callerTenantId && !inScopedTenant) {
      throw new ForbiddenException();
    }
    if (callerRole !== 'super_admin') {
      const outsideScope = memberships.some((membership) => membership.tenant_id !== callerTenantId);
      if (outsideScope || (user.tenant_id && user.tenant_id !== callerTenantId)) {
        throw new ForbiddenException('Only super admins can permanently delete users linked to other companies');
      }
    }

    const tenantIds = [...new Set([
      user.tenant_id,
      ...memberships.map((membership) => membership.tenant_id),
    ].filter(Boolean))];

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `DELETE FROM revoked_tokens WHERE jti LIKE $1`,
        [`__revoke_all__${id}:%`],
      );
      await manager.query(
        `UPDATE users SET created_by = NULL WHERE created_by = $1`,
        [id],
      );
      await manager.query(
        `UPDATE user_tenant_memberships
            SET created_by = NULL,
                deactivated_by = CASE WHEN deactivated_by = $1 THEN NULL ELSE deactivated_by END
          WHERE created_by = $1 OR deactivated_by = $1`,
        [id],
      );
      await manager.delete(User, { id });
    });

    await this.audit.log({
      action: 'admin.user.delete_permanent',
      tenantId: callerTenantId || user.tenant_id,
      actorId,
      targetId: id,
      metadata: {
        email: user.email,
        role: user.role,
        tenantIds,
        deletedMemberships: memberships.length,
      },
    });

    return { ok: true };
  }

  async resetPassword(
    id: string,
    callerId: string,
    callerRole: string,
    callerTenantId: string,
    delivery: 'reset' | 'invite' = 'reset',
  ) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException();
    const membership = callerTenantId
      ? await this.membershipRepo.findOne({ where: { user_id: id, tenant_id: callerTenantId } })
      : null;
    if (callerTenantId && user.tenant_id !== callerTenantId && !membership) {
      throw new ForbiddenException();
    }
    this.assertCanManageTarget(callerId, callerRole, user, membership);
    user.must_change_pwd = true;
    const tempPassword = this.generateTempPassword();
    user.password_hash = await bcrypt.hash(tempPassword, 12);
    await this.userRepo.save(user);
    await this.audit.log({
      action: 'admin.user.reset_password',
      tenantId: callerTenantId || user.tenant_id,
      actorId: callerId,
      targetId: user.id,
      metadata: { email: user.email },
    });
    const mailResult = await this.trySendMail(
      delivery === 'invite' ? 'admin.user.invite_email' : 'admin.user.reset_password_email',
      callerTenantId || user.tenant_id,
      user.id,
      () => delivery === 'invite'
        ? this.mail.sendInviteEmail({
            to: user.email,
            name: user.full_name,
            tempPassword,
          })
        : this.mail.sendPasswordResetEmail({
            to: user.email,
            name: user.full_name,
            tempPassword,
          }),
    );
    return { ok: true, temp_password: tempPassword, email_delivery: mailResult };
  }

  async resendInvite(
    id: string,
    callerId: string,
    callerRole: string,
    callerTenantId: string,
  ) {
    const result = await this.resetPassword(id, callerId, callerRole, callerTenantId, 'invite');
    const user = await this.userRepo.findOne({ where: { id } });
    await this.audit.log({
      action: 'admin.user.invite_resend',
      tenantId: callerTenantId || user?.tenant_id,
      actorId: callerId,
      targetId: id,
      metadata: { email: user?.email ?? null },
    });
    return {
      ok: true,
      invite_delivery: result.email_delivery?.skipped ? 'manual' : 'email',
      temp_password: result.temp_password,
    };
  }

  // ── Tenants (super_admin only) ─────────────────────────────────────────────

  async getTenants(page = 1, limit = 100) {
    const take = Math.min(Math.max(limit, 1), 100);
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
            `SELECT tenant_id, COUNT(*)::int AS cnt
             FROM user_tenant_memberships
             WHERE tenant_id = ANY($1) AND is_active = true
             GROUP BY tenant_id`,
            [tenantIds],
          )
        : Promise.resolve([] as { tenant_id: string; cnt: string }[]),
    ]);
    const connMap = new Map(connections.map((c) => [c.tenant_id, c]));
    const countMap = new Map(userCounts.map((r) => [r.tenant_id, Number(r.cnt)]));
    const rows = tenants.map((t) => ({
        ...t,
        sync_key_prefix: connMap.get(t.id)?.sync_api_key_prefix ?? null,
        last_sync: connMap.get(t.id)?.last_success_at ?? connMap.get(t.id)?.last_ingest_at ?? null,
        last_failure: connMap.get(t.id)?.last_failure_at ?? null,
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
    const membership = await this.membershipRepo.save({
      user_id: adminUser.id,
      tenant_id: tenant.id,
      role: 'company_admin',
      user_level: 'manager',
      is_active: true,
      created_by: createdBy,
    } as Partial<UserTenantMembership>);
    await this.setMembershipPermissionKeys(membership.id, DEFAULT_ADMIN_PERMISSIONS, createdBy);
    await this.audit.log({
      action: 'company.created',
      tenantId: tenant.id,
      actorId: createdBy,
      targetId: tenant.id,
      metadata: { slug: tenant.slug, adminEmail: adminUser.email },
    });
    await this.trySendMail(
      'admin.tenant.first_admin_invite_email',
      tenant.id,
      adminUser.id,
      () => this.mail.sendInviteEmail({
        to: adminUser.email,
        name: adminUser.full_name,
        tempPassword: adminTempPassword,
      }),
    );

    return {
      tenant,
      firstAdmin: {
        id: adminUser.id,
        email: adminUser.email,
        full_name: adminUser.full_name,
        membership_id: membership.id,
      },
      admin_user_id: adminUser.id,
      sync_api_key: rawKey,
      sync_api_key_prefix: rawKey.slice(0, 8),
      admin_temp_password: adminTempPassword,
    };
  }

  async getCompanySettings(tenantId: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId, is_active: true } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const rows = await this.dataSource.query(
      `SELECT settings, sync_config FROM company_settings WHERE tenant_id = $1::uuid`,
      [tenantId],
    );
    const settings = rows[0]?.settings ?? DEFAULT_COMPANY_SETTINGS;
    const syncConfig = rows[0]?.sync_config ?? DEFAULT_SYNC_CONFIG;
    return {
      tenantId,
      name: tenant.name,
      slug: tenant.slug,
      timezone: tenant.timezone,
      currency: tenant.currency,
      vat_rate: Number(tenant.vat_rate),
      ...DEFAULT_COMPANY_SETTINGS,
      ...settings,
      sync_config: {
        ...DEFAULT_SYNC_CONFIG,
        ...syncConfig,
        modules: {
          ...DEFAULT_SYNC_CONFIG.modules,
          ...(syncConfig?.modules ?? {}),
        },
      },
    };
  }

  async updateCompanySettings(
    tenantId: string,
    actorId: string,
    body: Record<string, unknown>,
  ) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId, is_active: true } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const tenantUpdates: Partial<Tenant> = {};
    if (typeof body.name === 'string' && body.name.trim()) tenantUpdates.name = body.name.trim();
    if (typeof body.timezone === 'string' && body.timezone.trim()) tenantUpdates.timezone = body.timezone.trim();
    if (typeof body.currency === 'string' && body.currency.trim()) tenantUpdates.currency = body.currency.trim().slice(0, 3).toUpperCase();
    if (body.vat_rate !== undefined) tenantUpdates.vat_rate = Number(body.vat_rate);
    if (Object.keys(tenantUpdates).length > 0) {
      Object.assign(tenant, tenantUpdates);
      await this.tenantRepo.save(tenant);
    }

    const settings = {
      data_freshness_threshold_minutes: Number(body.data_freshness_threshold_minutes ?? DEFAULT_COMPANY_SETTINGS.data_freshness_threshold_minutes),
      default_dashboard_range: String(body.default_dashboard_range ?? DEFAULT_COMPANY_SETTINGS.default_dashboard_range),
      alert_recipients: Array.isArray(body.alert_recipients) ? body.alert_recipients.map(String) : DEFAULT_COMPANY_SETTINGS.alert_recipients,
    };
    await this.dataSource.query(
      `INSERT INTO company_settings (tenant_id, settings, updated_by, updated_at)
       VALUES ($1::uuid, $2::jsonb, $3::uuid, now())
       ON CONFLICT (tenant_id)
       DO UPDATE SET
         settings = company_settings.settings || EXCLUDED.settings,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()`,
      [tenantId, JSON.stringify(settings), actorId],
    );
    await this.audit.log({
      action: 'company.settings.update',
      actorId,
      tenantId,
      targetId: tenantId,
      metadata: { fields: Object.keys(body) },
    });
    return this.getCompanySettings(tenantId);
  }

  async getCompanySyncConfig(tenantId: string) {
    const settings = await this.getCompanySettings(tenantId);
    const connection = await this.connRepo.findOne({ where: { tenant_id: tenantId } });
    const engineInstallations = await this.engineInstallationRepo.find({
      where: { tenant_id: tenantId },
      order: { last_seen_at: 'DESC' },
    });
    return {
      tenantId,
      sync_config: settings.sync_config,
      sync_key_prefix: connection?.sync_api_key_prefix ?? null,
      sync_key_last_rotated: connection?.sync_api_key_last_rotated ?? null,
      engine_installations: engineInstallations,
    };
  }

  async updateCompanySyncConfig(
    tenantId: string,
    actorId: string,
    body: Record<string, unknown>,
  ) {
    const current = await this.getCompanySettings(tenantId);
    const incomingModules = typeof body.modules === 'object' && body.modules
      ? body.modules as Record<string, unknown>
      : {};
    const syncConfig = {
      sync_schedule: String(body.sync_schedule ?? current.sync_config.sync_schedule ?? DEFAULT_SYNC_CONFIG.sync_schedule),
      modules: {
        ...DEFAULT_SYNC_CONFIG.modules,
        ...(current.sync_config.modules ?? {}),
        ...Object.fromEntries(
          Object.entries(incomingModules).map(([key, value]) => [key, Boolean(value)]),
        ),
      },
    };
    await this.dataSource.query(
      `INSERT INTO company_settings (tenant_id, sync_config, updated_by, updated_at)
       VALUES ($1::uuid, $2::jsonb, $3::uuid, now())
       ON CONFLICT (tenant_id)
       DO UPDATE SET
         sync_config = EXCLUDED.sync_config,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()`,
      [tenantId, JSON.stringify(syncConfig), actorId],
    );
    await this.audit.log({
      action: 'company.sync_config.update',
      actorId,
      tenantId,
      targetId: tenantId,
      metadata: { sync_schedule: syncConfig.sync_schedule, modules: syncConfig.modules },
    });
    return this.getCompanySyncConfig(tenantId);
  }

  async getPlatformSettings() {
    const row = await this.dataSource.query(
      `SELECT value FROM platform_settings WHERE key = 'default'`,
    );
    return {
      ...DEFAULT_PLATFORM_SETTINGS,
      ...(row[0]?.value ?? {}),
    };
  }

  async updatePlatformSettings(actorId: string, body: Record<string, unknown>) {
    const current = await this.getPlatformSettings();
    const next = {
      ...current,
      ...body,
      feature_flags: {
        ...(current.feature_flags ?? {}),
        ...((body.feature_flags as Record<string, unknown>) ?? {}),
      },
      tenant_defaults: {
        ...(current.tenant_defaults ?? {}),
        ...((body.tenant_defaults as Record<string, unknown>) ?? {}),
      },
      security_policy: {
        ...(current.security_policy ?? {}),
        ...((body.security_policy as Record<string, unknown>) ?? {}),
      },
    };
    await this.dataSource.query(
      `INSERT INTO platform_settings (key, value, updated_by, updated_at)
       VALUES ('default', $1::jsonb, $2::uuid, now())
       ON CONFLICT (key)
       DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [JSON.stringify(next), actorId],
    );
    await this.audit.log({
      action: 'platform.settings.update',
      actorId,
      metadata: { fields: Object.keys(body) },
    });
    return next;
  }

  async getPlatformHealth() {
    const overview = await this.getPlatformOverview();
    const settings = await this.getPlatformSettings();
    return {
      status: settings.maintenance_mode ? 'maintenance' : 'ok',
      generated_at: new Date().toISOString(),
      overview,
      settings,
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
      action: 'company.updated',
      tenantId: saved.id,
      targetId: saved.id,
      metadata: { isActive: saved.is_active, slug: saved.slug },
    });
    return saved;
  }

  async deactivateTenant(id: string, actorId?: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException();
    tenant.is_active = false;
    tenant.deactivated_at = new Date();
    tenant.deactivated_by = actorId || null as any;
    const saved = await this.tenantRepo.save(tenant);
    await this.connRepo.update({ tenant_id: id }, { is_active: false });
    await this.triggerRepo.update(
      { tenant_id: id, status: 'pending' },
      { status: 'failed', result_message: 'Tenant deactivated', completed_at: new Date() },
    );
    await this.audit.log({
      action: 'company.deactivated',
      tenantId: saved.id,
      actorId,
      targetId: saved.id,
      metadata: { slug: saved.slug },
    });
    return saved;
  }

  async reactivateTenant(id: string, actorId?: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException();
    tenant.is_active = true;
    tenant.reactivated_at = new Date();
    tenant.reactivated_by = actorId || null as any;
    const saved = await this.tenantRepo.save(tenant);
    await this.audit.log({
      action: 'admin.tenant.reactivate',
      tenantId: saved.id,
      actorId,
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
      action: 'sync.api_key_rotated',
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
    const runs = await this.dataSource.query(
      `SELECT
         sr.*,
         COUNT(srb.id)::int AS batch_count,
         COUNT(*) FILTER (WHERE srb.status = 'failed')::int AS failed_batch_count
       FROM sync_runs sr
       LEFT JOIN sync_run_batches srb ON srb.sync_run_id = sr.id
       WHERE sr.tenant_id = $1
       GROUP BY sr.id
       ORDER BY sr.started_at DESC
       LIMIT 20`,
      [tenantId],
    );
    const watermarks = await this.watermarkRepo.find({
      where: { tenant_id: tenantId },
    });
    const triggers = await this.triggerRepo.find({
      where: { tenant_id: tenantId },
      order: { created_at: 'DESC' },
      take: 50,
    });
    const conn = await this.connRepo.findOne({
      where: { tenant_id: tenantId },
    });
    const installations = await this.engineInstallationRepo.find({
      where: { tenant_id: tenantId },
      order: { last_seen_at: 'DESC' },
    });
    const latestEngine = installations[0] || null;
    const now = Date.now();
    const engineLastSeen = latestEngine?.last_seen_at ? new Date(latestEngine.last_seen_at).getTime() : 0;
    const engineOnline = engineLastSeen > 0 && now - engineLastSeen < 2 * 60_000;
    const lastSuccess = conn?.last_success_at ? new Date(conn.last_success_at).getTime() : 0;
    const lastFailure = conn?.last_failure_at ? new Date(conn.last_failure_at).getTime() : 0;
    const syncHealth = !latestEngine
      ? 'never_synced'
      : !engineOnline
        ? 'engine_offline'
        : lastFailure > lastSuccess
          ? 'failed'
          : !lastSuccess
            ? 'never_synced'
            : now - lastSuccess > 24 * 60 * 60_000
              ? 'stale'
              : 'ok';
    return {
      logs: runs,
      runs,
      watermarks,
      triggers,
      active_triggers: triggers.filter((trigger) => ACTIVE_TRIGGER_STATUS_SET.has(trigger.status)),
      engine_installations: installations,
      engine_status: latestEngine
        ? {
            ...latestEngine,
            status: engineOnline
              ? latestEngine.status === 'running' ? 'running' : 'online'
              : 'offline',
            online: engineOnline,
          }
        : { status: 'not_installed', online: false },
      sync_health: syncHealth,
      last_ingest_at: conn?.last_ingest_at,
      last_ingest_module: conn?.last_ingest_module,
      last_attempt_at: conn?.last_attempt_at,
      last_attempt_module: conn?.last_attempt_module,
      last_success_at: conn?.last_success_at,
      last_success_module: conn?.last_success_module,
      last_failure_at: conn?.last_failure_at,
      last_failure_message: conn?.last_failure_message,
      sync_key_prefix: conn?.sync_api_key_prefix,
      sync_key_last_rotated: conn?.sync_api_key_last_rotated,
    };
  }

  async upsertEngineHeartbeat(
    tenantId: string,
    body: {
      machineId?: string;
      machineName?: string;
      engineVersion?: string;
      osVersion?: string;
    },
    ip?: string,
  ) {
    if (!body.machineId) throw new BadRequestException('machineId is required');
    await this.dataSource.query(
      `INSERT INTO sync_engine_installations (
         tenant_id, machine_id, machine_name, engine_version, os_version,
         last_seen_at, last_ip, status, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, now(), NULLIF($6, '')::inet, 'online', now())
       ON CONFLICT (tenant_id, machine_id)
       DO UPDATE SET
         machine_name = EXCLUDED.machine_name,
         engine_version = EXCLUDED.engine_version,
         os_version = EXCLUDED.os_version,
         last_seen_at = now(),
         last_ip = EXCLUDED.last_ip,
         status = 'online',
         updated_at = now()`,
      [
        tenantId,
        body.machineId,
        body.machineName || null,
        body.engineVersion || null,
        body.osVersion || null,
        ip || '',
      ],
    );
    const pending = await this.triggerRepo.count({
      where: { tenant_id: tenantId, status: 'pending' },
    });
    return { ok: true, serverTime: new Date().toISOString(), pendingTriggers: pending };
  }

  async getSyncLogs(tenantId: string, page = 1, limit = 20) {
    const take = Math.min(limit, 100);
    const skip = (page - 1) * take;
    const logs = await this.dataSource.query(
      `SELECT
         sr.*,
         COUNT(srb.id)::int AS batch_count,
         COUNT(*) FILTER (WHERE srb.status = 'failed')::int AS failed_batch_count
       FROM sync_runs sr
       LEFT JOIN sync_run_batches srb ON srb.sync_run_id = sr.id
       WHERE sr.tenant_id = $1
       GROUP BY sr.id
       ORDER BY sr.started_at DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, take, skip],
    );
    const countRows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM sync_runs WHERE tenant_id = $1`,
      [tenantId],
    );
    const total = Number(countRows[0]?.total || 0);
    const paged = buildPaginatedResult(logs, total, page, take);
    return {
      ...paged,
      logs: paged.rows,
    };
  }

  async createSyncTrigger(
    tenantId: string,
    module: string,
    syncMode: SyncMode = 'incremental',
    requestedBy: string,
  ) {
    if (!ALLOWED_SYNC_MODULES.includes(module)) {
      throw new BadRequestException('Invalid sync module');
    }
    const modules = module === 'all' ? SYNC_ALL_MODULES : [module];
    const results: Array<Record<string, unknown>> = [];

    for (const syncModule of modules) {
      const existing = await this.triggerRepo.findOne({
        where: ACTIVE_TRIGGER_STATUSES.map((status) => ({
          tenant_id: tenantId,
          module: syncModule,
          status,
        })),
        order: { created_at: 'DESC' },
      });
      if (existing) {
        results.push({
          module: syncModule,
          skipped: true,
          reason: `${syncModule} sync already queued or running`,
          triggerId: existing.id,
          status: existing.status,
        });
        continue;
      }

      const trigger = await this.triggerRepo.save({
        tenant_id: tenantId,
        module: syncModule,
        sync_mode: syncMode,
        status: 'pending',
        triggered_by: requestedBy,
        requested_by: requestedBy,
        progress_percent: 0,
        rows_synced: 0,
        expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000),
        metadata: {},
      } as Partial<SyncTrigger>);
      results.push({
        module: syncModule,
        skipped: false,
        triggerId: trigger.id,
        id: trigger.id,
        status: trigger.status,
        syncMode: trigger.sync_mode,
        trigger,
      });
    }
    await this.audit.log({
      action: 'sync.manual_triggered',
      tenantId,
      actorId: requestedBy,
      metadata: { module, syncMode, results },
    });
    return {
      message: module === 'all' ? 'Sync all queued' : `${module} sync queued`,
      triggers: results,
    };
  }

  async getPendingTriggers(tenantId: string) {
    const triggers = await this.triggerRepo.find({
      where: { tenant_id: tenantId, status: 'pending' },
      order: { created_at: 'ASC' },
    });
    return { triggers };
  }

  async cancelSyncTrigger(tenantId: string, triggerId: string, actorId: string) {
    const trigger = await this.triggerRepo.findOne({
      where: { id: triggerId, tenant_id: tenantId },
    });
    if (!trigger) throw new NotFoundException('Sync trigger not found');
    if (!['pending', 'picked'].includes(trigger.status)) {
      throw new BadRequestException('Only pending or picked triggers can be cancelled');
    }
    trigger.status = 'cancelled';
    trigger.cancelled_at = new Date();
    trigger.completed_at = new Date();
    trigger.progress_percent = 0;
    trigger.result_message = 'Cancelled from dashboard';
    await this.triggerRepo.save(trigger);
    await this.audit.log({
      action: 'sync.trigger_cancelled',
      tenantId,
      actorId,
      targetId: trigger.id,
      metadata: { triggerId, module: trigger.module },
    });
    return { ok: true, trigger };
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
    const target = await this.userRepo.findOne({ where: { id: userId }, select: { id: true } });
    if (!target) throw new NotFoundException('User not found');
    return this.getMembershipPermissionBundle(userId, callerTenantId);
  }

  async setUserPermissions(
    callerId: string,
    callerRole: string,
    callerTenantId: string,
    userId: string,
    permissions: string[],
  ) {
    const target = await this.userRepo.findOne({ where: { id: userId }, select: { id: true } });
    if (!target) throw new NotFoundException('User not found');
    const targetMembership = await this.getActiveMembershipOrThrow(userId, callerTenantId);
    const uniquePermissions = await this.permissionsService.validatePermissionKeys(permissions);
    await this.assertCanGrantMembershipPermissions(
      callerId,
      callerRole,
      callerTenantId,
      targetMembership,
      uniquePermissions,
    );

    const directPermissions = await this.setMembershipPermissionKeys(
      targetMembership.id,
      uniquePermissions,
      callerId,
    );
    const updated = {
      role: this.legacyRoleForMembership(targetMembership.role),
      user_level: targetMembership.user_level,
      membership_role: targetMembership.role,
      direct_permissions: directPermissions,
      effective_permissions: directPermissions,
    };
    await this.audit.log({
      action: 'user.permission_changed',
      tenantId: callerTenantId,
      actorId: callerId,
      targetId: userId,
      metadata: { permissions: updated.direct_permissions },
    });
    return updated;
  }
}
