import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { buildErrorPayload } from '../utils/error-response';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest<{ method: string; url: string; headers: Record<string, unknown>; requestId?: string }>();
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
