import type { Request } from 'express';

export interface RequestUser {
  sub: string;
  tenantId: string;
  role: string;
  jti: string;
  exp: number;
  name: string;
  userLevel: string;
  mustChange: boolean;
  permissions?: string[];
}

export interface AuthenticatedRequest extends Request {
  user: RequestUser;
  requestId?: string;
}
