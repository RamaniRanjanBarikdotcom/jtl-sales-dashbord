import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Permission } from '../../entities/permission.entity';
import { RolePermission } from '../../entities/role-permission.entity';
import { UserPermission } from '../../entities/user-permission.entity';
import { User } from '../../entities/user.entity';
import {
  DEFAULT_ADMIN_PERMISSIONS,
  DEFAULT_USER_ANALYST_PERMISSIONS,
  DEFAULT_USER_MANAGER_PERMISSIONS,
  DEFAULT_USER_VIEWER_PERMISSIONS,
  PERMISSION_CATALOG,
  PermissionKey,
} from './permission-keys';

type UserRole = 'super_admin' | 'admin' | 'user';
type UserLevel = 'viewer' | 'analyst' | 'manager' | null;

@Injectable()
export class PermissionsService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepo: Repository<RolePermission>,
    @InjectRepository(UserPermission)
    private readonly userPermissionRepo: Repository<UserPermission>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async onModuleInit() {
    await this.ensureSchema();
    await this.ensurePermissionCatalog();
  }

  private async ensureSchema() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key varchar(100) UNIQUE NOT NULL,
        description text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        role varchar(30) NOT NULL,
        permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(role, permission_id)
      );
    `);
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS user_permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(user_id, permission_id)
      );
    `);
    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role);
    `);
    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);
    `);
  }

  private async ensurePermissionCatalog() {
    for (const item of PERMISSION_CATALOG) {
      await this.dataSource.query(
        `
        INSERT INTO permissions (key, description)
        VALUES ($1, $2)
        ON CONFLICT (key)
        DO UPDATE SET description = EXCLUDED.description
        `,
        [item.key, item.description],
      );
    }
  }

  private normalize(keys: string[]): string[] {
    const cleaned = keys
      .map((k) => String(k || '').trim())
      .filter((k) => k.length > 0);
    return [...new Set(cleaned)];
  }

  private defaultPermissionsFor(role: UserRole, level: UserLevel): PermissionKey[] {
    if (role === 'admin') return DEFAULT_ADMIN_PERMISSIONS;
    if (role !== 'user') return [];
    if (level === 'manager') return DEFAULT_USER_MANAGER_PERMISSIONS;
    if (level === 'analyst') return DEFAULT_USER_ANALYST_PERMISSIONS;
    return DEFAULT_USER_VIEWER_PERMISSIONS;
  }

  private async resolvePermissionIds(keys: string[]): Promise<string[]> {
    const unique = this.normalize(keys);
    if (unique.length === 0) return [];
    const rows = await this.permissionRepo.find({
      where: { key: In(unique) },
      select: { id: true, key: true },
    });
    if (rows.length !== unique.length) {
      const known = new Set(rows.map((r) => r.key));
      const missing = unique.filter((k) => !known.has(k));
      throw new BadRequestException(`Unknown permission keys: ${missing.join(', ')}`);
    }
    return rows.map((r) => r.id);
  }

  async getCatalog() {
    const rows = await this.permissionRepo.find({
      order: { key: 'ASC' },
      select: { key: true, description: true },
    });
    return rows;
  }

  async getDirectPermissionKeys(userId: string): Promise<string[]> {
    const rows = await this.userPermissionRepo
      .createQueryBuilder('up')
      .innerJoin(Permission, 'p', 'p.id = up.permission_id')
      .select('p.key', 'key')
      .where('up.user_id = :userId', { userId })
      .getRawMany<{ key: string }>();
    return rows.map((r) => r.key);
  }

  private async getRolePermissionKeys(role: UserRole): Promise<string[]> {
    const rows = await this.rolePermissionRepo
      .createQueryBuilder('rp')
      .innerJoin(Permission, 'p', 'p.id = rp.permission_id')
      .select('p.key', 'key')
      .where('rp.role = :role', { role })
      .getRawMany<{ key: string }>();
    return rows.map((r) => r.key);
  }

  private async bootstrapPermissionsIfMissing(user: User): Promise<string[]> {
    const current = await this.getDirectPermissionKeys(user.id);
    if (current.length > 0) return current;

    const defaults = this.defaultPermissionsFor(
      user.role as UserRole,
      (user.user_level as UserLevel) || null,
    );
    if (defaults.length === 0) return [];
    await this.setUserPermissions(user.id, user.id, defaults, true);
    return defaults;
  }

  async getEffectivePermissionKeys(userId: string): Promise<string[]> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        user_level: true,
        tenant_id: true,
      },
    });
    if (!user) return [];
    if (user.role === 'super_admin') return ['*'];

    const [direct, roleBased] = await Promise.all([
      this.bootstrapPermissionsIfMissing(user),
      this.getRolePermissionKeys(user.role as UserRole),
    ]);
    return this.normalize([...direct, ...roleBased]);
  }

  async getUserPermissionBundle(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        user_level: true,
        tenant_id: true,
      },
    });
    if (!user) throw new BadRequestException('User not found');

    const [direct, effective] = await Promise.all([
      this.getDirectPermissionKeys(userId),
      this.getEffectivePermissionKeys(userId),
    ]);
    return {
      role: user.role,
      user_level: user.user_level,
      direct_permissions: this.normalize(direct),
      effective_permissions: this.normalize(effective),
    };
  }

  async canUserAccess(userId: string, required: string[]): Promise<boolean> {
    const needed = this.normalize(required);
    if (needed.length === 0) return true;
    const effective = await this.getEffectivePermissionKeys(userId);
    if (effective.includes('*')) return true;
    const set = new Set(effective);
    return needed.every((p) => set.has(p));
  }

  async assertCanGrant(actorId: string, targetId: string, keys: string[]) {
    const [actor, target] = await Promise.all([
      this.userRepo.findOne({
        where: { id: actorId },
        select: { id: true, role: true, tenant_id: true },
      }),
      this.userRepo.findOne({
        where: { id: targetId },
        select: { id: true, role: true, tenant_id: true },
      }),
    ]);
    if (!actor || !target) throw new BadRequestException('User not found');
    if (actor.role === 'super_admin') return;

    if (actor.role !== 'admin') {
      throw new ForbiddenException('Only admin/super_admin can grant permissions');
    }
    if (target.role !== 'user') {
      throw new ForbiddenException('Admin can grant permissions to user accounts only');
    }
    if (!actor.tenant_id || actor.tenant_id !== target.tenant_id) {
      throw new ForbiddenException('Cross-tenant permission grants are not allowed');
    }

    const actorPerms = await this.getEffectivePermissionKeys(actor.id);
    const actorSet = new Set(actorPerms);
    for (const key of this.normalize(keys)) {
      if (!actorSet.has(key)) {
        throw new ForbiddenException(`You cannot grant permission you do not have: ${key}`);
      }
    }
  }

  async setUserPermissions(
    actorId: string,
    userId: string,
    keys: string[],
    skipGrantCheck = false,
  ) {
    const uniqueKeys = this.normalize(keys);
    if (!skipGrantCheck) {
      await this.assertCanGrant(actorId, userId, uniqueKeys);
    }
    const permissionIds = await this.resolvePermissionIds(uniqueKeys);

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(UserPermission).delete({ user_id: userId });
      if (permissionIds.length === 0) return;
      const rows = permissionIds.map((permission_id) => ({
        user_id: userId,
        permission_id,
        granted_by: actorId || null,
      }));
      await manager.getRepository(UserPermission).insert(rows);
    });

    return this.getUserPermissionBundle(userId);
  }
}

