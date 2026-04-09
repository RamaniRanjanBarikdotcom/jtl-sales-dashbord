import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as helmet from 'helmet';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
  });
  // Increase body size limit — order batches with embedded items can be several MB
  app.use(require('express').json({ limit: '50mb' }));
  app.use(require('express').urlencoded({ limit: '50mb', extended: true }));

  app.use((helmet as any).default ? (helmet as any).default() : (helmet as any)());
  app.use(compression());
  app.use(cookieParser());
  const allowedOrigins = [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'http://localhost',
    'http://localhost:80',
    'http://127.0.0.1',
  ];
  app.enableCors({
    origin: (origin, cb) => {
      // allow requests with no origin (curl, mobile apps, server-to-server)
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      // allow ngrok tunnels
      if (/https?:\/\/[^.]+\.ngrok(-free)?\.app$/.test(origin)) return cb(null, true);
      if (/https?:\/\/[^.]+\.ngrok\.io$/.test(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseTransformInterceptor());
  app.setGlobalPrefix('api');

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`Backend running on http://localhost:${port}/api`);
}
bootstrap();
