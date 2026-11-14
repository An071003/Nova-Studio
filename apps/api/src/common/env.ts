import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

export interface ApiEnv {
  nodeEnv: string;
  port: number;
  webUrl: string;
  apiUrl: string;
  realtimeUrl: string;
  databaseUrl: string;
  redisUrl: string;
  s3Endpoint: string;
  s3PublicEndpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3ForcePathStyle: boolean;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  realtimeJwtSecret: string;
  corsOrigins: string[];
}

export function getApiEnv(): ApiEnv {
  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 4000),
    webUrl: process.env.WEB_URL ?? 'http://localhost:3000',
    apiUrl: process.env.API_URL ?? 'http://localhost:4000',
    realtimeUrl: process.env.REALTIME_URL ?? 'ws://localhost:4001',
    databaseUrl: process.env.DATABASE_URL ?? 'postgresql://nova:nova@localhost:5432/nova',
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
    s3Endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    s3PublicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    s3Region: process.env.S3_REGION ?? 'us-east-1',
    s3Bucket: process.env.S3_BUCKET ?? 'nova-assets',
    s3AccessKey: process.env.S3_ACCESS_KEY ?? 'minio',
    s3SecretKey: process.env.S3_SECRET_KEY ?? 'minio12345',
    s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-in-production-32chars',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-in-production-32chars',
    realtimeJwtSecret: process.env.REALTIME_JWT_SECRET ?? 'dev-realtime-secret-change-in-production-32chars',
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
