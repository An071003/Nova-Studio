# LESSONS — Improvement library (Harness² "harnessing-level learning")

Chỉ ghi bài học **tổng quát hoá được** và **có bằng chứng**. Đọc theo tag module ở bước LOAD.
Lesson `confidence: high` được dùng ≥ 3 lần → skill `nova-harness-evolve` promote thành rule/probe check.

## Template
```
### L-NNN <tiêu đề ngắn>  #<module> #<topic>
- Date / Task: 2026-11-14 / P1-T07
- Symptom: <lỗi quan sát được, trích log>
- Root cause: ...
- Fix / Pattern: ... (snippet ngắn nếu cần)
- Evidence: <probe trước FAIL → sau PASS>
- Confidence: low | medium | high · Uses: 0
```

## Seed lessons (kiến thức nền, confidence medium — cần xác nhận trong dự án)

### L-001 Y.Text phải gắn vào doc trước khi đọc  #editor-core #yjs
- Symptom: `Invalid access: Add Yjs type to a document before reading data.`
- Fix: tạo `new Y.Text()`, `nodeMap.set('text', ytext)` bên trong transact, sau đó mới `insert`.
- Confidence: medium · Uses: 0

### L-002 UndoManager cần trackedOrigins  #editor-core #history
- Symptom: Undo hoàn tác cả thay đổi của người khác hoặc không làm gì.
- Fix: `new Y.UndoManager(nodes, { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 500 })`; mọi command transact với `LOCAL_ORIGIN`.
- Confidence: medium · Uses: 0

### L-003 Playwright multiplayer flaky do chờ sai điều kiện  #web #e2e
- Fix: chờ `connection-status[data-state=connected]` và `expect.poll(scene)`; không dùng `waitForTimeout`.
- Confidence: medium · Uses: 0

### L-004 Konva re-render chậm khi đi qua React state  #editor-konva #perf
- Fix: cập nhật node Konva trực tiếp từ `SceneDiff` (`shape.setAttrs`, `layer.batchDraw()`); React chỉ dựng khung.
- Confidence: medium · Uses: 0

### L-005 MinIO presigned URL sai host trong Docker  #api #infra
- Symptom: Browser nhận URL `http://minio:9000/...` không truy cập được.
- Fix: dùng `S3_PUBLIC_ENDPOINT` riêng để ký URL cho browser; endpoint nội bộ cho server.
- Confidence: medium · Uses: 0

### L-006 Workspace dual ESM/CJS cần top-level `main`/`types` cho NestJS CJS  #monorepo #shared
- Date / Task: 2026-11-14 / P1-T01
- Symptom: `TS2307: Cannot find module '@nova/shared'` dưới `moduleResolution: Node10/Node` khi chỉ có `exports`.
- Root cause: `moduleResolution: Node10` không đọc `exports` của `package.json`.
- Fix / Pattern: Đặt `"main": "./dist/cjs/index.js"`, `"module": "./dist/esm/index.js"`, `"types": "./dist/cjs/index.d.ts"` cùng `exports`, compile dual ESM+CJS qua `packages/config/scripts/dual-build.mjs`.
- Evidence: `probe.ps1 -Scope all` trước FAIL (4 steps) → sau PASS (6/6 steps).
- Confidence: high · Uses: 1

### L-007 Windows Docker Desktop daemon & MinIO image  #infra
- Date / Task: 2026-11-14 / P1-T02
- Symptom: Non-daemon `run_command` kills Docker Desktop when command returns; `minio/minio:latest` returns `pull access denied`; `docker compose up --wait` fails on one-shot init containers (`exited (0)`).
- Fix / Pattern: Start Docker Desktop via `Start-Process "...\Docker Desktop.exe" -Wait` with `IsDaemon: true`. Use `pgsty/silo:latest` with inline `curl --aws-sigv4` bucket init + `HEAD` check in `minio` healthcheck.
- Evidence: `probe.ps1 -Scope infra` trước FAIL → sau PASS (`nova-postgres`, `nova-redis`, `nova-minio`, `nova-mailpit` Healthy).
- Confidence: high · Uses: 1

### L-008 NestJS DI trong Vitest cần `@Inject(...)` tường minh  #api #testing
- Date / Task: 2026-11-14 / P1-T04
- Symptom: Vitest (esbuild) không emit `design:paramtypes` cho constructor injection nên NestJS không resolve dependency nếu thiếu `@Inject`.
- Fix / Pattern: Luôn gắn `@Inject(DependencyClass)` trên mọi tham số constructor trong NestJS controller/service/guard.
- Evidence: `test/health.e2e-spec.ts` 2/2 PASS dưới Vitest không cần `unplugin-swc`.
- Confidence: high · Uses: 1

### L-009: [realtime] @hocuspocus/provider shared websocketProvider requires attach() and minDelay <= delay
- **Rule**: When passing an explicit `HocuspocusProviderWebsocket` instance via `websocketProvider`, `HocuspocusProvider` sets `manageSocket = false` and skips `attach()`, so callers must set `autoConnect: false` on the socket, create `HocuspocusProvider`, call `provider.attach()`, and then call `socket.connect()`. When customizing retry delays on `HocuspocusProviderWebsocket`, always specify `minDelay <= delay` (default `minDelay` is `1000`, so overriding `delay` alone throws inside `@lifeomic/attempt` before attempting a WebSocket connection).
- **Proof**: Initial `apps/realtime/test/realtime.test.ts` runs timed out with `[opened=false statuses= maxErr=Error: delay cannot be less than minDelay]`; fixing `provider.attach()`, `autoConnect: false`, and `minDelay: 50` yielded `PROBE PASS: 5 step(s)` (`4/4` tests in 1.14s).

### L-010: [editor-konva] Konva 9.x requires `Bundler` moduleResolution and explicit Vitest browser alias `#testing #editor-konva`
- **Date / Task**: 2026-11-14 / P1-T13
- **Symptom**: `konva@9.3.22` exposes `"main": "./lib/index-node.js"` (which calls `require("canvas")`) and `"browser": "./lib/index.js"` without `"exports"`. `tsconfig` with `moduleResolution: "NodeNext"` breaks Konva/DOM typing, and Vitest SSR/Node transform resolves `"main"` (`index-node.js`) even with `conditions: ['browser']`, failing with `Cannot find module 'canvas'`. Next.js server/client bundling can also resolve `canvas` unless configured.
- **Fix / Pattern**: Extend `tsconfig.react.json` (`moduleResolution: "Bundler"`) in `@nova/editor-konva`; in `vitest.config.ts` of `@nova/editor-konva` and `apps/web`, alias `/^konva$/` to `createRequire(import.meta.url).resolve('konva/lib/index.js')`; set `webpack.resolve.alias.canvas = false` in `apps/web/next.config.ts` and dynamically `import('@nova/editor-konva')` inside `useEffect` on client canvas mount.
- **Evidence**: `pnpm --filter @nova/editor-konva test` 3/3 PASS (incl. 500-node `<16.6ms`/frame bench), `pnpm --filter web test` 3/3 PASS, `pnpm --filter web build` PASS, Playwright `editor.spec.ts` PASS.
- **Confidence**: high · Uses: 2

### L-011: [realtime] @hocuspocus/server `Connection.close()` sends Close message without closing the WebSocket `#realtime #hocuspocus`
- **Date / Task**: 2026-11-14 / P1-T17
- **Symptom**: Calling `conn.close({ code: 4403, reason: 'Role updated' })` on an active document connection removes the connection from `Document` and emits `MessageType.Close`, so `HocuspocusProviderWebsocket` never receives a TCP/WS close frame and never reconnects to fetch a refreshed ticket.
- **Root cause**: In `@hocuspocus/server` v4.8, `Connection.close(event)` only sends `OutgoingMessage.writeCloseMessage(...)` over the multiplexed socket; terminating the peer socket requires closing `conn.webSocket`.
- **Fix / Pattern**: Send any stateless notice (`conn.sendStateless(...)`), call `conn.close({ code, reason })` to run Hocuspocus cleanup hooks, and call `conn.webSocket.close(code, reason)` so `HocuspocusProviderWebsocket` fires `onClose` and reconnects via `token()` for a new RBAC ticket. Also avoid caching React Query modal member queries (`staleTime: 0` + `invalidateQueries` on dialog open).
- **Evidence**: `apps/realtime/test/realtime.test.ts` role-change close test timed out at 5000ms before fix → `5 passed (5)` (`probe -Scope realtime` PASS 5/5) + Playwright `E6` (`probe -Scope e2e` PASS 5/5) after fix.
- **Confidence**: high · Uses: 1

### L-012: [editor-core] Concurrent `Y.Map` key writes (`updatedAt`) alongside `Y.Text` edits cause `Y.UndoManager` to delete active keys to `undefined` `#realtime #yjs #editor-core`
- **Date / Task**: 2026-11-14 / P1-T20
- **Symptom**: When two peers concurrently execute `editText` on the same node, calling `undo()` on the peer with higher `clientID` deleted `nodeMap.get('updatedAt')` completely (`undefined`), causing Zod `CanvasNodeSchema.safeParse` in `readNodeFromMap` to return `null` and hide the entire node (`tA: undefined, tB: undefined`).
- **Root cause**: `handleEditText` wrote `nodeMap.set('updatedAt', Date.now())` inside the same `LOCAL_ORIGIN` transaction as `Y.Text.insert`. Yjs LWW ordered the remote `updatedAt` item alongside the local one; `Y.UndoManager` (`ignoreRemoteMapChanges = false`) then returned `null` from `redoItem` (refusing to restore the original `updatedAt` behind a concurrent peer key) yet still executed `itemsToDelete` on the active local `updatedAt` item.
- **Fix / Pattern**: Never touch LWW `Y.Map` metadata keys (`updatedAt`) during in-place `Y.Text` edits (`handleEditText` / `handleSetText` when `Y.Text` is already attached), guard `Y.UndoManager` `deleteFilter` so active `nodeMap` property items (`parent._map.get(parentSub) === item && item.left !== null`) are never deleted when `redoItem` skips restoration, and default missing `updatedAt` in `readNodeFromMap`.
- **Evidence**: Deterministic unit test `concurrent editText undo reverts only local insertion regardless of clientID order` (`[1, 2]` and `[2, 1]`) + `probe -Scope editor-core` PASS (`22/22`) + Playwright `E10` + `probe -Scope e2e` PASS (`10/10`).
- **Confidence**: high · Uses: 1
