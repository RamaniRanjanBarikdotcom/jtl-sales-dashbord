import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      exception instanceof HttpException ? exception.getResponse() : {};
    const message =
      typeof body === 'object' ? (body as any).message : body;

    res.status(status).json({
      success: false,
      error: message || 'Internal server error',
      code: typeof body === 'object' ? (body as any).code : undefined,
      statusCode: status,
    });
  }
}
