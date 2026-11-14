# HARNESS CHANGELOG

Mọi thay đổi lên `AGENTS.md`, `.agents/rules`, `.agents/skills`, `harness/probes`, `harness/evals` phải ghi ở đây.

| Date | Change | Reason / Pattern | Evidence (baseline → new) |
|---|---|---|---|
| 2026-11-14 | Khởi tạo harness v1: 6 rules, 6 skills, specs 00–11, probes, evals E1–E12 | Bootstrap | – |
| 2026-11-14 | `harness/probes/probe.{ps1,sh}` (`gate-m1`): đổi `--grep "E[1-5]\b"` → `"E[1-5]:"` | `pnpm` v10 trên Windows escape `\b` thành `\\b` khiến Playwright không tìm thấy E1–E5 dù `--list` khớp 5 test | `gate-m1` E1–E5: `No tests found` → `5 tests` matched (`E1:`..`E5:`) |
