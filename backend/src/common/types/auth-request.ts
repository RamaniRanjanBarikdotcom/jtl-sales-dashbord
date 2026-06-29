import type { Request } from 'express';

export interface RequestUser {
  sub: string;
  tenantId: string;
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
  requestId?: string;
}
