import { Test, TestingModule } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';
import { Tenant } from '../../entities/tenant.entity';
import { TenantConnection } from '../../entities/tenant-connection.entity';
import { SyncLog } from '../../entities/sync-log.entity';
import { SyncWatermark } from '../../entities/sync-watermark.entity';
import { SyncTrigger } from '../../entities/sync-trigger.entity';
import { CacheService } from '../../cache/cache.service';

const mockUserRepo = {
  find: jest.fn(),
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
const mockCache = {
  del: jest.fn(),
  getOrSet: jest.fn(),
} as unknown as CacheService;

describe('AdminService', () => {
  let service: AdminService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getRepositoryToken(User),             useValue: mockUserRepo },
        { provide: getRepositoryToken(Tenant),           useValue: mockTenantRepo },
        { provide: getRepositoryToken(TenantConnection), useValue: mockTenantConnRepo },
        { provide: getRepositoryToken(SyncLog),          useValue: mockSyncLogRepo },
        { provide: getRepositoryToken(SyncWatermark),    useValue: mockSyncWatermarkRepo },
        { provide: getRepositoryToken(SyncTrigger),      useValue: mockSyncTriggerRepo },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();
    service = module.get<AdminService>(AdminService);
    jest.clearAllMocks();
  });

  describe('getUsers', () => {
    it('scopes to own tenantId for admin role', async () => {
      mockUserRepo.find.mockResolvedValue([]);
      await service.getUsers('admin', 'tenant-abc', undefined);
      expect(mockUserRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenant_id: 'tenant-abc' }) })
      );
    });

    it('returns all tenants for super_admin', async () => {
      mockUserRepo.find.mockResolvedValue([]);
      await service.getUsers('super_admin', 'tenant-abc', undefined);
      // super_admin should not filter by tenant_id
      const call = mockUserRepo.find.mock.calls[0][0];
      expect(call?.where?.tenant_id).toBeUndefined();
    });
  });
});
