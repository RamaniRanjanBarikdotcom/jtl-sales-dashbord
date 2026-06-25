import { HttpStatus } from '@nestjs/common';

export type StandardErrorPayload = {
  success: false;
  error: string;
  message: string;
  code: string;
  statusCode: number;
  requestId: string;
  timestamp: string;
  path?: string;
  details?: unknown;
};

const STATUS_CODE_MAP: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_ERROR',
};

function toErrorMessage(raw: unknown, fallback: string): string {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => (typeof v === 'string' ? v : ''))
      .filter((v) => v.length > 0)
      .join(', ') || fallback;
  }
  if (typeof raw === 'string' && raw.trim().length > 0) return raw;
  return fallback;
}

export function buildErrorPayload(params: {
  statusCode: number;
  requestId: string;
  path?: string;
  code?: string;
  message?: unknown;
  details?: unknown;
}): StandardErrorPayload {
  const statusCode = params.statusCode;
  const isServerError = statusCode >= 500;
  const fallback = isServerError ? 'Internal server error' : 'Request failed';
  const safeMessage = isServerError
    ? 'Internal server error'
    : toErrorMessage(params.message, fallback);
  const safeCode =
    (isServerError
      ? 'INTERNAL_ERROR'
      : (typeof params.code === 'string' && params.code.trim().length > 0 ? params.code : undefined)) ||
    STATUS_CODE_MAP[statusCode] ||
    'REQUEST_FAILED';

  return {
    success: false,
    error: safeMessage,
    message: safeMessage,
    code: safeCode,
    statusCode,
    requestId: params.requestId,
    timestamp: new Date().toISOString(),
    ...(params.path ? { path: params.path } : {}),
    ...(!isServerError && params.details !== undefined ? { details: params.details } : {}),
  };
}
