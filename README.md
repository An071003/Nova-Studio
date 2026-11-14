# NOVA STUDIO — Phase 1: Collaborative Canvas

Realtime multiplayer design canvas built with a headless Yjs CRDT core, Konva 2D renderer, NestJS API, Hocuspocus collaboration server, and BullMQ background workers.

---

## Architecture Overview

```text
Browser (apps/web :3000)
  ├── HTTP / REST (/api/v1/*) ─────────▶ apps/api (:4000) ──▶ PostgreSQL + Redis + S3/MinIO
  └── WebSocket CRDT + Awareness ──────▶ apps/realtime (:4001) ──▶ PostgreSQL + Redis
                                              ▲
                                        BullMQ / Redis
                                              ▼
                                         apps/worker (assets, exports, auto-versions)
```

### Monorepo Layout

| Workspace | Package Name | Responsibility |
|---|---|---|
| `apps/web` | `web` | Next.js 15 App Router UI (Auth, Dashboard, Collaborative Canvas Editor, Playwright E2E) |
| `apps/api` | `api` | NestJS 11 REST API (JWT auth + HttpOnly refresh rotation, Workspaces, Projects, RBAC, Assets, Versions, Exports, Prisma) |
| `apps/realtime` | `realtime` | Hocuspocus v4 + Yjs WebSocket server (60s scoped ticket auth, Viewer enforcement, 1 MB payload cap, Postgres/Redis sync) |
| `apps/worker` | `worker` | BullMQ worker daemon (image probing, WebP thumbnails, Sharp PNG export, hourly auto-version snapshots + 50-cap prune) |
| `packages/shared` | `@nova/shared` | Zod DTOs & node schemas, `can(role, action)` RBAC matrix, `sanitizeSvgMarkup`, deterministic `renderCanvasNodesToSvg` |
| `packages/editor-core` | `@nova/editor-core` | Headless `Y.Doc` engine (`CommandBus`, `SpatialIndex`, `HistoryManager`, tool FSM, clipboard) — zero React/DOM/Konva imports |
| `packages/editor-konva` | `@nova/editor-konva` | Konva canvas adapter subscribing to `@nova/editor-core` state and viewport events |
| `packages/ui` | `@nova/ui` | Shared React + Tailwind v4 UI components |
| `packages/config` | `@nova/config` | Shared ESLint boundaries config, TypeScript configs, and dual ESM/CJS build scripts |

---

## Prerequisites

- **Node.js** `>= 22.0.0`
- **pnpm** `10.32.1` (`corepack enable` or `npm i -g pnpm@10.32.1`)
- **Docker** & **Docker Compose** (for PostgreSQL 16, Redis 7, S3-compatible MinIO/Silo, and Mailpit)
- Optional for security/release probes: **gitleaks**

---

## Quick Start (Local Development)

1. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

2. **Install dependencies and build workspace packages:**
   ```bash
   pnpm install
   pnpm build
   ```

3. **Start infrastructure services (Postgres, Redis, MinIO/Silo, Mailpit):**
   ```bash
   docker compose -f infra/docker-compose.dev.yml up -d --wait
   ```

4. **Generate Prisma client, run migrations, and seed demo workspace:**
   ```bash
   pnpm --filter api exec prisma generate
   pnpm db:migrate
   pnpm db:seed
   ```

5. **Run all apps in development mode:**
   ```bash
   pnpm dev
   ```
   - Web App: `http://localhost:3000`
   - REST API: `http://localhost:4000/api/v1/health`
   - Realtime WebSocket: `ws://localhost:4001` (`http://localhost:4001/health`)

### Seeded Demo Accounts

Running `pnpm db:seed` creates workspace **Nova Demo Studio** (`nova-demo`) and project **Welcome Canvas**:

| Email | Role | Password |
|---|---|---|
| `owner@nova.dev` | `OWNER` | `Passw0rd!` |
| `editor@nova.dev` | `EDITOR` | `Passw0rd!` |
| `viewer@nova.dev` | `VIEWER` | `Passw0rd!` |

---

## Common Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start dev processes across apps/packages via Turborepo |
| `pnpm build` | Build all packages and apps |
| `pnpm lint` | Run ESLint (including module boundary rules) |
| `pnpm typecheck` | Run TypeScript `strict` checks across workspaces |
| `pnpm test` | Run Vitest unit & integration suites across workspaces |
| `pnpm format:check` | Check Prettier formatting |
| `pnpm db:migrate` | Apply Prisma database migrations (`apps/api`) |
| `pnpm db:seed` | Seed demo workspace, users, and starter canvas |
| `pnpm --filter api test:e2e` | Run NestJS Supertest E2E suite |
| `pnpm --filter web e2e` | Run Playwright smoke suite (`apps/web/e2e/smoke`) |
| `pnpm --filter web e2e:evals` | Run Playwright multiplayer/security/perf evals (`E1`–`E12`) |
| `pnpm --filter @nova/editor-core bench` | Run `@nova/editor-core` Vitest performance benchmarks |

### Harness Probes

Use the cross-platform probe runner to validate modules and milestone gates:

```powershell
# Windows (PowerShell)
pwsh -NoProfile -File harness/probes/probe.ps1 -Scope <all|infra|shared|api|editor-core|realtime|web|e2e|security|perf|deploy|gate-m1|gate-m2>
```

```bash
# Linux / macOS
bash harness/probes/probe.sh <all|infra|shared|api|editor-core|realtime|web|e2e|security|perf|deploy|gate-m1|gate-m2>
```

---

## Production Deployment

Full production Compose stack (`postgres`, `redis`, `minio`, `api`, `realtime`, `worker`, `web`, and `caddy` reverse proxy on `:80`) lives in `infra/docker-compose.prod.yml` and `infra/Caddyfile`.

```bash
docker compose -f infra/docker-compose.prod.yml up -d --build --wait
curl -fsS http://localhost/api/v1/health
```

See [docs/nova/10-DEPLOYMENT.md](docs/nova/10-DEPLOYMENT.md) for required secrets, TLS setup, database/S3 backup & restore, key rotation, rollback, and scaling guidance.
