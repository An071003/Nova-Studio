# 11 — PROMPTS (cách giao việc cho Gemini / Antigravity)

## Khởi động phiên (dán mỗi khi mở conversation mới)
```
Bạn đang làm NOVA STUDIO Phase 1. Đọc AGENTS.md, harness/state/PROGRESS.md và task kế tiếp trong
docs/nova/08-TASKS.md. Dùng skill nova-task-runner. Thực hiện đúng vòng LOAD→PROPOSE→IMPLEMENT→PROBE→COMPOSE.
Dừng sau khi task DONE (có evidence probe) hoặc BLOCKED, rồi báo cáo ngắn.
```

## Làm một task cụ thể
```
Thực hiện P1-T07. Chỉ chạm packages/editor-core và packages/shared. Probe: harness/probes/probe.ps1 -Scope editor-core.
```

## Khi bị kẹt / probe fail lặp lại
```
Chạy CONTRAST: liệt kê 3 giả thuyết nguyên nhân, thử từng cái theo thứ tự rẻ nhất, so sánh bằng probe.
Sau 3 vòng vẫn fail → ghi BLOCKED vào PROGRESS với log rút gọn.
```

## Cải tiến harness (chạy sau mỗi mốc hoặc khi thấy lỗi lặp)
```
Dùng skill nova-harness-evolve. Đọc PROGRESS, LESSONS, HARNESS_CHANGELOG. Tìm lỗi lặp ≥2 lần,
đề xuất chỉnh sửa rule/skill/probe, thử trên task gần nhất, chỉ giữ thay đổi cải thiện được probe.
```

## Review
```
Dùng skill nova-review cho diff của P1-T14. Kiểm boundaries, realtime rules, security, test thật.
```

## Gợi ý dùng Antigravity
- `/plan` trước task lớn (T13, T14, T19). `/goal` để chạy dài nhiều task qua đêm (vẫn dừng ở mỗi GATE).
- Có thể dùng `/teamwork` (swarm) ở M2: 1 agent backend (T17–T19), 1 agent web, 1 agent QA/verifier chỉ chạy evals.
