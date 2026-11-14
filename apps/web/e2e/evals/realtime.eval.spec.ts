import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanvasNode } from '@nova/shared';
import { createMultiplayerProject, expect, test } from '../fixtures/multiplayer';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(CURRENT_DIR, '../../../../harness/evals/screenshots');

test.describe('P1-T14 Realtime Multiplayer Evals (E1-E4)', () => {
  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('E1: 2-user realtime sync propagates within p95 < 100ms and converges identically', async ({
    browser,
  }) => {
    const harness = await createMultiplayerProject(browser, 'Eval-E1', ['OWNER', 'EDITOR']);
    try {
      const [userA, userB] = harness.sessions;
      let resolveNextRemote: (() => void) | null = null;
      await userB!.page.exposeFunction('__notifyRemoteUpdate', () => {
        if (resolveNextRemote) {
          const done = resolveNextRemote;
          resolveNextRemote = null;
          done();
        }
      });
      await userB!.page.evaluate(() => {
        window.__nova?.on('remoteUpdate', () => {
          (window as unknown as { __notifyRemoteUpdate?: () => void }).__notifyRemoteUpdate?.();
        });
      });

      const waitNextArrival = () =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Timed out waiting for remote update on User B')),
            5000,
          );
          resolveNextRemote = () => {
            clearTimeout(timer);
            resolve();
          };
        });

      // Warmup create before timing loop
      const warmupWait = waitNextArrival();
      const warmupId = await userA!.page.evaluate(() => {
        const res = window.__NOVA_EDITOR__?.editor.commands.execute({
          type: 'createNode',
          input: {
            type: 'frame',
            name: 'Warmup Frame',
            x: 80,
            y: 60,
            width: 520,
            height: 360,
          },
        });
        return res?.createdIds[0] ?? '';
      });
      await warmupWait;
      expect(warmupId.length).toBeGreaterThan(0);

      // Measure 20 operations (10 create + 10 move)
      const createdIds: string[] = [];
      const latenciesMs: number[] = [];

      for (let i = 0; i < 10; i += 1) {
        const arrival = waitNextArrival();
        const t0 = performance.now();
        const nodeId = await userA!.page.evaluate((idx) => {
          const res = window.__NOVA_EDITOR__?.editor.commands.execute({
            type: 'createNode',
            input: {
              type: 'rect',
              name: `SyncRect-${idx}`,
              x: 100 + idx * 36,
              y: 120 + (idx % 3) * 44,
              width: 32,
              height: 32,
            },
          });
          return res?.createdIds[0] ?? '';
        }, i);
        await arrival;
        latenciesMs.push(performance.now() - t0);
        createdIds.push(nodeId);
      }

      for (let i = 0; i < 10; i += 1) {
        const arrival = waitNextArrival();
        const t0 = performance.now();
        await userA!.page.evaluate((targetId) => {
          window.__NOVA_EDITOR__?.editor.commands.execute({
            type: 'moveNodes',
            ids: [targetId],
            dx: 12,
            dy: 8,
          });
        }, createdIds[i]!);
        await arrival;
        latenciesMs.push(performance.now() - t0);
      }

      const sorted = [...latenciesMs].sort((a, b) => a - b);
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 999;
      expect(p95).toBeLessThan(100);

      await expect
        .poll(async () => userB!.page.evaluate(() => window.__nova?.scene() ?? []))
        .toEqual(await userA!.page.evaluate(() => window.__nova?.scene() ?? []));

      await userB!.page.screenshot({ path: path.join(SCREENSHOT_DIR, 'E1.png') });
    } finally {
      await harness.closeAll();
    }
  });

  test('E2: live cursor, remote selection label, TopBar avatar, and disconnect cleanup', async ({
    browser,
  }) => {
    const harness = await createMultiplayerProject(browser, 'Eval-E2', ['OWNER', 'EDITOR']);
    try {
      const [userA, userB] = harness.sessions;

      // User A creates a rect and selects it
      const rectId = await userA!.page.evaluate(() => {
        const ed = window.__NOVA_EDITOR__?.editor;
        if (!ed) return '';
        const res = ed.commands.execute({
          type: 'createNode',
          input: {
            type: 'rect',
            name: 'Shared Card',
            x: 180,
            y: 140,
            width: 220,
            height: 140,
          },
        });
        const id = res.createdIds[0] ?? '';
        if (id) ed.selection.set([id]);
        return id;
      });
      expect(rectId.length).toBeGreaterThan(0);

      // User A moves mouse across canvas stage to publish cursor awareness
      const stageA = userA!.page.getByTestId('canvas-stage');
      const box = await stageA.boundingBox();
      expect(box).not.toBeNull();
      await userA!.page.mouse.move(box!.x + 280, box!.y + 210);
      await userA!.page.mouse.move(box!.x + 310, box!.y + 230, { steps: 4 });

      // User B sees User A's avatar in TopBar + cursor + selection in awareness
      await expect(userB!.page.getByTestId(`presence-avatar-${userA!.userId}`)).toBeVisible();
      await expect
        .poll(async () =>
          userB!.page.evaluate((ownerId) => {
            const remotes = window.__nova?.presences() ?? [];
            const owner = remotes.find((r) => r.presence.user.id === ownerId);
            return Boolean(
              owner &&
                owner.presence.cursor !== null &&
                owner.presence.selection.length === 1,
            );
          }, userA!.userId),
        )
        .toBe(true);

      await userB!.page.screenshot({ path: path.join(SCREENSHOT_DIR, 'E2.png') });

      // When User A closes browser context, User B cleans up User A's remote presence
      await userA!.context.close();
      await expect
        .poll(async () =>
          userB!.page.evaluate((ownerId) => {
            const remotes = window.__nova?.presences() ?? [];
            return remotes.some((r) => r.presence.user.id === ownerId);
          }, userA!.userId),
        )
        .toBe(false);
    } finally {
      await harness.closeAll();
    }
  });

  test('E3: concurrent LWW, different fields, Y.Text merge, and remote delete notification', async ({
    browser,
  }) => {
    const harness = await createMultiplayerProject(browser, 'Eval-E3', ['OWNER', 'EDITOR']);
    try {
      const [userA, userB] = harness.sessions;

      const { boxId, textId } = await userA!.page.evaluate(() => {
        const ed = window.__NOVA_EDITOR__?.editor;
        if (!ed) return { boxId: '', textId: '' };
        const boxRes = ed.commands.execute({
          type: 'createNode',
          input: {
            type: 'rect',
            name: 'Conflict Box',
            x: 120,
            y: 120,
            width: 180,
            height: 120,
          },
        });
        const txtRes = ed.commands.execute({
          type: 'createNode',
          input: {
            type: 'text',
            name: 'Shared Title',
            x: 120,
            y: 280,
            width: 320,
            height: 64,
            text: 'Hello',
          },
        });
        return {
          boxId: boxRes.createdIds[0] ?? '',
          textId: txtRes.createdIds[0] ?? '',
        };
      });

      await expect
        .poll(async () =>
          userB!.page.evaluate(
            (id) => Boolean(window.__nova?.scene().find((n) => n.id === id)),
            textId,
          ),
        )
        .toBe(true);

      // Subcase 1: different fields (A updates fill, B updates x)
      await Promise.all([
        userA!.page.evaluate((id) => {
          window.__NOVA_EDITOR__?.editor.commands.execute({
            type: 'updateNodes',
            patches: [{ id, patch: { fill: '#ff5733' } }],
          });
        }, boxId),
        userB!.page.evaluate((id) => {
          window.__NOVA_EDITOR__?.editor.commands.execute({
            type: 'updateNodes',
            patches: [{ id, patch: { x: 340 } }],
          });
        }, boxId),
      ]);

      await expect
        .poll(async () => {
          const [a, b] = await Promise.all([
            userA!.page.evaluate(
              (id) => window.__nova?.scene().find((n) => n.id === id),
              boxId,
            ),
            userB!.page.evaluate(
              (id) => window.__nova?.scene().find((n) => n.id === id),
              boxId,
            ),
          ]);
          return {
            same: JSON.stringify(a) === JSON.stringify(b),
            fill: a?.fill,
            x: a?.x,
          };
        })
        .toEqual({ same: true, fill: '#ff5733', x: 340 });

      // Subcase 2: concurrent same field (LWW convergence)
      await Promise.all([
        userA!.page.evaluate((id) => {
          window.__NOVA_EDITOR__?.editor.commands.execute({
            type: 'updateNodes',
            patches: [{ id, patch: { fill: '#22c55e' } }],
          });
        }, boxId),
        userB!.page.evaluate((id) => {
          window.__NOVA_EDITOR__?.editor.commands.execute({
            type: 'updateNodes',
            patches: [{ id, patch: { fill: '#f59e0b' } }],
          });
        }, boxId),
      ]);

      await expect
        .poll(async () => {
          const [fillA, fillB] = await Promise.all([
            userA!.page.evaluate(
              (id) => window.__nova?.scene().find((n) => n.id === id)?.fill,
              boxId,
            ),
            userB!.page.evaluate(
              (id) => window.__nova?.scene().find((n) => n.id === id)?.fill,
              boxId,
            ),
          ]);
          return {
            converged: fillA === fillB,
            valid: fillA === '#22c55e' || fillA === '#f59e0b',
          };
        })
        .toEqual({ converged: true, valid: true });

      // Subcase 3: concurrent Y.Text edits merge cleanly
      await Promise.all([
        userA!.page.evaluate((id) => {
          window.__NOVA_EDITOR__?.editor.commands.execute({
            type: 'editText',
            nodeId: id,
            index: 5,
            deleteCount: 0,
            insertText: ' World',
          });
        }, textId),
        userB!.page.evaluate((id) => {
          window.__NOVA_EDITOR__?.editor.commands.execute({
            type: 'editText',
            nodeId: id,
            index: 0,
            deleteCount: 0,
            insertText: 'Hi ',
          });
        }, textId),
      ]);

      await expect
        .poll(async () => {
          const [tA, tB] = await Promise.all([
            userA!.page.evaluate(
              (id) => window.__nova?.scene().find((n) => n.id === id)?.text,
              textId,
            ),
            userB!.page.evaluate(
              (id) => window.__nova?.scene().find((n) => n.id === id)?.text,
              textId,
            ),
          ]);
          return { tA, tB };
        })
        .toEqual({ tA: 'Hi Hello World', tB: 'Hi Hello World' });

      // Subcase 4: remote delete clears local selection and pops toast
      await userB!.page.evaluate((id) => {
        window.__NOVA_EDITOR__?.editor.selection.set([id]);
      }, boxId);

      await expect
        .poll(async () =>
          userB!.page.evaluate(
            () => window.__NOVA_EDITOR__?.editor.selection.getIds() ?? [],
          ),
        )
        .toEqual([boxId]);

      await userA!.page.evaluate((id) => {
        window.__NOVA_EDITOR__?.editor.commands.execute({
          type: 'deleteNodes',
          ids: [id],
        });
      }, boxId);

      await expect(
        userB!.page.getByText('Selected layer was deleted by a collaborator'),
      ).toBeVisible();
      await expect
        .poll(async () =>
          userB!.page.evaluate(
            () => window.__NOVA_EDITOR__?.editor.selection.getIds() ?? ['non-empty'],
          ),
        )
        .toEqual([]);

      await userB!.page.screenshot({ path: path.join(SCREENSHOT_DIR, 'E3.png') });
    } finally {
      await harness.closeAll();
    }
  });

  test('E4: offline edits persist in IndexedDB, merge upon reconnect, and survive reload', async ({
    browser,
  }) => {
    const harness = await createMultiplayerProject(browser, 'Eval-E4', ['OWNER', 'EDITOR']);
    try {
      const [userA, userB] = harness.sessions;

      // Create initial node online and confirm B sees it
      await userA!.page.evaluate(() => {
        window.__NOVA_EDITOR__?.editor.commands.execute({
          type: 'createNode',
          input: {
            type: 'rect',
            name: 'Initial Layer',
            x: 100,
            y: 100,
            width: 140,
            height: 100,
          },
        });
      });

      await expect
        .poll(async () =>
          userB!.page.evaluate(() => window.__nova?.scene().length ?? 0),
        )
        .toBe(1);

      // Go offline on User A
      await userA!.context.setOffline(true);
      await expect(userA!.page.getByTestId('connection-status')).toHaveAttribute(
        'data-state',
        'offline',
      );

      // Create 2 nodes on User A offline + 1 node on User B online
      await userA!.page.evaluate(() => {
        const ed = window.__NOVA_EDITOR__?.editor;
        if (!ed) return;
        ed.commands.execute({
          type: 'createNode',
          input: {
            type: 'rect',
            name: 'Offline A1',
            x: 280,
            y: 100,
            width: 120,
            height: 90,
          },
        });
        ed.commands.execute({
          type: 'createNode',
          input: {
            type: 'ellipse',
            name: 'Offline A2',
            x: 280,
            y: 220,
            width: 120,
            height: 90,
          },
        });
      });

      await userB!.page.evaluate(() => {
        window.__NOVA_EDITOR__?.editor.commands.execute({
          type: 'createNode',
          input: {
            type: 'rect',
            name: 'Online B1',
            x: 100,
            y: 230,
            width: 140,
            height: 90,
          },
        });
      });

      await expect
        .poll(async () =>
          userA!.page.evaluate(() => window.__nova?.scene().length ?? 0),
        )
        .toBe(3);
      await expect
        .poll(async () =>
          userB!.page.evaluate(() => window.__nova?.scene().length ?? 0),
        )
        .toBe(2);

      // Reconnect User A -> merge all 4 nodes on both tabs
      await userA!.context.setOffline(false);
      await expect(userA!.page.getByTestId('connection-status')).toHaveAttribute(
        'data-state',
        'connected',
        { timeout: 15_000 },
      );

      const getSortedNames = (nodes: CanvasNode[]) => nodes.map((n) => n.name).sort();
      const expectedNames = ['Initial Layer', 'Offline A1', 'Offline A2', 'Online B1'];

      await expect
        .poll(async () =>
          getSortedNames(await userA!.page.evaluate(() => window.__nova?.scene() ?? [])),
        )
        .toEqual(expectedNames);
      await expect
        .poll(async () =>
          getSortedNames(await userB!.page.evaluate(() => window.__nova?.scene() ?? [])),
        )
        .toEqual(expectedNames);

      // Reload User A -> confirm state reloads from DB/IndexedDB seamlessly
      await userA!.page.reload();
      await expect(userA!.page.getByTestId('connection-status')).toHaveAttribute(
        'data-state',
        'connected',
        { timeout: 15_000 },
      );
      await userA!.page.waitForFunction(() => Boolean(window.__nova));
      await expect
        .poll(async () =>
          getSortedNames(await userA!.page.evaluate(() => window.__nova?.scene() ?? [])),
        )
        .toEqual(expectedNames);

      await userA!.page.screenshot({ path: path.join(SCREENSHOT_DIR, 'E4.png') });
    } finally {
      await harness.closeAll();
    }
  });
});

test.describe('P1-T20 Offline Merge, Follow User & Text Undo Evals (E9-E10)', () => {
  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('E9: offline 3-shape edit on B merges cleanly with 2-shape edit on A + Follow User syncs viewport', async ({
    browser,
  }) => {
    const harness = await createMultiplayerProject(browser, 'Eval-E9', ['OWNER', 'EDITOR']);
    try {
      const [userA, userB] = harness.sessions;

      // Verify Follow User while both users are online
      const followAvatar = userA!.page.getByTestId(`presence-avatar-${userB!.userId}`);
      await expect(followAvatar).toBeVisible({ timeout: 15_000 });

      await userB!.page.evaluate(() => {
        window.__NOVA_EDITOR__?.editor.viewport.setState({ x: 240, y: 160, zoom: 1.5 });
      });

      await followAvatar.click();
      await expect(userA!.page.getByTestId('following-user-banner')).toContainText(
        userB!.account.name,
      );
      await expect
        .poll(async () =>
          userA!.page.evaluate(() => window.__NOVA_EDITOR__?.editor.viewport.getState()),
        )
        .toEqual({ x: 240, y: 160, zoom: 1.5 });

      await userA!.page.getByTestId('stop-following-btn').click();
      await expect(userA!.page.getByTestId('following-user-banner')).toBeHidden();

      // Reset viewports for deterministic screenshot
      await Promise.all([
        userA!.page.evaluate(() => {
          window.__NOVA_EDITOR__?.editor.viewport.setState({ x: 0, y: 0, zoom: 1 });
        }),
        userB!.page.evaluate(() => {
          window.__NOVA_EDITOR__?.editor.viewport.setState({ x: 0, y: 0, zoom: 1 });
        }),
      ]);

      // Create 5 baseline shapes on User A
      const shapeIds = await userA!.page.evaluate(() => {
        const ed = window.__NOVA_EDITOR__?.editor;
        if (!ed) return [] as string[];
        const ids: string[] = [];
        for (let i = 0; i < 5; i += 1) {
          const res = ed.commands.execute({
            type: 'createNode',
            input: {
              type: 'rect',
              name: `Shape ${i + 1}`,
              x: 80 + i * 160,
              y: 120,
              width: 120,
              height: 90,
              fill: '#64748B',
            },
          });
          if (res.createdIds[0]) ids.push(res.createdIds[0]);
        }
        return ids;
      });
      expect(shapeIds).toHaveLength(5);

      // Confirm B sees all 5 baseline shapes
      await expect
        .poll(async () => userB!.page.evaluate(() => window.__nova?.scene().length ?? 0))
        .toBe(5);

      // User B goes offline
      await userB!.context.setOffline(true);
      await expect(userB!.page.getByTestId('connection-status')).toHaveAttribute(
        'data-state',
        'offline',
        { timeout: 10_000 },
      );

      // B edits 3 shapes offline; A edits 2 other shapes online
      await userB!.page.evaluate((ids) => {
        const ed = window.__NOVA_EDITOR__?.editor;
        if (!ed) return;
        ed.commands.execute({
          type: 'updateNodes',
          patches: [
            { id: ids[0]!, patch: { x: 80, y: 260, fill: '#10B981' } },
            { id: ids[1]!, patch: { x: 240, y: 260, fill: '#10B981' } },
            { id: ids[2]!, patch: { x: 400, y: 260, fill: '#10B981' } },
          ],
        });
      }, shapeIds);

      await userA!.page.evaluate((ids) => {
        const ed = window.__NOVA_EDITOR__?.editor;
        if (!ed) return;
        ed.commands.execute({
          type: 'updateNodes',
          patches: [
            { id: ids[3]!, patch: { x: 560, y: 340, fill: '#3B82F6' } },
            { id: ids[4]!, patch: { x: 720, y: 340, fill: '#3B82F6' } },
          ],
        });
      }, shapeIds);

      // Restore User B online and wait for reconnect + merge
      await userB!.context.setOffline(false);
      await expect(userB!.page.getByTestId('connection-status')).toHaveAttribute(
        'data-state',
        'connected',
        { timeout: 15_000 },
      );

      const expectedMerged = [
        { id: shapeIds[0]!, x: 80, y: 260, fill: '#10B981' },
        { id: shapeIds[1]!, x: 240, y: 260, fill: '#10B981' },
        { id: shapeIds[2]!, x: 400, y: 260, fill: '#10B981' },
        { id: shapeIds[3]!, x: 560, y: 340, fill: '#3B82F6' },
        { id: shapeIds[4]!, x: 720, y: 340, fill: '#3B82F6' },
      ];

      const summarize = (nodes: CanvasNode[]) =>
        shapeIds.map((id) => {
          const n = nodes.find((item) => item.id === id);
          return { id, x: n?.x ?? -1, y: n?.y ?? -1, fill: n?.fill ?? null };
        });

      await expect
        .poll(async () =>
          summarize(await userA!.page.evaluate(() => window.__nova?.scene() ?? [])),
        )
        .toEqual(expectedMerged);

      await expect
        .poll(async () =>
          summarize(await userB!.page.evaluate(() => window.__nova?.scene() ?? [])),
        )
        .toEqual(expectedMerged);

      await userA!.page.screenshot({ path: path.join(SCREENSHOT_DIR, 'E9.png') });
    } finally {
      await harness.closeAll();
    }
  });

  test('E10: concurrent text edits keep both users chars and A undo reverts only A insertion', async ({
    browser,
  }) => {
    const harness = await createMultiplayerProject(browser, 'Eval-E10', ['OWNER', 'EDITOR']);
    try {
      const [userA, userB] = harness.sessions;

      const textId = await userA!.page.evaluate(() => {
        const ed = window.__NOVA_EDITOR__?.editor;
        if (!ed) return '';
        const res = ed.commands.execute({
          type: 'createNode',
          input: {
            type: 'text',
            name: 'Collab Headline',
            x: 160,
            y: 180,
            width: 480,
            height: 72,
            text: 'Hello',
            fontSize: 32,
            fill: '#F8FAFC',
          },
        });
        // Separate node creation from subsequent typing undo boundary
        ed.history.stopCapturing();
        return res.createdIds[0] ?? '';
      });
      expect(textId).not.toBe('');

      await expect
        .poll(async () =>
          userB!.page.evaluate(
            (id) => window.__nova?.scene().find((n) => n.id === id)?.text,
            textId,
          ),
        )
        .toBe('Hello');

      // Concurrent insertions by A (suffix) and B (prefix)
      await Promise.all([
        userA!.page.evaluate((id) => {
          window.__NOVA_EDITOR__?.editor.commands.execute({
            type: 'editText',
            nodeId: id,
            index: 5,
            deleteCount: 0,
            insertText: ' World',
          });
        }, textId),
        userB!.page.evaluate((id) => {
          window.__NOVA_EDITOR__?.editor.commands.execute({
            type: 'editText',
            nodeId: id,
            index: 0,
            deleteCount: 0,
            insertText: 'NOVA: ',
          });
        }, textId),
      ]);

      await expect
        .poll(async () => {
          const [tA, tB] = await Promise.all([
            userA!.page.evaluate(
              (id) => window.__nova?.scene().find((n) => n.id === id)?.text,
              textId,
            ),
            userB!.page.evaluate(
              (id) => window.__nova?.scene().find((n) => n.id === id)?.text,
              textId,
            ),
          ]);
          return { tA, tB };
        })
        .toEqual({ tA: 'NOVA: Hello World', tB: 'NOVA: Hello World' });

      // User A triggers Undo -> only A's " World" insertion is reverted; B's "NOVA: " remains
      await userA!.page.getByRole('button', { name: 'Undo' }).click();

      await expect
        .poll(async () => {
          const [tA, tB] = await Promise.all([
            userA!.page.evaluate(
              (id) => window.__nova?.scene().find((n) => n.id === id)?.text,
              textId,
            ),
            userB!.page.evaluate(
              (id) => window.__nova?.scene().find((n) => n.id === id)?.text,
              textId,
            ),
          ]);
          return { tA, tB };
        })
        .toEqual({ tA: 'NOVA: Hello', tB: 'NOVA: Hello' });

      await userA!.page.screenshot({ path: path.join(SCREENSHOT_DIR, 'E10.png') });
    } finally {
      await harness.closeAll();
    }
  });
});
