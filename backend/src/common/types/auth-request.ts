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
}

export interface AuthenticatedRequest extends Request {
  user: RequestUser;
  requestId?: string;
}
