import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as helmet from 'helmet';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID } from 'crypto';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';
import { buildErrorPayload } from './common/utils/error-response';

const logger = new Logger('Bootstrap');
type RequestWithId = Request & { requestId?: string };

function computeJsonDepth(value: unknown, current = 0): number {
  if (value == null || typeof value !== 'object') return current;
  if (Array.isArray(value)) {
    if (value.length === 0) return current + 1;
    return Math.max(...value.map((v) => computeJsonDepth(v, current + 1)));
  }
  const obj = value as Record<string, unknown>;
  const vals = Object.values(obj);
  if (vals.length === 0) return current + 1;
  return Math.max(...vals.map((v) => computeJsonDepth(v, current + 1)));
}

function isAllowedNgrokHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    /^[a-z0-9-]+\.ngrok-free\.(app|dev)$/.test(host) ||
    /^[a-z0-9-]+\.ngrok\.io$/.test(host)
  );
}

function isWeakSecret(value: string | undefined): boolean {
  if (!value) return true;
  if (value.trim().length < 8) return true;
  return false;
}

function assertProductionSecrets() {
  if ((process.env.NODE_ENV || '').toLowerCase() !== 'production') return;
  const weakVars = [
    ['PG_PASSWORD', process.env.PG_PASSWORD],
    ['REDIS_PASSWORD', process.env.REDIS_PASSWORD],
    ['JWT_ACCESS_SECRET', process.env.JWT_ACCESS_SECRET],
    ['JWT_REFRESH_SECRET', process.env.JWT_REFRESH_SECRET],
  ].filter(([, value]) => isWeakSecret(value as string | undefined));

  if (weakVars.length > 0) {
    const names = weakVars.map(([name]) => name).join(', ');
    throw new Error(
      `Refusing to start in production with weak/missing secrets: ${names}. ` +
      'Generate new values with `npm run secrets:generate`.',
    );
  }
}

async function bootstrap() {
  assertProductionSecrets();
  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
  });
  app.enableShutdownHooks();

  // Backward-compatible API version alias:
  // /api/v1/... -> /api/...
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.url === '/api/v1') {
      req.url = '/api';
    } else if (req.url.startsWith('/api/v1/')) {
      req.url = `/api/${req.url.slice('/api/v1/'.length)}`;
    }
    next();
  });

  const bodyLimit = process.env.BODY_LIMIT || '10mb';
  app.use(require('express').json({ limit: bodyLimit }));
  app.use(require('express').urlencoded({ limit: bodyLimit, extended: true }));

  const maxJsonDepth = Number.parseInt(process.env.JSON_MAX_DEPTH || '12', 10);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    (req as RequestWithId).requestId = requestId;
    res.setHeader('x-request-id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.on('finish', () => {
      const duration = Date.now() - startedAt;
      logger.log(
        JSON.stringify({
          type: 'http_request',
          request_id: requestId,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          duration_ms: duration,
          ip: req.ip,
          user_agent: req.headers['user-agent'] ?? '',
        }),
      );
    });

    if (req.body && typeof req.body === 'object') {
      const depth = computeJsonDepth(req.body);
      if (depth > maxJsonDepth) {
        return res.status(400).json(
          buildErrorPayload({
            statusCode: 400,
            requestId,
            path: req.originalUrl,
            code: 'JSON_DEPTH_EXCEEDED',
            message: `JSON payload exceeds max depth of ${maxJsonDepth}`,
          }),
        );
      }
    }

    return next();
  });

  const helmetFactory = helmet as unknown as
    ((...args: unknown[]) => RequestHandler) & { default?: (...args: unknown[]) => RequestHandler };
  app.use((helmetFactory.default ?? helmetFactory)());
  app.use(compression());
  app.use(cookieParser());
  const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'http://localhost',
    'http://localhost:80',
    'http://127.0.0.1',
  ];

  const isAllowedOrigin = (origin: string): boolean => {
    if (allowedOrigins.includes(origin)) return true;
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol)) return false;
      if (isAllowedNgrokHost(parsed.hostname)) return true;
    } catch {
      return false;
    }
    return false;
  };

  // CSRF protection for cookie-authenticated requests:
  // if a mutating request includes refresh-token cookie, enforce same-origin origin/referer.
  // Exempt auth endpoints — they authenticate via credentials/token, not cookies.
  const CSRF_EXEMPT = ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout'];
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (CSRF_EXEMPT.some(p => req.path === p || req.originalUrl === p)) return next();
    const hasRefreshCookie = Boolean(
      (req as Request & { cookies?: Record<string, string> }).cookies?.refresh_token,
    );
    if (!hasRefreshCookie) return next();
    const csrfCookie =
      (req as Request & { cookies?: Record<string, string> }).cookies?.['XSRF-TOKEN'] || '';
    const csrfHeader = String(req.headers['x-csrf-token'] || '').trim();
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      const requestId = (req as RequestWithId).requestId || randomUUID();
      return res.status(403).json(
        buildErrorPayload({
          statusCode: 403,
          requestId,
          path: req.originalUrl,
          code: 'CSRF_TOKEN_INVALID',
          message: 'CSRF token mismatch',
        }),
      );
    }

    const origin = req.headers.origin as string | undefined;
    let sourceOrigin = origin;
    if (!sourceOrigin) {
      const referer = req.headers.referer as string | undefined;
      if (referer) {
        try {
          sourceOrigin = new URL(referer).origin;
        } catch {
          sourceOrigin = undefined;
        }
      }
    }

    if (!sourceOrigin || !isAllowedOrigin(sourceOrigin)) {
      const requestId = (req as RequestWithId).requestId || randomUUID();
      return res.status(403).json(
        buildErrorPayload({
          statusCode: 403,
          requestId,
          path: req.originalUrl,
          code: 'CSRF_BLOCKED',
          message: 'CSRF validation failed',
        }),
      );
    }
    return next();
  });

  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      // allow requests with no origin (curl, mobile apps, server-to-server)
      if (!origin) return cb(null, true);
      if (isAllowedOrigin(origin)) return cb(null, true);
      cb(null, false);
    },
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'x-api-version', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
    maxAge: 86400,
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseTransformInterceptor());
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.HEADER,
    header: 'x-api-version',
    defaultVersion: '1',
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('JTL Analytics API')
    .setDescription('API docs for backend services, sync ingest, and dashboard data')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const swaggerDoc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDoc);

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  logger.log(`Backend running on http://localhost:${port}/api`);

  const shutdown = async (signal: NodeJS.Signals) => {
    logger.warn(`Received ${signal}, shutting down gracefully...`);
    await app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
}
bootstrap();
