# 10 — DEPLOYMENT

## Dev
```bash
cp .env.example .env
docker compose -f infra/docker-compose.dev.yml up -d   # postgres, redis, minio, mailpit
pnpm i
pnpm db:migrate && pnpm db:seed
pnpm dev            # turbo: web:3000, api:4000, realtime:4001, worker
```

## Biến môi trường (.env.example)
```
NODE_ENV=development
WEB_URL=http://localhost:3000
API_URL=http://localhost:4000
REALTIME_URL=ws://localhost:4001
DATABASE_URL=postgresql://nova:nova@localhost:5432/nova
REDIS_URL=redis://localhost:6379
S3_ENDPOINT=http://localhost:9000
S3_PUBLIC_ENDPOINT=http://localhost:9000   # host mà browser dùng cho presigned URL
S3_REGION=us-east-1
S3_BUCKET=nova-assets
S3_ACCESS_KEY=minio
S3_SECRET_KEY=minio12345
S3_FORCE_PATH_STYLE=true
JWT_ACCESS_SECRET=change-me
JWT_REFRESH_SECRET=change-me
REALTIME_JWT_SECRET=change-me
CORS_ORIGINS=http://localhost:3000
SMTP_URL=smtp://localhost:1025
```

## Production (Docker Compose, một máy / VPS)
- `infra/docker-compose.prod.yml`: caddy (TLS, reverse proxy `/` → web, `/api` → api, `/ws` → realtime), web, api, realtime, worker, postgres (volume), redis, minio hoặc S3 ngoài.
- Dockerfile multi-stage, `turbo prune --docker`, user non-root, healthcheck.
- Migration chạy bằng job `api migrate deploy` trước khi start api.
- Backup: `pg_dump` cron hằng ngày → S3.

## CI (GitHub Actions)
`lint → typecheck → unit → api e2e (services: postgres, redis, minio) → playwright → build images → gitleaks → pnpm audit`.

## Lộ trình sau Phase 1
Scale realtime nhiều instance (Redis extension, sticky theo document name), CDN cho asset, K8s; Desktop app bằng Tauri tái dùng `apps/web` + `editor-core`.
