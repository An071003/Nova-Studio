---
name: nova-review
description: >-
  Use this skill to review a diff, PR, or completed task in NOVA STUDIO before marking it DONE or at milestone gates.
  Acts as an independent verifier that re-runs probes rather than trusting prior claims.
---

# NOVA Review (verifier)

Giả định người viết code có thể đã sai. Tự chạy lại, không tin evidence cũ.

## Checklist
1. **Probe lại**: `pwsh harness/probes/probe.ps1 -Scope <module>` — so với evidence trong PROGRESS.
2. **AC**: từng dòng AC của task trong 08-TASKS có test tương ứng? Liệt kê AC ↔ test file:line.
3. **Boundaries**: không import cấm (rule 10); editor-core không có `react|konva|document|window`.
4. **Realtime**: mutation đều qua command + `transact(LOCAL_ORIGIN)`; không binary qua Yjs; có convergence test.
5. **Security**: mọi endpoint gọi `permissions.assert`; test role đầy đủ; không log secret; Zod validate.
6. **Test thật**: không skip/only, không mock thứ đang được kiểm, không `waitForTimeout`.
7. **UI**: dùng token, có state loading/empty/error, a11y cơ bản, screenshot evidence.
8. **Docs**: spec/03-API/04-REALTIME cập nhật nếu thay đổi hợp đồng.

## Output
```
REVIEW P1-Txx: APPROVE | CHANGES_REQUESTED
- [blocker] ...
- [minor] ...
Probe: <dòng tổng kết>
```
Blocker → task quay về IN_PROGRESS trong PROGRESS.
