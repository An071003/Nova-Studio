# 10 — DEPLOYMENT & OPERATIONS RUNBOOK

## 1. Production Topology

`infra/docker-compose.prod.yml` packages the full Phase 1 stack behind Caddy (`infra/Caddyfile`) listening on `:80`:

```text
Internet / Reverse Proxy
        │
        ▼  (:80 Caddy — infra/Caddyfile)
        ├── /api/*  ──▶ api:4000      (NestJS REST API; runs `prisma migrate deploy` on boot)
        ├── /ws*    ──▶ realtime:4001 (Hocuspocus WebSocket + /health endpoint)
        └── /*      ──▶ web:3000      (Next.js standalone server)

Internal Backing Services:
  ├── postgres:5432  (postgres:16-alpine, volume: nova_prod_pgdata)
  ├── redis:6379     (redis:7-alpine, volume: nova_prod_redis)
  ├── minio:9000     (pgsty/silo:latest, volume: nova_prod_minio, bucket: $S3_BUCKET)
  └── worker         (apps/worker daemon: asset thumbnails, PNG exports, hourly auto-versions)
```

- **Dockerfiles:** `apps/api/Dockerfile`, `apps/realtime/Dockerfile`, `apps/worker/Dockerfile`, `apps/web/Dockerfile` (`node:22-bookworm-slim` + `pnpm@10.32.1`).
- **CI Pipeline:** `.github/workflows/ci.yml` runs Prisma generate/migrate, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter api test:e2e`, `pnpm build`, Playwright smoke tests (`pnpm --filter web e2e`), `pnpm audit --prod --audit-level high`, and `gitleaks`.

---

## 2. Environment & Secret Configuration

Create an environment file outside git (for example `.env.prod`) before launching Compose in production. Every secret must be uniquely generated:

```bash
# Generate 32-byte hex secrets
openssl rand -hex 32   # use once each for JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, REALTIME_JWT_SECRET
openssl rand -hex 16   # use for POSTGRES_PASSWORD and S3_SECRET_KEY
```

### Required Variables (`infra/docker-compose.prod.yml`)

| Variable | Notes |
|---|---|
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Postgres credentials matching `DATABASE_URL` |
| `DATABASE_URL` | `postgresql://<user>:<password>@postgres:5432/<db>` |
| `REDIS_URL` | `redis://redis:6379` (or managed Redis URL) |
| `S3_BUCKET` | Default `nova-assets` |
| `S3_REGION` | Default `us-east-1` |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Object storage credentials (never leave defaults in prod) |
| `S3_PUBLIC_ENDPOINT` | Browser-accessible URL for presigned upload/download (e.g. `https://s3.example.com`) |
| `JWT_ACCESS_SECRET` | HS256 secret for 15m API access tokens |
| `JWT_REFRESH_SECRET` | HS256 secret for HttpOnly refresh tokens |
| `REALTIME_JWT_SECRET` | HS256 secret for 60s project-scoped WebSocket tickets (shared by `api` and `realtime`) |
| `WEB_URL` | Public origin of the web app (e.g. `https://studio.example.com`) |
| `CORS_ORIGINS` | Comma-separated allowed browser origins (must include `WEB_URL`) |
| `NEXT_PUBLIC_API_URL` | Build arg for `web` image (`/api/v1` when proxied through Caddy) |
| `NEXT_PUBLIC_REALTIME_URL` | Build arg for `web` image (`wss://studio.example.com/ws` for HTTPS/TLS, `ws://localhost/ws` locally) |
| `REALTIME_MAX_CONNECTIONS_PER_DOC` | Per-project WebSocket cap enforced by `apps/realtime` (default `50`) |

> **TLS in Production:** Replace `:80 { ... }` in `infra/Caddyfile` with your public domain (for example `studio.example.com { ... }`) so Caddy provisions Let's Encrypt TLS certificates automatically, and set `NEXT_PUBLIC_REALTIME_URL=wss://studio.example.com/ws` before building `web`.

---

## 3. Clean-Machine Deploy & Verification

```bash
# 1. Build images and start all 8 services (waits on container healthchecks)
docker compose --env-file .env.prod -f infra/docker-compose.prod.yml up -d --build --wait

# 2. Verify container status and health
docker compose -f infra/docker-compose.prod.yml ps

# 3. Smoke-check health endpoint & web document
curl -fsS http://localhost/api/v1/health
curl -fsSI http://localhost/
```

Expected `/api/v1/health` JSON:

```json
{"status":"ok","checks":{"db":"up","redis":"up","s3":"up"}}
```

To seed the starter demo data once in a staging/demo instance:

```bash
docker compose -f infra/docker-compose.prod.yml exec api node --experimental-strip-types apps/api/prisma/seed.ts
```

---

## 4. Backup & Restore Runbook

### 4.1 PostgreSQL Backup (`ProjectDocument` Yjs state + metadata + users)

```bash
BACKUP_DIR=./backups/$(date -u +%Y%m%d-%H%M%SZ)
mkdir -p "$BACKUP_DIR"

docker compose -f infra/docker-compose.prod.yml exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-nova}" -d "${POSTGRES_DB:-nova}" -Fc \
  > "$BACKUP_DIR/nova-postgres.dump"
```

### 4.2 Object Storage Backup (`nova-assets` bucket)

Use an S3 CLI (`aws` or `rclone`) configured via environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) rather than inline CLI user flags:

```bash
AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
aws --endpoint-url http://localhost:9000 s3 sync "s3://${S3_BUCKET:-nova-assets}" "$BACKUP_DIR/s3-assets"
```

### 4.3 Restore Procedure

> Pause writes first so Yjs updates in `realtime` do not race with `pg_restore`.

```bash
# 1. Stop application tiers while keeping postgres & minio up
docker compose -f infra/docker-compose.prod.yml stop caddy web api realtime worker

# 2. Restore PostgreSQL binary dump
docker compose -f infra/docker-compose.prod.yml exec -T postgres \
  pg_restore -U "${POSTGRES_USER:-nova}" -d "${POSTGRES_DB:-nova}" --clean --if-exists \
  < "$BACKUP_DIR/nova-postgres.dump"

# 3. Restore S3 asset objects
AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
aws --endpoint-url http://localhost:9000 s3 sync "$BACKUP_DIR/s3-assets" "s3://${S3_BUCKET:-nova-assets}"

# 4. Restart application services (runs any pending Prisma migrations automatically)
docker compose -f infra/docker-compose.prod.yml up -d --wait
```

---

## 5. Secret & Key Rotation

| Secret | Services Affected | Rotation Steps & Client Impact |
|---|---|---|
| `JWT_ACCESS_SECRET` | `api` | Update secret and restart `api`. Existing 15m access tokens invalidate immediately; browser clients automatically refresh via `/api/v1/auth/refresh` using their valid HttpOnly cookie. |
| `JWT_REFRESH_SECRET` | `api` | Update secret and restart `api`. All existing refresh tokens become invalid; users must sign in again. Optionally delete stale rows in `RefreshToken` (`revokedAt IS NULL`). |
| `REALTIME_JWT_SECRET` | `api`, `realtime` | Update secret for both `api` and `realtime`, then recreate both together (`up -d --no-deps api realtime`). WebSocket tickets have a 60s TTL; active sockets reconnect cleanly and mint fresh tickets via `api`. |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | `minio`, `api`, `worker` | Rotate credentials on the S3 backend/IAM first, update `.env.prod`, and recreate `api` and `worker` (`minio` too if self-hosted). |
| `POSTGRES_PASSWORD` / `DATABASE_URL` | `postgres`, `api`, `realtime`, `worker` | Run `ALTER USER <user> WITH PASSWORD '...';` in Postgres, update `.env.prod`, then recreate `api`, `realtime`, and `worker`. |

---

## 6. Rollback Procedure

1. Identify the last known-good commit/image tag:
   ```bash
   git log -n 5 --oneline
   ```
2. Check database migration compatibility: if the failed release added destructive/non-backward-compatible Prisma migrations, restore the pre-deploy PostgreSQL dump taken before upgrade (Section 4.3).
3. Roll back repository/images and restart the stack:
   ```bash
   git checkout <previous-good-commit>
   docker compose --env-file .env.prod -f infra/docker-compose.prod.yml up -d --build --wait
   curl -fsS http://localhost/api/v1/health
   ```
4. Verify logs contain zero startup or schema errors:
   ```bash
   docker compose -f infra/docker-compose.prod.yml logs --tail=100 api realtime worker web
   ```

---

## 7. Horizontal Scaling Notes (Phase 1 -> Production Growth)

- **`api` (Stateless):** Scales horizontally behind Caddy. Rate limiting (`RedisThrottlerStorage`) and upload/export job queues (`BullMQ`) already coordinate through Redis.
- **`worker`:** Scales horizontally across instances; BullMQ locks prevent duplicate processing of `asset`, `export`, and scheduled `auto-version` jobs.
- **`realtime` (`Hocuspocus`):** Currently runs as a single container (`REALTIME_MAX_CONNECTIONS_PER_DOC=50`) holding active `Y.Doc` rooms in memory, flushing snapshots to PostgreSQL (`"ProjectDocument"`), and subscribing to Redis channels (`nova:restore:*`, `nova:snapshot-req:*`, `nova:permission-revoked:*`). To scale `realtime` beyond one replica, configure sticky WebSocket routing by `projectId` **or** enable `@hocuspocus/extension-redis` so rooms synchronize across nodes.
