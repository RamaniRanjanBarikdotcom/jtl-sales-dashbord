import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';

function reflector(required = ['sales.view']) {
  return {
    getAllAndOverride: jest.fn((key: string) => key === 'required_permissions' ? required : undefined),
  } as unknown as Reflector;
}

function context(req: Record<string, unknown>, required = ['sales.view']) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
    required,
  } as any;
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    originalUrl: '/sales/kpis',
    tenantId: 'tenant-a',
    membershipId: 'membership-1',
    user: {
      sub: 'user-1',
      tenantId: 'jwt-tenant',
      role: 'user',
    },
    ...overrides,
  } as any;
}

describe('PermissionsGuard', () => {
  const permissions = { canMembershipAccess: jest.fn() };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    jest.clearAllMocks();
    permissions.canMembershipAccess.mockResolvedValue(true);
  });

  function guard(required = ['sales.view']) {
    return new PermissionsGuard(reflector(required), permissions as any, audit as any);
  }

  it('allows a user with sales.view from membership permissions', async () => {
    await expect(guard().canActivate(context(request()))).resolves.toBe(true);
    expect(permissions.canMembershipAccess).toHaveBeenCalledWith(
      'membership-1',
      'tenant-a',
      'user-1',
      ['sales.view'],
    );
  });

  it('blocks a user without sales.view from membership permissions', async () => {
    permissions.canMembershipAccess.mockResolvedValue(false);
    await expect(guard().canActivate(context(request()))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects protected routes when tenant context is missing', async () => {
    await expect(
      guard().canActivate(context(request({ tenantId: undefined }))),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(permissions.canMembershipAccess).not.toHaveBeenCalled();
  });

  it('uses fresh DB membership permissions on every request', async () => {
    permissions.canMembershipAccess.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(guard().canActivate(context(request()))).resolves.toBe(true);
    await expect(guard().canActivate(context(request()))).rejects.toBeInstanceOf(ForbiddenException);
    expect(permissions.canMembershipAccess).toHaveBeenCalledTimes(2);
  });
});
