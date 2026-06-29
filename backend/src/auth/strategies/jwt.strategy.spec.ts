import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

function repo() {
  return { findOne: jest.fn() };
}

function strategy(overrides: Record<string, any> = {}) {
  const revokedRepo = overrides.revokedRepo ?? repo();
  const userRepo = overrides.userRepo ?? repo();
  const tenantRepo = overrides.tenantRepo ?? repo();
  const membershipRepo = overrides.membershipRepo ?? repo();
  const membershipPermissionRepo = overrides.membershipPermissionRepo ?? { find: jest.fn() };
  const instance = new JwtStrategy(
    { getOrThrow: jest.fn().mockReturnValue('test-secret') } as any,
    revokedRepo as any,
    userRepo as any,
    tenantRepo as any,
    membershipRepo as any,
    membershipPermissionRepo as any,
  );
  return { instance, revokedRepo, userRepo, tenantRepo, membershipRepo, membershipPermissionRepo };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'user-1',
    tenantId: 'selected-tenant',
    membershipId: null,
    role: 'user',
    userLevel: 'viewer',
    name: 'User',
    jti: 'jti-1',
    iat: 100,
    exp: 9999999999,
    mustChange: false,
    permissions: ['legacy.jwt.permission'],
    ...overrides,
  } as any;
}

describe('JwtStrategy', () => {
  it('keeps selected token tenant and returns only selected membership permissions', async () => {
    const { instance, revokedRepo, userRepo, tenantRepo, membershipRepo, membershipPermissionRepo } = strategy();
    revokedRepo.findOne.mockResolvedValue(null);
    userRepo.findOne.mockResolvedValue({ id: 'user-1', role: 'user', tenant_id: 'old-tenant' });
    membershipRepo.findOne.mockResolvedValue({
      id: 'membership-1',
      user_id: 'user-1',
      tenant_id: 'selected-tenant',
      role: 'viewer',
      user_level: 'viewer',
    });
    membershipPermissionRepo.find.mockResolvedValue([
      { permission_key: 'sales.view' },
    ]);
    tenantRepo.findOne.mockResolvedValue({ id: 'selected-tenant' });

    const result = await instance.validate(payload());

    expect(result.tenantId).toBe('selected-tenant');
    expect(result.membershipId).toBe('membership-1');
    expect(result.permissions).toEqual(['sales.view']);
    expect(membershipRepo.findOne).toHaveBeenCalledWith({
      where: { user_id: 'user-1', tenant_id: 'selected-tenant', is_active: true },
    });
    expect(tenantRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'selected-tenant', is_active: true },
      select: { id: true },
    });
    expect(membershipPermissionRepo.find).toHaveBeenCalledWith({
      where: { membership_id: 'membership-1' },
      select: { permission_key: true },
    });
  });

  it('rejects normal-user tokens without an active selected membership', async () => {
    const { instance, revokedRepo, userRepo } = strategy();
    revokedRepo.findOne.mockResolvedValue(null);
    userRepo.findOne.mockResolvedValue({ id: 'user-1', role: 'user', tenant_id: 'old-tenant' });

    await expect(
      instance.validate(payload({ tenantId: null, membershipId: null })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects membership tokens that do not match the selected tenant', async () => {
    const { instance, revokedRepo, userRepo, membershipRepo } = strategy();
    revokedRepo.findOne.mockResolvedValue(null);
    userRepo.findOne.mockResolvedValue({ id: 'user-1', role: 'user' });
    membershipRepo.findOne.mockResolvedValue({
      id: 'membership-1',
      user_id: 'user-1',
      tenant_id: 'other-tenant',
      role: 'viewer',
      user_level: 'viewer',
    });

    await expect(
      instance.validate(payload({ membershipId: 'membership-1' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns wildcard UI permissions only for super admin', async () => {
    const { instance, revokedRepo, userRepo, tenantRepo } = strategy();
    revokedRepo.findOne.mockResolvedValue(null);
    userRepo.findOne.mockResolvedValue({ id: 'super-1', role: 'super_admin', tenant_id: 'old-tenant' });
    tenantRepo.findOne.mockResolvedValue({ id: 'selected-tenant' });

    const result = await instance.validate(payload({ sub: 'super-1', role: 'super_admin' }));

    expect(result.tenantId).toBe('selected-tenant');
    expect(result.permissions).toEqual(['*']);
  });
});
