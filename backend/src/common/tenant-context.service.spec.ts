import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { Tenant } from '../entities/tenant.entity';
import { UserTenantMembership } from '../entities/user-tenant-membership.entity';
import { TenantContextService } from './tenant-context.service';
import { AuthenticatedRequest } from './types/auth-request';

const tenantRepo = {
  findOne: jest.fn(),
};

const membershipRepo = {
  findOne: jest.fn(),
};

function req(user: Partial<AuthenticatedRequest['user']>, extras: Partial<AuthenticatedRequest> = {}) {
  return {
    query: {},
    body: {},
    ...extras,
    user: {
      sub: 'user-1',
      tenantId: 'tenant-a',
      role: 'user',
      jti: 'jti',
      iat: 1,
      exp: 9999999999,
      name: 'User',
      userLevel: 'viewer',
      mustChange: false,
      ...user,
    },
  } as AuthenticatedRequest;
}

describe('TenantContextService', () => {
  let service: TenantContextService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TenantContextService,
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: getRepositoryToken(UserTenantMembership), useValue: membershipRepo },
      ],
    }).compile();
    service = module.get(TenantContextService);
    jest.clearAllMocks();
    tenantRepo.findOne.mockResolvedValue({ id: 'tenant-a' });
    membershipRepo.findOne.mockResolvedValue({ id: 'membership-1' });
  });

  it('allows normal users to resolve their active tenant', async () => {
    await expect(service.resolve(req({}), 'tenant-a')).resolves.toBe('tenant-a');
    expect(membershipRepo.findOne).toHaveBeenCalledWith({
      where: { user_id: 'user-1', tenant_id: 'tenant-a', is_active: true },
    });
  });

  it('allows normal users to resolve any assigned tenant', async () => {
    tenantRepo.findOne.mockResolvedValue({ id: 'tenant-b' });
    await expect(service.resolve(req({}), 'tenant-b')).resolves.toBe('tenant-b');
    expect(membershipRepo.findOne).toHaveBeenCalledWith({
      where: { user_id: 'user-1', tenant_id: 'tenant-b', is_active: true },
    });
  });

  it('blocks normal users from requesting an unassigned tenant', async () => {
    membershipRepo.findOne.mockResolvedValue(null);
    await expect(service.resolve(req({}), 'tenant-b')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows super_admin to select any active tenant', async () => {
    tenantRepo.findOne.mockResolvedValue({ id: 'tenant-b' });
    await expect(service.resolve(req({ role: 'super_admin', tenantId: null as any }), 'tenant-b')).resolves.toBe('tenant-b');
  });

  it('resolves x-tenant-id header for selected company context', async () => {
    await expect(
      service.resolve(req({}, { headers: { 'x-tenant-id': 'tenant-a' } } as any)),
    ).resolves.toBe('tenant-a');
  });

  it('blocks inactive tenants', async () => {
    tenantRepo.findOne.mockResolvedValue(null);
    await expect(service.resolve(req({}), 'tenant-a')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects single-tenant resolve() when the all-company scope header is present', async () => {
    const request = req(
      { role: 'super_admin', tenantId: null as any },
      { headers: { 'x-tenant-scope': 'all' } } as any,
    );
    await expect(service.resolve(request)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resolveScope returns an all-company scope when the guard set tenantScope=all', async () => {
    const request = req(
      { role: 'super_admin', tenantId: null as any },
      { tenantScope: 'all', allowedTenantIds: ['tenant-a', 'tenant-b'] } as any,
    );
    await expect(service.resolveScope(request)).resolves.toEqual({
      scope: 'all',
      tenantId: null,
      tenantIds: ['tenant-a', 'tenant-b'],
      cacheKey: 'all',
    });
  });

  it('resolveScope returns a single-tenant scope for a normal user', async () => {
    await expect(service.resolveScope(req({}), 'tenant-a')).resolves.toEqual({
      scope: 'single',
      tenantId: 'tenant-a',
      tenantIds: ['tenant-a'],
      cacheKey: 'single:tenant-a',
    });
  });
});
