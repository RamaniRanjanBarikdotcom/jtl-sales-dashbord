import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { buildErrorPayload } from '../utils/error-response';
import { SystemLogsService } from '../../modules/system-logs/system-logs.service';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');
  constructor(private readonly systemLogs?: SystemLogsService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest<{
      method: string;
      url: string;
      headers: Record<string, unknown>;
      requestId?: string;
      correlationId?: string;
      tenantId?: string;
      user?: { sub?: string };
    }>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : {};
    const requestId =
      req.requestId ??
      req.headers['x-request-id']?.toString() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    if (status >= 500) {
      this.logger.error(
        `Server error [${requestId}] on ${req.method} ${req.url}: ${exception instanceof Error ? exception.message : 'unknown error'}`,
        exception instanceof Error ? exception.stack : '',
      );
      void this.systemLogs?.emit({
        tenantId: req.tenantId ?? null,
        source: 'backend',
        module: 'http',
        eventType: 'backend.request.failed',
        severity: 'error',
        status: String(status),
        message: 'A backend request failed',
        actorUserId: req.user?.sub,
        correlationId: req.correlationId ?? requestId,
        requestId,
        metadata: {
          method: req.method,
          path: req.url,
          exceptionType: exception instanceof Error ? exception.constructor.name : 'UnknownError',
          safeMessage: exception instanceof Error ? exception.message : 'Unknown error',
          stackTrace: exception instanceof Error ? exception.stack : undefined,
        },
      });
    } else if (status === 400) {
      void this.systemLogs?.emit({
        tenantId: req.tenantId ?? null,
        source: 'backend',
        module: 'validation',
        eventType: 'request.validation_rejected',
        severity: 'warning',
        status: String(status),
        message: 'A request failed validation',
        actorUserId: req.user?.sub,
        correlationId: req.correlationId ?? requestId,
        requestId,
        metadata: { method: req.method,path: req.url },
      });
    } else if (!(exception instanceof HttpException)) {
      this.logger.warn(
        `Unhandled non-http exception [${requestId}] on ${req.method} ${req.url}: ${exception instanceof Error ? exception.message : 'unknown error'}`,
      );
    }

    const message =
      typeof body === 'object' && body !== null
        ? (body as { message?: string | string[] }).message
        : body;
    const code =
      typeof body === 'object' && body !== null
        ? (body as { code?: string }).code
        : undefined;
    let details: unknown;
    if (typeof body === 'object' && body !== null) {
      const b = body as Record<string, unknown>;
      details = b.details ?? b.errors;
      if (details === undefined) {
        const extra = Object.fromEntries(
          Object.entries(b).filter(
            ([key]) => !['message', 'code', 'error', 'statusCode'].includes(key),
          ),
        );
        if (Object.keys(extra).length > 0) details = extra;
      }
    }

    res.status(status).json(
      buildErrorPayload({
        statusCode: status,
        requestId,
        path: req.url,
        code,
        message,
        details,
      }),
    );
  }
}
