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

## Yêu Cầu Cài Đặt (Prerequisites)

Trước khi chạy, hãy đảm bảo máy tính đã cài đặt:
- **Node.js** `>= 22.0.0`
- **pnpm** `10.32.1` (`corepack enable` hoặc `npm i -g pnpm@10.32.1`)
- **Docker Desktop** (Bắt buộc phải bật Docker Desktop trước khi chạy)
- (Tùy chọn) **cloudflared** (nếu muốn tạo link public qua Cloudflare Tunnel): `winget install Cloudflare.cloudflared`

---

## Hướng Dẫn Chạy Dự Án (How to Run)

Bạn có thể chạy dự án theo **3 cách** tùy theo nhu cầu:

---

### Cách 1: Chạy Môi Trường Phát Triển (Local Development)

Dành cho lập trình viên muốn chỉnh sửa code, debug hoặc chạy kiểm thử.

#### Bước 1: Sao chép cấu hình môi trường
```bash
cp .env.example .env
```
*(Trên Windows PowerShell nếu chưa có lệnh `cp`: `Copy-Item .env.example .env`)*

#### Bước 2: Cài đặt dependencies và build packages nội bộ
```bash
pnpm install
pnpm build
```

#### Bước 3: Khởi động hạ tầng dịch vụ (PostgreSQL, Redis, MinIO, Mailpit)
Đảm bảo Docker Desktop đang chạy, sau đó chạy:
```bash
docker compose -f infra/docker-compose.dev.yml up -d --wait
```

#### Bước 4: Khởi tạo database và nạp dữ liệu mẫu
```bash
pnpm --filter api exec prisma generate
pnpm db:migrate
pnpm db:seed
```

#### Bước 5: Khởi chạy tất cả các app
```bash
pnpm dev
```

Sau khi khởi chạy thành công:
- **Web App:** [http://localhost:3000](http://localhost:3000)
- **API Server & Health check:** [http://localhost:4000/api/v1/health](http://localhost:4000/api/v1/health)
- **Realtime WebSocket Server:** `ws://localhost:4001` ([http://localhost:4001/health](http://localhost:4001/health))
- **MinIO S3 Console:** [http://localhost:9001](http://localhost:9001) (User: `minio` / Pass: `minio12345`)
- **Mailpit (Email dev):** [http://localhost:8025](http://localhost:8025)

> **Dừng môi trường dev:** Nhấn `Ctrl + C` trên terminal `pnpm dev`, sau đó tắt Docker backend:
> ```bash
> docker compose -f infra/docker-compose.dev.yml down
> ```

---

### Cách 2: Chạy Trọn Gói Bằng Docker Compose (Production Stack)

Dành cho việc chạy thử nghiệm thực tế (hoặc deploy trên máy chủ) với đầy đủ 8 container: `postgres`, `redis`, `minio`, `api`, `realtime`, `worker`, `web`, và `caddy` reverse proxy tại cổng `:80`.

#### Bước 1: Khởi động toàn bộ stack
```bash
docker compose -f infra/docker-compose.prod.yml up -d --build --wait
```

#### Bước 2: Nạp dữ liệu mẫu (chỉ cần chạy lần đầu tiên)
```bash
docker compose -f infra/docker-compose.prod.yml exec -T api node --experimental-strip-types apps/api/prisma/seed.ts
```

#### Bước 3: Kiểm tra trạng thái và truy cập
- Kiểm tra trạng thái các container:
  ```bash
  docker compose -f infra/docker-compose.prod.yml ps
  ```
- Kiểm tra API health:
  ```bash
  curl -fsS http://localhost/api/v1/health
  ```
- **Truy cập trực tiếp tại:** [http://localhost](http://localhost) (Cổng 80 qua Caddy proxy).

> **Dừng production stack:**
> ```bash
> docker compose -f infra/docker-compose.prod.yml down
> ```

---

### Cách 3: Xuất Link Công Khai Ra Internet (Cloudflare Tunnel)

Nếu bạn muốn chia sẻ link cho người khác từ xa vào vẽ và cộng tác realtime mà không cần mở port modem hay mua VPS:

1. Đảm bảo stack Docker ở **Cách 2** đang chạy (đang lắng nghe tại cổng `80`).
2. Mở một terminal mới và chạy:
   ```bash
   cloudflared tunnel --url http://localhost:80
   ```
3. Terminal sẽ hiển thị đường dẫn dạng:
   ```text
   +--------------------------------------------------------------------------------------------+
   |  Your quick Tunnel has been created! Visit it at:                                          |
   |  https://xxxx-xxxx-xxxx.trycloudflare.com                                                  |
   +--------------------------------------------------------------------------------------------+
   ```
4. Gửi link `https://xxxx.trycloudflare.com` cho bạn bè hoặc mở trên điện thoại/máy tính khác để trải nghiệm realtime.

---

## Tài Khoản Demo Mẫu (Seeded Demo Accounts)

Sau khi chạy lệnh seed dữ liệu (`pnpm db:seed`), hệ thống có sẵn workspace **Nova Demo Studio** (`nova-demo`) và project mẫu **Welcome Canvas** với 3 tài khoản thử nghiệm:

| Email | Vai trò (Role) | Mật khẩu (Password) | Quyền hạn |
|---|---|---|---|
| `owner@nova.dev` | `OWNER` | `Passw0rd!` | Toàn quyền quản trị workspace, dự án, thành viên |
| `editor@nova.dev` | `EDITOR` | `Passw0rd!` | Có thể chỉnh sửa canvas, tạo layer, xuất file |
| `viewer@nova.dev` | `VIEWER` | `Passw0rd!` | Chỉ xem (Read-only), thấy con trỏ người khác realtime |

---

## Xử Lý Sự Cố Thường Gặp (Troubleshooting)

1. **Lỗi Docker daemon not running**:
   - *Nguyên nhân:* Ứng dụng Docker Desktop chưa được bật.
   - *Khắc phục:* Mở Docker Desktop và đợi đến khi biểu tượng chuyển sang trạng thái "Engine running".
2. **Lỗi trùng cổng (Port already allocated)**:
   - *Nguyên nhân:* Có phần mềm khác (như PostgreSQL cài sẵn ở máy cổng 5432, hoặc Redis cổng 6379, hoặc IIS/Skype cổng 80) đang chiếm dụng port.
   - *Khắc phục:* Tắt service cục bộ đang chiếm port hoặc đổi port mapping trong `infra/docker-compose.dev.yml` / `infra/docker-compose.prod.yml`.
3. **Lỗi đăng nhập báo "Invalid credentials"**:
   - *Nguyên nhân:* Chưa chạy lệnh seed dữ liệu vào database.
   - *Khắc phục:* Chạy lại `pnpm db:seed` (đối với dev) hoặc lệnh seed exec của compose (đối với prod).
4. **Lỗi thiếu module khi chạy dev**:
   - *Khắc phục:* Chạy `pnpm install && pnpm build` từ thư mục gốc để đảm bảo các package nội bộ (`@nova/shared`, `@nova/editor-core`, `@nova/editor-konva`, `@nova/ui`) được compile đầy đủ.
5. **Lỗi `container infra-api-1 is unhealthy` / `P1000: Authentication failed against database server`**:
   - *Nguyên nhân:* Volume dữ liệu của PostgreSQL (`nova_prod_pgdata`) trước đó từng được tạo với một mật khẩu khác so với biến môi trường `DATABASE_URL` hiện tại.
   - *Khắc phục:* Reset sạch volume dữ liệu cũ và khởi động lại bằng lệnh:
     ```bash
     docker compose -f infra/docker-compose.prod.yml down -v
     docker compose -f infra/docker-compose.prod.yml up -d --build --wait
     docker compose -f infra/docker-compose.prod.yml exec -T api node --experimental-strip-types apps/api/prisma/seed.ts
     ```

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

Sử dụng bộ probe script để kiểm tra chất lượng code và các milestone gate:

```powershell
# Windows (PowerShell)
pwsh -NoProfile -File harness/probes/probe.ps1 -Scope <all|infra|shared|api|editor-core|realtime|web|e2e|security|perf|deploy|gate-m1|gate-m2>
```

```bash
# Linux / macOS
bash harness/probes/probe.sh <all|infra|shared|api|editor-core|realtime|web|e2e|security|perf|deploy|gate-m1|gate-m2>
```

---

## Chi Tiết Triển Khai Nâng Cao

Xem chi tiết trong [docs/nova/10-DEPLOYMENT.md](docs/nova/10-DEPLOYMENT.md) về:
- Tạo secrets chuẩn production (`openssl rand -hex 32`)
- Cấu hình TLS / HTTPS tự động với Caddy và domain riêng
- Quy trình sao lưu & phục hồi database PostgreSQL (`pg_dump -Fc` / `pg_restore`) và S3 assets
- Quy trình xoay khóa bảo mật (Key rotation) và Rollback khi có sự cố.
