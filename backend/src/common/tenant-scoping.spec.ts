import { AdminController } from '../modules/admin/admin.controller';
import { SyncController } from '../modules/admin/sync.controller';
import { AnalyticsController } from '../modules/analytics/analytics.controller';
import { CustomersController } from '../modules/customers/customers.controller';
import { InventoryController } from '../modules/inventory/inventory.controller';
import { ProductsController } from '../modules/products/products.controller';
import { SalesController } from '../modules/sales/sales.controller';
import { TenantContextService } from './tenant-context.service';
import { AuthenticatedRequest } from './types/auth-request';

function request(): AuthenticatedRequest {
  return {
    user: {
      sub: 'super-1',
      tenantId: 'jwt-tenant',
      role: 'super_admin',
      jti: 'jti',
      iat: 1,
      exp: 9999999999,
      name: 'Super',
      userLevel: 'manager',
      mustChange: false,
      permissions: [],
    },
    query: { tenantId: 'selected-tenant' },
    headers: { 'x-tenant-id': 'selected-tenant' },
  } as unknown as AuthenticatedRequest;
}

const SINGLE_SCOPE = {
  scope: 'single' as const,
  tenantId: 'selected-tenant',
  tenantIds: ['selected-tenant'],
  cacheKey: 'single:selected-tenant',
};

function tenantContext() {
  return {
    resolve: jest.fn().mockResolvedValue('selected-tenant'),
    resolveScope: jest.fn().mockResolvedValue(SINGLE_SCOPE),
  } as unknown as TenantContextService;
}

describe('tenant-scoped controllers', () => {
  it('scopes analytics through TenantContextService', async () => {
    const service = { getRevenueTrend: jest.fn().mockResolvedValue([]) };
    const context = tenantContext();
    const controller = new AnalyticsController(service as any, context);

    await controller.getRevenueTrend({} as any, request());

    expect(context.resolveScope).toHaveBeenCalledWith(expect.any(Object));
    expect(service.getRevenueTrend).toHaveBeenCalledWith(
      SINGLE_SCOPE,
      expect.any(Object),
      'super_admin',
      'manager',
    );
  });

  it('scopes sales through TenantContextService', async () => {
    const service = { getKpis: jest.fn().mockResolvedValue({}) };
    const context = tenantContext();
    const controller = new SalesController(service as any, context);

    await controller.getKpis({} as any, request());

    expect(context.resolveScope).toHaveBeenCalledWith(expect.any(Object));
    expect(service.getKpis).toHaveBeenCalledWith(
      SINGLE_SCOPE,
      expect.any(Object),
      'super_admin',
      'manager',
    );
  });

  it('scopes products through TenantContextService', async () => {
    const service = { getKpis: jest.fn().mockResolvedValue({}) };
    const context = tenantContext();
    const controller = new ProductsController(service as any, context);

    await controller.getKpis({} as any, request());

    expect(context.resolveScope).toHaveBeenCalledWith(expect.any(Object));
    expect(service.getKpis).toHaveBeenCalledWith(
      SINGLE_SCOPE,
      expect.any(Object),
      'super_admin',
      'manager',
    );
  });

  it('scopes customers through TenantContextService', async () => {
    const service = { getKpis: jest.fn().mockResolvedValue({}) };
    const context = tenantContext();
    const controller = new CustomersController(service as any, context);

    await controller.kpis(request(), {} as any);

    expect(context.resolveScope).toHaveBeenCalledWith(expect.any(Object));
    expect(service.getKpis).toHaveBeenCalledWith(SINGLE_SCOPE, expect.any(Object));
  });

  it('scopes inventory through TenantContextService', async () => {
    const service = { getKpis: jest.fn().mockResolvedValue({}) };
    const context = tenantContext();
    const controller = new InventoryController(service as any, context);

    await controller.getKpis(request());

    expect(context.resolveScope).toHaveBeenCalledWith(expect.any(Object));
    expect(service.getKpis).toHaveBeenCalledWith(SINGLE_SCOPE);
  });

  it('scopes sync through TenantContextService', async () => {
    const service = { getSyncStatus: jest.fn().mockResolvedValue({}) };
    const context = tenantContext();
    const controller = new SyncController(service as any, context);

    await controller.getStatus(request(), 'selected-tenant');

    expect(context.resolve).toHaveBeenCalledWith(expect.any(Object), 'selected-tenant');
    expect(service.getSyncStatus).toHaveBeenCalledWith('selected-tenant');
  });

  it('scopes admin user management through TenantContextService', async () => {
    const service = { getUsers: jest.fn().mockResolvedValue([]) };
    const context = tenantContext();
    const controller = new AdminController(service as any, context);

    await controller.getUsers(request(), { tenantId: 'selected-tenant', page: 1, limit: 25 });

    expect(context.resolve).toHaveBeenCalledWith(expect.any(Object), 'selected-tenant');
    expect(service.getUsers).toHaveBeenCalledWith(
      'super_admin',
      'selected-tenant',
      'selected-tenant',
      1,
      25,
    );
  });
});
