---
trigger: always_on
---

# Harness Loop — Propose · Probe · Compose

Dựa trên ý tưởng Harness² (google-research/harness2): model cố định, ta tối ưu **harness** (rules, skills,
memory, probes) qua vòng lặp có bằng chứng. Áp dụng cho MỌI task trong `docs/nova/08-TASKS.md`.

## LOAD
- Đọc `harness/state/PROGRESS.md`, task hiện tại trong `08-TASKS.md`, lessons có tag trùng module.
- Nếu task phụ thuộc task chưa DONE → dừng, ghi blocker vào PROGRESS.

## PROPOSE (≤ 15 dòng, ghi vào PROGRESS mục "Current task")
- Mục tiêu, file sẽ chạm, rủi ro, cách probe sẽ chứng minh acceptance criteria.
- Task > ~400 dòng thay đổi → chia sub-task trước.

## IMPLEMENT
- Thay đổi nhỏ, theo ranh giới module (`10-architecture-boundaries.md`).
- Viết test cùng lúc với code (không để cuối).

## PROBE (bắt buộc, bằng chứng thật)
- Chạy `harness/probes/probe.ps1 -Scope <module>` (Windows) hoặc `probe.sh <module>`.
- Chạy thêm lệnh đặc thù trong acceptance criteria (vd. e2e multiplayer).
- Dán tóm tắt output (PASS/FAIL, số test) vào PROGRESS. Không suy đoán kết quả.

## CONTRAST (chỉ khi FAIL hoặc có ≥2 cách làm hợp lý)
- Đề xuất 2–3 phương án sửa khác nhau, thử từng cái (nhỏ nhất trước), so sánh bằng probe.
- Giữ phương án PASS với ít thay đổi nhất. Tối đa 3 vòng; sau đó ghi BLOCKED + giả thuyết, hỏi người dùng.

## COMPOSE
- Cập nhật PROGRESS: task → DONE, evidence, follow-up.
- Nếu học được điều **tổng quát hoá được và có bằng chứng** (lỗi lặp lại, gotcha thư viện, pattern hiệu quả)
  → thêm entry vào `harness/lessons/LESSONS.md` theo template.
- Nếu một rule/skill sai hoặc thiếu → sửa harness + ghi `harness/HARNESS_CHANGELOG.md`
  (lý do, evidence, diff tóm tắt). **Cấm** sửa harness để nới lỏng bảo mật, test, hoặc QA gate.
- Quyết định kiến trúc mới → ADR trong `harness/state/DECISIONS.md`.

## Báo cáo cho người dùng
Ngắn: task nào xong, evidence probe, việc tiếp theo, câu hỏi mở (nếu có).
