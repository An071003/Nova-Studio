import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { getApiEnv } from './common/env';
import { NovaExceptionFilter } from './common/nova-exception.filter';

export function configureApp(app: INestApplication): void {
  const env = getApiEnv();
  app.setGlobalPrefix('api/v1');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'http:', 'https:'],
          connectSrc: ["'self'", 'ws:', 'wss:', 'http:', 'https:'],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(cookieParser());
  app.enableCors({
    origin: env.corsOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  });
  app.useGlobalFilters(new NovaExceptionFilter());
}
