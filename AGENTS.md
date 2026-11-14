# NOVA STUDIO — Agent Harness (entry point)

Bạn là agent triển khai **NOVA STUDIO Phase 1 — Collaborative Canvas** (web app, multiplayer realtime như Figma).
File này luôn được nạp. Giữ nó ngắn; chi tiết nằm trong `docs/nova/` và `.agents/`.

## 1. Nguồn sự thật (đọc theo thứ tự khi bắt đầu phiên)
1. `harness/state/PROGRESS.md` — đang ở task nào, việc dở dang, blocker.
2. `docs/nova/08-TASKS.md` — task kế tiếp + acceptance criteria.
3. `harness/lessons/LESSONS.md` — bài học đã được chứng minh (chỉ đọc mục có tag liên quan).
4. Spec của module đang làm trong `docs/nova/` (GOAL, ARCHITECTURE, DATABASE, API, REALTIME, EDITOR-CORE, UI-UX, SECURITY, QA, DEPLOYMENT).

Nếu spec và code mâu thuẫn: **spec thắng**, trừ khi có ADR mới hơn trong `harness/state/DECISIONS.md`.

## 2. Vòng lặp bắt buộc (Harness loop)
Mỗi task chạy đúng vòng: **LOAD → PROPOSE → IMPLEMENT → PROBE → (CONTRAST) → COMPOSE**.
Chi tiết: `.agents/rules/00-harness-loop.md` và skill `nova-task-runner`.
Không được báo "xong" khi chưa có bằng chứng probe PASS (output lệnh thật).

## 3. Luật cứng (không thương lượng)
- Monorepo pnpm + Turborepo. Không thêm framework/lib ngoài `docs/nova/01-ARCHITECTURE.md` mà không ghi ADR.
- `packages/editor-core` **không** import React, Next, Konva, DOM. Renderer là adapter.
- Không bao giờ gửi binary media (ảnh/video) qua WebSocket/Yjs. Chỉ metadata + `assetId`.
- Mọi input từ client được validate bằng Zod schema trong `packages/shared`.
- Mọi endpoint/kết nối realtime đều kiểm tra quyền (Owner/Editor/Viewer) phía server.
- Không sửa/xóa/skip test hoặc probe để "cho qua". Không hạ ngưỡng QA.
- Không commit secret. Dùng `.env.example`.
- TypeScript `strict`. Không `any` trừ khi có comment `// harness-allow-any: <lý do>`.

## 4. Cấu trúc harness
```
AGENTS.md                      ← bạn đang đọc
docs/nova/                     ← spec sản phẩm (00–11)
.agents/rules/                 ← guardrails (always_on / glob / model_decision)
.agents/skills/nova-*/         ← quy trình từng bước (on-demand)
harness/state/                 ← PROGRESS, DECISIONS (ADR) — bộ nhớ phiên
harness/lessons/               ← thư viện cải tiến (evidence-backed)
harness/probes/                ← script kiểm chứng (probe.ps1 / probe.sh)
harness/evals/                 ← kịch bản nghiệm thu multiplayer
harness/HARNESS_CHANGELOG.md   ← mọi chỉnh sửa lên chính harness
```
