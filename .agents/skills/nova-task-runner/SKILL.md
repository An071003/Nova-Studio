---
name: nova-task-runner
description: >-
  Use this skill whenever implementing, continuing, or resuming any NOVA STUDIO task (IDs like P1-T07),
  or when the user says "tiếp tục", "làm task kế tiếp", "next task". Runs the harness loop
  LOAD → PROPOSE → IMPLEMENT → PROBE → CONTRAST → COMPOSE with evidence.
---

# NOVA Task Runner

## 1. LOAD
1. Đọc `harness/state/PROGRESS.md`. Nếu có task `IN_PROGRESS` → tiếp tục nó; nếu không → lấy task đầu tiên
   trong `docs/nova/08-TASKS.md` chưa DONE mà mọi phụ thuộc đã DONE.
2. Đọc spec liên quan (bảng map dưới) + lessons có tag module (`grep "#<module>" harness/lessons/LESSONS.md`).

| Module | Spec |
|---|---|
| shared | 02, 03, 07 |
| api | 02, 03, 07 |
| editor-core | 04, 05 |
| realtime | 04, 07 |
| web / editor-konva / ui | 05, 06 |
| infra / deploy | 10 |

## 2. PROPOSE
Ghi vào PROGRESS mục `## Current task`: ID, mục tiêu, file dự kiến, rủi ro, kế hoạch probe. Đổi trạng thái → `IN_PROGRESS`.

## 3. IMPLEMENT
- Theo `.agents/rules/*`. Viết test trước hoặc song song.
- Với UI: chạy skill `modern-web-guidance` trước khi viết HTML/CSS mới.
- Lib mới ngoài 01-ARCHITECTURE → thêm ADR vào `harness/state/DECISIONS.md` trước khi cài.

## 4. PROBE
```powershell
pwsh harness/probes/probe.ps1 -Scope <module>
```
Cộng lệnh trong cột Probe/AC của task. Ghi dòng tổng kết thật vào PROGRESS `Evidence`.

## 5. CONTRAST (nếu FAIL)
Tối đa 3 vòng: liệt kê giả thuyết → sửa nhỏ nhất → probe lại → so sánh. Không sửa test để pass trừ khi test sai so với spec
(khi đó trích dẫn dòng spec trong PROGRESS).

## 6. COMPOSE
- PROGRESS: task → `DONE` + evidence + ngày; chuyển "Current task" về trống; thêm follow-up nếu có.
- Lessons: chỉ khi có bằng chứng (xem template trong LESSONS.md).
- Commit: `feat(<module>): <mô tả> [P1-Txx]`.
- Báo cáo người dùng ≤ 8 dòng. Dừng ở mỗi `M*-GATE` để người dùng xác nhận.
