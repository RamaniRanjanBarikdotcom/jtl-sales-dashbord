import {
  DEFAULT_USER_MANAGER_PERMISSIONS,
  PERMISSION_PRESETS,
  PERMISSIONS,
} from './permission-keys';

describe('analytics export permission defaults', () => {
  const analyticsExports = [
    PERMISSIONS.SALES_EXPORT,
    PERMISSIONS.PRODUCTS_EXPORT,
    PERMISSIONS.INVENTORY_EXPORT,
    PERMISSIONS.CUSTOMERS_EXPORT,
    PERMISSIONS.COMPARISON_EXPORT,
  ];

  it('grants tenant managers all supported analytics exports', () => {
    expect(DEFAULT_USER_MANAGER_PERMISSIONS).toEqual(expect.arrayContaining(analyticsExports));
  });

  it('grants company administrators comparison and module exports', () => {
    expect(PERMISSION_PRESETS.COMPANY_ADMIN).toEqual(expect.arrayContaining([
      ...analyticsExports,
      PERMISSIONS.COMPARISON_VIEW,
      PERMISSIONS.COMPARISON_SALES_VIEW,
      PERMISSIONS.COMPARISON_PRODUCTS_VIEW,
      PERMISSIONS.COMPARISON_INVENTORY_VIEW,
      PERMISSIONS.COMPARISON_CUSTOMERS_VIEW,
    ]));
  });
});
