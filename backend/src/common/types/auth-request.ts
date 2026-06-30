import type { Request } from 'express';

export interface RequestUser {
  sub: string;
  tenantId: string | null;
  membershipId?: string | null;
  role: string;
  jti: string;
  iat: number;
  exp: number;
  name: string;
  userLevel: string;
  mustChange: boolean;
  permissions?: string[];
}

export interface AuthenticatedRequest extends Request {
  user: RequestUser;
  tenantId?: string;
  tenantRole?: string | null;
  membershipId?: string | null;
  tenantScope?: 'single' | 'all';
  allowedTenantIds?: string[];
  requestId?: string;
}

/**
 * Resolved tenant scope for a request. For a normal/single-company request the
 * scope is 'single' and `tenantIds` holds exactly one id. For a super-admin
 * "All Companies" request the scope is 'all' and `tenantIds` holds every active
 * tenant id. Read queries always filter with `tenant_id = ANY($1)` using
 * `tenantIds`, so single and all behave through the same code path.
 */
export interface TenantScope {
  scope: 'single' | 'all';
  tenantId: string | null;
  tenantIds: string[];
  /** Cache-key namespace: 'single:<uuid>' or 'all'. */
  cacheKey: string;
}
