import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMultiplayerProject, expect, test } from '../fixtures/multiplayer';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(CURRENT_DIR, '../../../../harness/evals/screenshots');

test.describe('P1-T19 Version History & Restore Eval (E8)', () => {
  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('E8: save v1 checkpoint, apply 5 edits, preview read-only, restore to v1 across peers with Before restore auto-backup', async ({
    browser,
  }) => {
    const harness = await createMultiplayerProject(browser, 'Eval-E8', ['OWNER', 'EDITOR']);
    const [userA, userB] = harness.sessions;
    if (!userA || !userB) {
      throw new Error('Expected 2 multiplayer sessions');
    }

    try {
      // 1. User A creates initial v1 shape and confirms User B sees it
      const v1NodeId = await userA.page.evaluate(() => {
        const res = window.__NOVA_EDITOR__?.editor.commands.execute({
          type: 'createNode',
          input: {
            type: 'rect',
            name: 'v1 Card',
            x: 100,
            y: 100,
            width: 200,
            height: 120,
            fill: '#7C5CFF',
          },
        });
        return res?.createdIds[0] ?? '';
      });
      expect(v1NodeId.length).toBeGreaterThan(0);

      await expect
        .poll(async () =>
          userB.page.evaluate(() => window.__nova?.scene().map((n) => n.name) ?? []),
        )
        .toEqual(['v1 Card']);

      // 2. User A opens Version History drawer and saves checkpoint "v1"
      await userA.page.getByTestId('version-history-btn').click();
      await expect(userA.page.getByTestId('version-history-drawer')).toBeVisible();
      await userA.page.locator('#version-label-input').fill('v1');
      await userA.page.getByTestId('create-version-submit-btn').click();

      const versionList = userA.page.getByTestId('version-history-list');
      await expect(versionList).toContainText('v1', { timeout: 10_000 });
      await userA.page.getByRole('button', { name: 'Close version history' }).click();

      // 3. User A makes 5 edits on the live canvas
      await userA.page.evaluate((targetId: string) => {
        const ed = window.__NOVA_EDITOR__!.editor;
        // Edit 1
        ed.commands.execute({
          type: 'createNode',
          input: { type: 'rect', name: 'Temp Box 1', x: 340, y: 100, width: 120, height: 90 },
        });
        // Edit 2
        ed.commands.execute({
          type: 'createNode',
          input: { type: 'ellipse', name: 'Temp Ellipse 2', x: 100, y: 260, width: 140, height: 90 },
        });
        // Edit 3
        ed.commands.execute({
          type: 'updateNodes',
          patches: [{ id: targetId, patch: { x: 220, y: 180 } }],
        });
        // Edit 4
        ed.commands.execute({
          type: 'updateNodes',
          patches: [{ id: targetId, patch: { fill: '#22D3EE' } }],
        });
        // Edit 5
        ed.commands.execute({
          type: 'createNode',
          input: { type: 'text', name: 'Temp Label 3', text: 'Draft V2', x: 340, y: 260, width: 160, height: 48 },
        });
      }, v1NodeId);

      // Confirm post-edit scene synced to User B
      await expect
        .poll(async () =>
          userB.page.evaluate(() => {
            const nodes = window.__nova?.scene() ?? [];
            const card = nodes.find((n) => n.name === 'v1 Card');
            return {
              count: nodes.length,
              x: card?.x,
              y: card?.y,
              fill: card?.fill,
            };
          }),
        )
        .toEqual({
          count: 4,
          x: 220,
          y: 180,
          fill: '#22D3EE',
        });

      // User B also performs a local edit so we can verify restore clears User B's undo stack
      await userB.page.evaluate(() => {
        window.__NOVA_EDITOR__?.editor.commands.execute({
          type: 'createNode',
          input: { type: 'rect', name: 'User B Addition', x: 500, y: 100, width: 100, height: 100 },
        });
      });
      await expect
        .poll(async () => userA.page.evaluate(() => window.__nova?.scene().length ?? 0))
        .toBe(5);
      const userBCanUndoBefore = await userB.page.evaluate(
        () => window.__NOVA_EDITOR__?.editor.history.canUndo() ?? false,
      );
      expect(userBCanUndoBefore).toBe(true);

      // 4. User A re-opens Version History, previews "v1" in read-only mode, then restores it
      await userA.page.getByTestId('version-history-btn').click();
      const v1Row = userA.page
        .locator('[data-testid^="version-item-"]', { hasText: 'v1' })
        .first();
      await expect(v1Row).toBeVisible({ timeout: 10_000 });

      await v1Row.getByRole('button', { name: 'Preview' }).click();
      const previewBanner = userA.page.getByTestId('version-preview-banner');
      await expect(previewBanner).toBeVisible({ timeout: 10_000 });
      await expect(previewBanner).toContainText('v1');
      await expect(userA.page.getByRole('tab', { name: 'Layers (1)' })).toBeVisible();

      await v1Row.getByRole('button', { name: 'Restore', exact: true }).click();
      await expect(userA.page.getByTestId('restore-confirm-panel')).toBeVisible();
      await userA.page.getByTestId('confirm-restore-btn').click();

      // 5. Preview banner closes and BOTH User A and User B converge back to v1 state
      await expect(previewBanner).toBeHidden({ timeout: 10_000 });

      await expect
        .poll(async () =>
          userA.page.evaluate(() =>
            (window.__nova?.scene() ?? []).map((n) => ({
              name: n.name,
              x: n.x,
              y: n.y,
              fill: n.fill,
            })),
          ),
        )
        .toEqual([{ name: 'v1 Card', x: 100, y: 100, fill: '#7C5CFF' }]);

      await expect
        .poll(async () =>
          userB.page.evaluate(() =>
            (window.__nova?.scene() ?? []).map((n) => ({
              name: n.name,
              x: n.x,
              y: n.y,
              fill: n.fill,
            })),
          ),
        )
        .toEqual([{ name: 'v1 Card', x: 100, y: 100, fill: '#7C5CFF' }]);

      await expect(userB.page.getByText('Project restored to another version')).toBeVisible({
        timeout: 10_000,
      });

      const userBCanUndoAfter = await userB.page.evaluate(
        () => window.__NOVA_EDITOR__?.editor.history.canUndo() ?? true,
      );
      expect(userBCanUndoAfter).toBe(false);

      // 6. Version History lists automatic "Before restore" snapshot with Auto badge
      await expect(versionList).toContainText('Before restore', { timeout: 10_000 });
      const backupRow = userA.page
        .locator('[data-testid^="version-item-"]', { hasText: 'Before restore' })
        .first();
      await expect(backupRow).toContainText('Auto');

      await userA.page.screenshot({ path: path.join(SCREENSHOT_DIR, 'E8.png') });
    } finally {
      await harness.closeAll();
    }
  });
});
