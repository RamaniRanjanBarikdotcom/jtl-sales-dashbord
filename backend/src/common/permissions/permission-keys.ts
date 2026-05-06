export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard.view',
  SALES_VIEW: 'sales.view',
  SALES_EXPORT: 'sales.export',
  PRODUCTS_VIEW: 'products.view',
  PRODUCTS_EXPORT: 'products.export',
  INVENTORY_VIEW: 'inventory.view',
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_EXPORT: 'customers.export',
  SYNC_VIEW: 'sync.view',
  SYNC_MANAGE: 'sync.manage',
  USERS_VIEW: 'users.view',
  USERS_CREATE: 'users.create',
  USERS_UPDATE: 'users.update',
  USERS_DELETE: 'users.delete',
  ROLES_MANAGE: 'roles.manage',
  ADMIN_MANAGE: 'admin.manage',
  SETTINGS_MANAGE: 'settings.manage',
  AUDIT_VIEW: 'audit.view',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_CATALOG: Array<{ key: PermissionKey; description: string }> = [
  { key: PERMISSIONS.DASHBOARD_VIEW, description: 'View dashboard shell and overview' },
  { key: PERMISSIONS.SALES_VIEW, description: 'View sales analytics pages and APIs' },
  { key: PERMISSIONS.SALES_EXPORT, description: 'Export sales analytics data' },
  { key: PERMISSIONS.PRODUCTS_VIEW, description: 'View product analytics pages and APIs' },
  { key: PERMISSIONS.PRODUCTS_EXPORT, description: 'Export product analytics data' },
  { key: PERMISSIONS.INVENTORY_VIEW, description: 'View inventory analytics pages and APIs' },
  { key: PERMISSIONS.CUSTOMERS_VIEW, description: 'View customer analytics pages and APIs' },
  { key: PERMISSIONS.CUSTOMERS_EXPORT, description: 'Export customer analytics data' },
  { key: PERMISSIONS.SYNC_VIEW, description: 'View sync status and logs' },
  { key: PERMISSIONS.SYNC_MANAGE, description: 'Trigger sync and rotate sync key' },
  { key: PERMISSIONS.USERS_VIEW, description: 'View tenant users' },
  { key: PERMISSIONS.USERS_CREATE, description: 'Create tenant users' },
  { key: PERMISSIONS.USERS_UPDATE, description: 'Update tenant users' },
  { key: PERMISSIONS.USERS_DELETE, description: 'Deactivate tenant users' },
  { key: PERMISSIONS.ROLES_MANAGE, description: 'Grant and revoke user permissions' },
  { key: PERMISSIONS.ADMIN_MANAGE, description: 'Manage tenants, admins and platform configuration' },
  { key: PERMISSIONS.SETTINGS_MANAGE, description: 'Access and update account settings' },
  { key: PERMISSIONS.AUDIT_VIEW, description: 'View security and audit trails' },
];

export const DEFAULT_ADMIN_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.SALES_VIEW,
  PERMISSIONS.SALES_EXPORT,
  PERMISSIONS.PRODUCTS_VIEW,
  PERMISSIONS.PRODUCTS_EXPORT,
  PERMISSIONS.INVENTORY_VIEW,
  PERMISSIONS.CUSTOMERS_VIEW,
  PERMISSIONS.CUSTOMERS_EXPORT,
  PERMISSIONS.SYNC_VIEW,
  PERMISSIONS.SYNC_MANAGE,
  PERMISSIONS.USERS_VIEW,
  PERMISSIONS.USERS_CREATE,
  PERMISSIONS.USERS_UPDATE,
  PERMISSIONS.USERS_DELETE,
  PERMISSIONS.ROLES_MANAGE,
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.AUDIT_VIEW,
];

export const DEFAULT_USER_VIEWER_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.SALES_VIEW,
  PERMISSIONS.PRODUCTS_VIEW,
  PERMISSIONS.INVENTORY_VIEW,
  PERMISSIONS.CUSTOMERS_VIEW,
  PERMISSIONS.SETTINGS_MANAGE,
];

export const DEFAULT_USER_ANALYST_PERMISSIONS: PermissionKey[] = [
  ...DEFAULT_USER_VIEWER_PERMISSIONS,
  PERMISSIONS.SYNC_VIEW,
];

export const DEFAULT_USER_MANAGER_PERMISSIONS: PermissionKey[] = [
  ...DEFAULT_USER_ANALYST_PERMISSIONS,
  PERMISSIONS.PRODUCTS_EXPORT,
  PERMISSIONS.CUSTOMERS_EXPORT,
];

