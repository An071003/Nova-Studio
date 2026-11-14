import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Controller, Get, HttpCode, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import Redis from 'ioredis';
import { getApiEnv } from '../common/env';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async check(@Res() res: Response): Promise<void> {
    const env = getApiEnv();
    const checks: Record<'db' | 'redis' | 's3', 'up' | 'down'> = {
      db: 'down',
      redis: 'down',
      s3: 'down',
    };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.db = 'up';
    } catch {
      checks.db = 'down';
    }

    const redis = new Redis(env.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
    try {
      await redis.connect();
      const pong = await redis.ping();
      if (pong === 'PONG') {
        checks.redis = 'up';
      }
    } catch {
      checks.redis = 'down';
    } finally {
      redis.disconnect();
    }

    const s3 = new S3Client({
      endpoint: env.s3Endpoint,
      region: env.s3Region,
      forcePathStyle: env.s3ForcePathStyle,
      credentials: {
        accessKeyId: env.s3AccessKey,
        secretAccessKey: env.s3SecretKey,
      },
    });
    try {
      await s3.send(new HeadBucketCommand({ Bucket: env.s3Bucket }));
      checks.s3 = 'up';
    } catch {
      checks.s3 = 'down';
    } finally {
      s3.destroy();
    }

    const allUp = checks.db === 'up' && checks.redis === 'up' && checks.s3 === 'up';
    res.status(allUp ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      status: allUp ? 'ok' : 'degraded',
      checks,
    });
  }
}
