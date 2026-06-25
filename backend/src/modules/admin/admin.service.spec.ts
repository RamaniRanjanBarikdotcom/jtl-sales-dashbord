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
});
