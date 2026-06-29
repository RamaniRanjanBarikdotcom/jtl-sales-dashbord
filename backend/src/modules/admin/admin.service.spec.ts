import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
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
import { PermissionsService } from '../../common/permissions/permissions.service';
import { MailService } from '../mail/mail.service';

const mockUserRepo = {
  find: jest.fn(),
  findAndCount: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
};
const mockTenantRepo = {
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
};
const mockTenantConnRepo = {
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
};
const mockSyncLogRepo = {
  find: jest.fn(),
};
const mockSyncWatermarkRepo = {
  find: jest.fn(),
};
const mockSyncTriggerRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
};
const mockMembershipRepo = {
  findOne: jest.fn(),
  save: jest.fn(),
};
const mockMembershipPermissionRepo = {
  find: jest.fn(),
  delete: jest.fn(),
  save: jest.fn(),
};
const mockEngineInstallationRepo = {
  find: jest.fn(),
};
const mockCache = {
  del: jest.fn(),
  getOrSet: jest.fn(),
} as unknown as CacheService;
const mockDataSource = {
  query: jest.fn(),
} as unknown as DataSource;
const mockAudit = {
  log: jest.fn(),
} as unknown as AuditService;
const mockPermissions = {
  setUserPermissions: jest.fn(),
  getCatalog: jest.fn(),
  getUserPermissionBundle: jest.fn(),
  normalizePermissionKeys: jest.fn((keys: string[]) => [...new Set(keys.filter(Boolean))]),
  validatePermissionKeys: jest.fn(async (keys: string[]) => [...new Set(keys.filter(Boolean))]),
} as unknown as PermissionsService;
const mockMail = {
  sendUserInvite: jest.fn(),
  sendPasswordReset: jest.fn(),
} as unknown as MailService;

describe('AdminService', () => {
  let service: AdminService;

  beforeEach(async () => {
    jest.resetAllMocks();
    mockPermissions.normalizePermissionKeys = jest.fn((keys: string[]) => [
      ...new Set(keys.filter(Boolean)),
    ]) as any;
    mockPermissions.validatePermissionKeys = jest.fn(async (keys: string[]) => [
      ...new Set(keys.filter(Boolean)),
    ]) as any;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getRepositoryToken(User),             useValue: mockUserRepo },
        { provide: getRepositoryToken(Tenant),           useValue: mockTenantRepo },
        { provide: getRepositoryToken(TenantConnection), useValue: mockTenantConnRepo },
        { provide: getRepositoryToken(SyncLog),          useValue: mockSyncLogRepo },
        { provide: getRepositoryToken(SyncWatermark),    useValue: mockSyncWatermarkRepo },
        { provide: getRepositoryToken(SyncTrigger),      useValue: mockSyncTriggerRepo },
        { provide: getRepositoryToken(UserTenantMembership), useValue: mockMembershipRepo },
        { provide: getRepositoryToken(MembershipPermission), useValue: mockMembershipPermissionRepo },
        { provide: getRepositoryToken(SyncEngineInstallation), useValue: mockEngineInstallationRepo },
        { provide: CacheService,  useValue: mockCache },
        { provide: DataSource,    useValue: mockDataSource },
        { provide: AuditService,  useValue: mockAudit },
        { provide: PermissionsService, useValue: mockPermissions },
        { provide: MailService, useValue: mockMail },
      ],
    }).compile();
    service = module.get<AdminService>(AdminService);
  });

  describe('getUsers', () => {
    it('scopes to own tenantId for admin role', async () => {
      (mockDataSource.query as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: 0 }]);
      await service.getUsers('admin', 'tenant-abc', undefined);
      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('user_tenant_memberships'),
        ['tenant-abc', 100, 0],
      );
    });

    it('returns all users when super_admin has no tenant context', async () => {
      mockUserRepo.findAndCount.mockResolvedValue([[], 0]);
      await service.getUsers('super_admin', '', undefined);
      // super_admin with no callerTenantId and no queryTenantId → no tenant filter
      const call = mockUserRepo.findAndCount.mock.calls[0][0];
      expect(call?.where?.tenant_id).toBeUndefined();
    });
  });

  describe('membership permissions', () => {
    it('reads permissions from the selected tenant membership', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: 'user-1' });
      mockMembershipRepo.findOne.mockResolvedValue({
        id: 'member-tenant-b',
        user_id: 'user-1',
        tenant_id: 'tenant-b',
        role: 'viewer',
        user_level: 'viewer',
        is_active: true,
      });
      mockMembershipPermissionRepo.find.mockResolvedValue([
        { permission_key: 'analytics.read' },
      ]);

      const result = await service.getUserPermissions('super_admin', 'tenant-b', 'user-1');

      expect(mockMembershipRepo.findOne).toHaveBeenCalledWith({
        where: { user_id: 'user-1', tenant_id: 'tenant-b', is_active: true },
      });
      expect(mockPermissions.getUserPermissionBundle).not.toHaveBeenCalled();
      expect(result.direct_permissions).toEqual(['analytics.read']);
      expect(result.membership_role).toBe('viewer');
    });

    it('writes permissions to membership_permissions only', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: 'user-1' });
      mockMembershipRepo.findOne.mockResolvedValue({
        id: 'member-tenant-b',
        user_id: 'user-1',
        tenant_id: 'tenant-b',
        role: 'viewer',
        user_level: 'viewer',
        is_active: true,
      });
      mockMembershipPermissionRepo.delete.mockResolvedValue({ affected: 1 });
      mockMembershipPermissionRepo.save.mockResolvedValue([]);

      const result = await service.setUserPermissions(
        'super-1',
        'super_admin',
        'tenant-b',
        'user-1',
        ['analytics.read', 'analytics.read'],
      );

      expect(mockPermissions.setUserPermissions).not.toHaveBeenCalled();
      expect(mockMembershipPermissionRepo.delete).toHaveBeenCalledWith({
        membership_id: 'member-tenant-b',
      });
      expect(mockMembershipPermissionRepo.save).toHaveBeenCalledWith([
        {
          membership_id: 'member-tenant-b',
          permission_key: 'analytics.read',
          granted_by: 'super-1',
        },
      ]);
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: 'tenant-b',
        targetId: 'user-1',
      }));
      expect(result.direct_permissions).toEqual(['analytics.read']);
    });

    it('blocks company admins from granting permissions they do not have', async () => {
      mockUserRepo.findOne.mockResolvedValue({ id: 'user-1' });
      mockMembershipRepo.findOne
        .mockResolvedValueOnce({
          id: 'target-membership',
          user_id: 'user-1',
          tenant_id: 'tenant-a',
          role: 'viewer',
          user_level: 'viewer',
          is_active: true,
        })
        .mockResolvedValueOnce({
          id: 'actor-membership',
          user_id: 'admin-1',
          tenant_id: 'tenant-a',
          role: 'company_admin',
          user_level: 'manager',
          is_active: true,
        });
      mockMembershipPermissionRepo.find.mockResolvedValue([
        { permission_key: 'analytics.read' },
      ]);

      await expect(service.setUserPermissions(
        'admin-1',
        'admin',
        'tenant-a',
        'user-1',
        ['platform.manage'],
      )).rejects.toThrow('You cannot grant permission you do not have');
      expect(mockMembershipPermissionRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('user management authorization (assertCanManageTarget)', () => {
    it('blocks a company admin from resetting a peer admin password', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'target-1', role: 'user', tenant_id: 'tenant-a', email: 'peer@x.io',
      });
      mockMembershipRepo.findOne.mockResolvedValue({
        id: 'm-target', user_id: 'target-1', tenant_id: 'tenant-a',
        role: 'company_admin', is_active: true,
      });

      await expect(
        service.resetPassword('target-1', 'admin-1', 'admin', 'tenant-a'),
      ).rejects.toThrow('Admins cannot manage other admin accounts');
      expect(mockUserRepo.save).not.toHaveBeenCalled();
    });

    it('blocks a company admin from resetting a super admin password', async () => {
      // In-scope (tenant_id matches) so the tenant scope check passes and the
      // role guard is what blocks the action — out-of-scope super_admins are
      // already covered by the scope check.
      mockUserRepo.findOne.mockResolvedValue({
        id: 'super-9', role: 'super_admin', tenant_id: 'tenant-a', email: 's@x.io',
      });
      mockMembershipRepo.findOne.mockResolvedValue(null);

      await expect(
        service.resetPassword('super-9', 'admin-1', 'admin', 'tenant-a'),
      ).rejects.toThrow('Super admin accounts cannot be managed here');
      expect(mockUserRepo.save).not.toHaveBeenCalled();
    });

    it('allows a company admin to reset a regular user password', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'user-7', role: 'user', tenant_id: 'tenant-a', email: 'u@x.io', full_name: 'U',
      });
      mockMembershipRepo.findOne.mockResolvedValue({
        id: 'm-user', user_id: 'user-7', tenant_id: 'tenant-a',
        role: 'viewer', is_active: true,
      });

      const result = await service.resetPassword('user-7', 'admin-1', 'admin', 'tenant-a');

      expect(mockUserRepo.save).toHaveBeenCalled();
      expect(result.ok).toBe(true);
      expect(typeof result.temp_password).toBe('string');
    });

    it('allows a super admin to reset an admin password (role bypass)', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'admin-2', role: 'admin', tenant_id: 'tenant-a', email: 'a@x.io', full_name: 'A',
      });
      mockMembershipRepo.findOne.mockResolvedValue({
        id: 'm-admin', user_id: 'admin-2', tenant_id: 'tenant-a',
        role: 'company_admin', is_active: true,
      });

      const result = await service.resetPassword('admin-2', 'super-1', 'super_admin', 'tenant-a');

      expect(mockUserRepo.save).toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });

    it('prevents an admin from deactivating their own account', async () => {
      await expect(
        service.deactivateUser('admin-1', 'admin-1', 'admin', 'tenant-a'),
      ).rejects.toThrow('You cannot deactivate your own account');
      expect(mockUserRepo.findOne).not.toHaveBeenCalled();
    });

    it('blocks a company admin from deactivating a peer admin', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'target-1', role: 'admin', tenant_id: 'tenant-a', email: 'peer@x.io',
      });
      mockMembershipRepo.findOne.mockResolvedValue({
        id: 'm-target', user_id: 'target-1', tenant_id: 'tenant-a',
        role: 'company_admin', is_active: true,
      });

      await expect(
        service.deactivateUser('target-1', 'admin-1', 'admin', 'tenant-a'),
      ).rejects.toThrow('Admins cannot manage other admin accounts');
      expect(mockMembershipRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('updateUser tenant-scoped mutation (#3)', () => {
    it('writes tenant-scoped fields to the membership and leaves the global user row untouched', async () => {
      const globalUser = {
        id: 'user-7', email: 'u@x.io', role: 'user', tenant_id: 'tenant-a',
        full_name: 'U', user_level: 'viewer', dept: 'sales', is_active: true,
      };
      mockUserRepo.findOne.mockResolvedValue(globalUser);
      const membership = {
        id: 'm-user', user_id: 'user-7', tenant_id: 'tenant-a',
        role: 'viewer', user_level: 'viewer', dept: 'sales', is_active: true,
      };
      mockMembershipRepo.findOne.mockResolvedValue(membership);
      mockMembershipRepo.save.mockImplementation(async (m: unknown) => m);

      const result = await service.updateUser('user-7', 'admin-1', 'admin', 'tenant-a', {
        is_active: false, user_level: 'manager',
      });

      // membership received the new tenant-scoped values
      expect(mockMembershipRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ is_active: false, user_level: 'manager' }),
      );
      // global users row was neither written nor mutated (no full_name change)
      expect(mockUserRepo.save).not.toHaveBeenCalled();
      expect(globalUser.is_active).toBe(true);
      expect(globalUser.user_level).toBe('viewer');
      // response reflects the effective (membership) values
      expect(result.is_active).toBe(false);
      expect(result.user_level).toBe('manager');
    });

    it('falls back to the global user row for a legacy user without a membership', async () => {
      const globalUser = {
        id: 'legacy-1', email: 'l@x.io', role: 'user', tenant_id: 'tenant-a',
        full_name: 'L', user_level: 'viewer', dept: null, is_active: true,
      };
      mockUserRepo.findOne.mockResolvedValue(globalUser);
      mockMembershipRepo.findOne.mockResolvedValue(null);
      mockUserRepo.save.mockImplementation(async (u: unknown) => u);

      const result = await service.updateUser('legacy-1', 'admin-1', 'admin', 'tenant-a', {
        is_active: false,
      });

      expect(mockUserRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'legacy-1', is_active: false }),
      );
      expect(mockMembershipRepo.save).not.toHaveBeenCalled();
      expect(result.is_active).toBe(false);
    });
  });

  describe('createUser cross-tenant guard (#4)', () => {
    it('blocks a tenant admin from attaching an email that exists in another tenant', async () => {
      // Existing user lives in tenant-b; caller is admin of tenant-a.
      mockUserRepo.findOne.mockResolvedValue({
        id: 'other-1', email: 'taken@x.io', full_name: 'Secret Name', tenant_id: 'tenant-b',
      });
      mockMembershipRepo.findOne.mockResolvedValue(null); // no membership in tenant-a

      await expect(
        service.createUser('admin-1', 'admin', 'tenant-a', {
          email: 'taken@x.io', full_name: 'New Person',
        }),
      ).rejects.toThrow('A user with this email already exists');
      // No mutation, no membership creation, no identity leak.
      expect(mockUserRepo.save).not.toHaveBeenCalled();
      expect(mockMembershipRepo.save).not.toHaveBeenCalled();
    });

    it('allows a tenant admin to re-invite an existing user in their own tenant', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'user-7', email: 'mine@x.io', full_name: 'Mine', tenant_id: 'tenant-a', role: 'user',
      });
      // Pre-existing membership in caller's tenant → legitimate re-invite.
      mockMembershipRepo.findOne.mockResolvedValue({
        id: 'm-user', user_id: 'user-7', tenant_id: 'tenant-a',
        role: 'viewer', user_level: 'viewer', is_active: false,
      });
      mockMembershipRepo.save.mockImplementation(async (m: unknown) => m);

      const result = await service.createUser('admin-1', 'admin', 'tenant-a', {
        email: 'mine@x.io', full_name: 'Mine',
      });

      expect(mockMembershipRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'm-user', is_active: true }),
      );
      expect(result.id).toBe('user-7');
      expect(result.membership_id).toBe('m-user');
    });

    it('allows a super admin to link an existing user into a new tenant', async () => {
      mockUserRepo.findOne.mockResolvedValue({
        id: 'other-1', email: 'taken@x.io', full_name: 'Linked', tenant_id: 'tenant-b', role: 'user',
      });
      // No membership in target tenant-a yet; super_admin bypasses the guard.
      mockMembershipRepo.findOne.mockResolvedValue(null);
      mockMembershipRepo.save.mockImplementation(async (m: unknown) => ({ id: 'm-new', ...(m as object) }));

      const result = await service.createUser('super-1', 'super_admin', 'tenant-b', {
        email: 'taken@x.io', full_name: 'Linked', tenantId: 'tenant-a',
      });

      expect(mockMembershipRepo.save).toHaveBeenCalled();
      expect(result.id).toBe('other-1');
    });
  });

  describe('createUser role-escalation defense (#5)', () => {
    it('blocks a tenant admin from creating a company_admin via body.role', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createUser('admin-1', 'admin', 'tenant-a', {
          email: 'new@x.io', full_name: 'New', role: 'admin',
        }),
      ).rejects.toThrow('Admins can only create user-role accounts');
      expect(mockUserRepo.save).not.toHaveBeenCalled();
    });

    it('does not escalate to company_admin when user_level carries a privileged value', async () => {
      // Simulate a tampered payload that bypassed DTO validation: user_level
      // holds 'company_admin'. It must NOT drive the role decision, and no
      // users row should be written before the guard runs.
      mockUserRepo.findOne.mockResolvedValue(null);
      mockUserRepo.save.mockImplementation(async (u: unknown) => ({ id: 'created-1', ...(u as object) }));
      mockMembershipRepo.findOne.mockResolvedValue(null);
      mockMembershipRepo.save.mockImplementation(async (m: unknown) => ({ id: 'm-new', ...(m as object) }));

      const result = await service.createUser('admin-1', 'admin', 'tenant-a', {
        email: 'new@x.io', full_name: 'New', user_level: 'company_admin' as never,
      });

      // Falls back to the least-privilege default ('viewer'), never company_admin.
      const savedMembership = (mockMembershipRepo.save as jest.Mock).mock.calls[0][0];
      expect(savedMembership.role).not.toBe('company_admin');
      expect(savedMembership.role).toBe('viewer');
      expect(result.id).toBe('created-1');
    });

    it('allows a super admin to create a company_admin', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);
      mockUserRepo.save.mockImplementation(async (u: unknown) => ({ id: 'created-2', ...(u as object) }));
      mockMembershipRepo.findOne.mockResolvedValue(null);
      mockMembershipRepo.save.mockImplementation(async (m: unknown) => ({ id: 'm-admin', ...(m as object) }));
      mockMembershipPermissionRepo.delete.mockResolvedValue({ affected: 0 });
      mockMembershipPermissionRepo.save.mockResolvedValue([]);

      const result = await service.createUser('super-1', 'super_admin', 'tenant-a', {
        email: 'admin@x.io', full_name: 'Admin', role: 'admin',
      });

      expect(mockMembershipRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'company_admin' }),
      );
      expect(result.id).toBe('created-2');
    });
  });
});
