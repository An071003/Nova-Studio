import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { getApiEnv } from './common/env';
import { NovaExceptionFilter } from './common/nova-exception.filter';

export function configureApp(app: INestApplication): void {
  const env = getApiEnv();
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: env.corsOrigins,
    credentials: true,
  });
  app.useGlobalFilters(new NovaExceptionFilter());
}
