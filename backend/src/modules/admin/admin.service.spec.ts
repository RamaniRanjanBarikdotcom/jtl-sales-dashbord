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
import { CacheService } from '../../cache/cache.service';
import { AuditService } from '../../common/audit/audit.service';

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
        { provide: CacheService,  useValue: mockCache },
        { provide: DataSource,    useValue: mockDataSource },
        { provide: AuditService,  useValue: mockAudit },
      ],
    }).compile();
    service = module.get<AdminService>(AdminService);
    jest.clearAllMocks();
  });

  describe('getUsers', () => {
    it('scopes to own tenantId for admin role', async () => {
      mockUserRepo.findAndCount.mockResolvedValue([[], 0]);
      await service.getUsers('admin', 'tenant-abc', undefined);
      expect(mockUserRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenant_id: 'tenant-abc' }) })
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
});
