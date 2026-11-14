import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { getApiEnv } from './common/env';
import { logger } from './common/logger';

async function bootstrap(): Promise<void> {
  const env = getApiEnv();
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(env.port);
  logger.info({ port: env.port }, 'NOVA API listening');
}

void bootstrap();
