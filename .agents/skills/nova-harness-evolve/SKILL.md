---
name: nova-harness-evolve
description: >-
  Use this skill after a milestone gate, after 3+ failed probe cycles on similar issues, or when the user asks to
  improve/optimize the agent harness, rules, or skills for NOVA STUDIO. Implements the Harness² style
  propose–probe–compose improvement loop over rules, skills, probes and the lessons library.
---

# Harness Evolve (Harness²-style self-improvement)

Mục tiêu: cải thiện **harness** (không phải sản phẩm) để các task sau ít lỗi hơn. Model cố định; chỉ sửa
`.agents/rules`, `.agents/skills`, `harness/probes`, `harness/lessons`, `AGENTS.md`.

## Bước 1 — Thu thập trace
- Đọc `harness/state/PROGRESS.md` (evidence, BLOCKED, số vòng CONTRAST), `harness/HARNESS_CHANGELOG.md`, `harness/lessons/LESSONS.md`.
- Liệt kê **failure pattern** lặp ≥ 2 lần (vd. "quên transact origin → undo sai", "Playwright flaky do không chờ sync").

## Bước 2 — Propose (2–3 ứng viên / pattern)
Mỗi ứng viên là một edit cụ thể: thêm rule, sửa bước skill, thêm check vào probe, thêm lesson, thêm example code.
Ưu tiên edit **có thể kiểm chứng tự động** (check trong probe > dòng chữ trong rule).

## Bước 3 — Probe (contrastive)
- Chọn task gần nhất bị ảnh hưởng (hoặc test tái hiện). Chạy probe với harness cũ (baseline) và với từng ứng viên.
- Tiêu chí: probe PASS, ít vòng CONTRAST hơn, ít dòng rule hơn (ngắn gọn thắng khi ngang nhau).
- Không có cách đo → chỉ được thêm dưới dạng lesson `confidence: low`, không thành rule.

## Bước 4 — Compose
- Áp dụng ứng viên thắng; gộp/xoá rule trùng lặp; giữ mỗi rule file < 24KB, tổng rule always_on ngắn.
- Ghi `HARNESS_CHANGELOG.md`: ngày, pattern, edit, evidence (baseline vs mới).
- Promote lesson `confidence: high` dùng ≥ 3 lần thành rule/probe check; xoá lesson đã lỗi thời.

## Cấm
Nới lỏng security, hạ ngưỡng QA, xoá test/eval, thêm "skip" vào probe, sửa spec sản phẩm để khớp code sai.
Thay đổi spec sản phẩm phải qua người dùng + ADR.
