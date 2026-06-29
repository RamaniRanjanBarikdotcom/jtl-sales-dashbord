import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantIsolationGuard } from './tenant-isolation.guard';

function context(req: Record<string, unknown>, required: string[] = ['sales.view']) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
    required,
  } as any;
}

function reflector(required: string[] = ['sales.view']) {
  return {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === 'isPublic') return false;
      if (key === 'required_permissions') return required;
      return undefined;
    }),
  } as unknown as Reflector;
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    headers: { 'x-tenant-id': 'tenant-a' },
    params: {},
    query: {},
    body: {},
    originalUrl: '/sales/kpis',
    user: {
      sub: 'user-1',
      tenantId: 'jwt-tenant',
      role: 'user',
    },
    ...overrides,
  } as any;
}

describe('TenantIsolationGuard', () => {
  const tenantRepo = { findOne: jest.fn() };
  const membershipRepo = { findOne: jest.fn() };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    jest.clearAllMocks();
    tenantRepo.findOne.mockResolvedValue({ id: 'tenant-a' });
    membershipRepo.findOne.mockResolvedValue({ id: 'membership-1', role: 'viewer' });
  });

  function guard(required = ['sales.view']) {
    return new TenantIsolationGuard(
      reflector(required),
      tenantRepo as any,
      membershipRepo as any,
      audit as any,
    );
  }

  it('allows super admin to select any active tenant', async () => {
    const req = request({ user: { sub: 'super-1', role: 'super_admin', tenantId: null } });
    await expect(guard().canActivate(context(req))).resolves.toBe(true);
    expect(req.tenantId).toBe('tenant-a');
    expect(req.tenantRole).toBe('super_admin');
    expect(membershipRepo.findOne).not.toHaveBeenCalled();
  });

  it('allows a normal user to access an assigned tenant', async () => {
    const req = request();
    await expect(guard().canActivate(context(req))).resolves.toBe(true);
    expect(req.tenantId).toBe('tenant-a');
    expect(req.membershipId).toBe('membership-1');
  });

  it('blocks a normal user from an unassigned tenant', async () => {
    membershipRepo.findOne.mockResolvedValue(null);
    await expect(guard().canActivate(context(request()))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects missing x-tenant-id on protected routes', async () => {
    const req = request({ headers: {} });
    await expect(guard().canActivate(context(req))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks inactive membership', async () => {
    membershipRepo.findOne.mockResolvedValue(null);
    await expect(guard().canActivate(context(request()))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
