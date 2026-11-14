---
name: nova-multiplayer-e2e
description: >-
  Use this skill when writing or debugging Playwright end-to-end tests for NOVA STUDIO that involve multiple users,
  live cursors, sync, offline/reconnect, or the evals in harness/evals.
---

# Multiplayer E2E với Playwright

## Pattern
```ts
// apps/web/e2e/fixtures/multiplayer.ts
export const test = base.extend<{ users: (n: number, roles?: Role[]) => Promise<UserSession[]> }>({
  users: async ({ browser }, use) => {
    const ctxs: BrowserContext[] = [];
    await use(async (n, roles = []) => {
      const project = await seedProject(roles);              // gọi API trực tiếp, không qua UI
      return Promise.all(Array.from({ length: n }, async (_, i) => {
        const ctx = await browser.newContext(); ctxs.push(ctx);
        const page = await ctx.newPage();
        await loginViaApi(page, project.users[i]);
        await page.goto(`/p/${project.id}`);
        await expect(page.getByTestId('connection-status')).toHaveAttribute('data-state', 'connected');
        return { page, user: project.users[i], project };
      }));
    });
    await Promise.all(ctxs.map(c => c.close()));
  },
});
```

## Quy tắc
- Kiểm trạng thái qua **test hook** read-only: `window.__nova.scene()` trả JSON scene (chỉ bật khi `NEXT_PUBLIC_E2E=1`).
  So sánh scene giữa các user bằng `expect.poll(() => page.evaluate(() => window.__nova.scene())).toEqual(...)`.
- Không `waitForTimeout`. Luôn `expect.poll` / `toHave*` với timeout ≤ 5s.
- Offline: `context.setOffline(true/false)`.
- Đo latency: user A ghi `performance.now()` khi commit, B ghi khi nhận (qua `__nova.on('remoteUpdate')`); dùng cùng clock bằng
  cách cả hai chạy trong cùng process Playwright (đọc timestamp từ test, không từ trình duyệt).
- Mỗi eval lưu screenshot cuối vào `harness/evals/screenshots/<EID>.png`.
