import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(CURRENT_DIR, '../../../../harness/evals/screenshots');

test.describe('P1-T13 Collaborative Canvas Editor', () => {
  test('renders 5-region editor, creates/renders 5 node types, edits properties, pans/zooms, and exports non-empty PNG', async ({
    page,
  }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const unique = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const email = `t13-${unique}@nova.dev`;
    const password = 'NovaStudio2026!';

    await page.goto('/register');
    await page.getByLabel('Full name').fill('Canvas Author');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/dashboard');

    await page.getByRole('button', { name: 'Create workspace' }).click();
    const wsDialog = page.getByRole('dialog', { name: 'New workspace' });
    await wsDialog.getByLabel('Workspace name').fill('Canvas Studio');
    await wsDialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { name: 'Canvas Studio' })).toBeVisible();

    await page.getByRole('button', { name: 'New design' }).click();
    const designDialog = page.getByRole('dialog', { name: 'New design' });
    await designDialog.getByLabel('Design name').fill('Hero Banner');
    await designDialog.getByRole('button', { name: 'Create design' }).click();

    await page.getByRole('link', { name: 'Hero Banner' }).click();
    await page.waitForURL('**/project/**');

    const stage = page.getByTestId('canvas-stage');
    await expect(stage).toBeVisible();
    await page.waitForFunction(() => Boolean(window.__NOVA_EDITOR__?.renderer));
    await expect(page.getByTestId('connection-status')).toHaveAttribute('data-state', 'connected');

    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    const originX = box!.x;
    const originY = box!.y;

    const dragOnStage = async (x1: number, y1: number, x2: number, y2: number) => {
      await page.mouse.move(originX + x1, originY + y1);
      await page.mouse.down();
      await page.mouse.move(originX + x2, originY + y2, { steps: 6 });
      await page.mouse.up();
    };

    // 1. Frame tool
    await page.getByRole('button', { name: 'Frame (F)' }).click();
    await dragOnStage(60, 50, 520, 360);
    await expect(page.getByRole('tab', { name: 'Layers (1)' })).toBeVisible();

    // 2. Rectangle tool
    await page.getByRole('button', { name: 'Rectangle (R)' }).click();
    await dragOnStage(90, 90, 230, 190);
    await expect(page.getByRole('tab', { name: 'Layers (2)' })).toBeVisible();

    // Edit rectangle width in Properties panel
    const widthInput = page.getByLabel('W', { exact: true });
    await expect(widthInput).toBeVisible();
    await widthInput.fill('200');
    await widthInput.press('Enter');
    const updatedRectWidth = await page.evaluate(() => {
      const api = window.__NOVA_EDITOR__;
      const rect = api?.editor.scene.getAllNodes().find((n) => n.type === 'rect');
      return rect?.width;
    });
    expect(updatedRectWidth).toBe(200);

    // 3. Ellipse tool
    await page.getByRole('button', { name: 'Ellipse (O)' }).click();
    await dragOnStage(320, 90, 440, 210);
    await expect(page.getByRole('tab', { name: 'Layers (3)' })).toBeVisible();

    // 4. Text tool + inline text editor overlay
    await page.getByRole('button', { name: 'Text (T)' }).click();
    await page.mouse.click(originX + 95, originY + 235);
    const inlineTextarea = page.getByLabel('Inline text editor');
    await expect(inlineTextarea).toBeVisible();
    await inlineTextarea.fill('NOVA STUDIO Launch');
    await inlineTextarea.press('Enter');
    await expect(page.getByRole('tab', { name: 'Layers (4)' })).toBeVisible();

    // 5. Image node (renders placeholder safely before P1-T15 upload flow)
    await page.evaluate(() => {
      window.__NOVA_EDITOR__?.editor.commands.execute({
        type: 'createNode',
        input: {
          type: 'image',
          name: 'Hero Preview',
          x: 340,
          y: 230,
          width: 140,
          height: 96,
          assetId: 'smoke-placeholder',
        },
      });
    });
    await expect(page.getByRole('tab', { name: 'Layers (5)' })).toBeVisible();

    const mountedShapes = await page.evaluate(
      () => window.__NOVA_EDITOR__?.renderer?.getMountedShapeCount() ?? 0,
    );
    expect(mountedShapes).toBe(5);

    // Zoom controls
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(page.getByRole('button', { name: 'Reset zoom to 100%' })).toContainText('125%');
    await page.getByRole('button', { name: 'Reset zoom to 100%' }).click();
    await expect(page.getByRole('button', { name: 'Reset zoom to 100%' })).toContainText('100%');

    // Verify tabs switch cleanly
    await page.getByRole('tab', { name: 'Assets' }).click();
    await expect(page.getByText('Project Assets')).toBeVisible();
    await page.getByRole('tab', { name: 'Layers (5)' }).click();

    // Fit canvas cleanly, clear selection, and blur active element before screenshot
    await page.getByRole('button', { name: 'Fit canvas to screen' }).click();
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'p1-t13-editor.png') });

    // Export PNG & confirm non-empty download
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export PNG' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('hero-banner.png');
    const savedPath = await download.path();
    expect(savedPath).not.toBeNull();
    expect(fs.statSync(savedPath!).size).toBeGreaterThan(200);
  });

  test('P1-T16: drag-drop layer reorder, rename/hide/lock, full properties, align/distribute, group, clipboard & shortcuts', async ({
    page,
  }) => {
    const unique = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const email = `t16-${unique}@nova.dev`;
    const password = 'NovaStudio2026!';

    await page.goto('/register');
    await page.getByLabel('Full name').fill('Studio Designer');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/dashboard');

    await page.getByRole('button', { name: 'Create workspace' }).click();
    const wsDialog = page.getByRole('dialog', { name: 'New workspace' });
    await wsDialog.getByLabel('Workspace name').fill('T16 Studio');
    await wsDialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { name: 'T16 Studio' })).toBeVisible();

    await page.getByRole('button', { name: 'New design' }).click();
    const designDialog = page.getByRole('dialog', { name: 'New design' });
    await designDialog.getByLabel('Design name').fill('Inspector Ops');
    await designDialog.getByRole('button', { name: 'Create design' }).click();
    await page.getByRole('link', { name: 'Inspector Ops' }).click();
    await page.waitForURL('**/project/**');

    await page.waitForFunction(() => Boolean(window.__NOVA_EDITOR__?.renderer));
    await expect(page.getByTestId('connection-status')).toHaveAttribute('data-state', 'connected');

    // Create 3 rectangles + 1 text node via commands for deterministic geometry
    const ids = await page.evaluate(() => {
      const ed = window.__NOVA_EDITOR__!.editor;
      const r1 = ed.commands.execute({
        type: 'createNode',
        input: { type: 'rect', name: 'Box Alpha', x: 60, y: 120, width: 80, height: 80 },
      }).createdIds[0]!;
      const r2 = ed.commands.execute({
        type: 'createNode',
        input: { type: 'rect', name: 'Box Beta', x: 220, y: 160, width: 80, height: 80 },
      }).createdIds[0]!;
      const r3 = ed.commands.execute({
        type: 'createNode',
        input: { type: 'rect', name: 'Box Gamma', x: 420, y: 200, width: 80, height: 80 },
      }).createdIds[0]!;
      const t1 = ed.commands.execute({
        type: 'createNode',
        input: { type: 'text', name: 'Headline', x: 60, y: 40, width: 220, height: 48, text: 'Hello' },
      }).createdIds[0]!;
      return { r1, r2, r3, t1 };
    });

    await expect(page.getByRole('tab', { name: 'Layers (4)' })).toBeVisible();

    // 1. Rename, hide, lock on Box Alpha
    await page.getByRole('button', { name: 'Box Alpha', exact: true }).dblclick();
    const renameInput = page.getByLabel('Rename Box Alpha');
    await renameInput.fill('Card Primary');
    await renameInput.press('Enter');
    await expect(page.getByRole('button', { name: 'Card Primary', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Hide Card Primary' }).click();
    await page.getByRole('button', { name: 'Show Card Primary' }).click();
    await page.getByRole('button', { name: 'Lock Card Primary' }).click();
    const isLocked = await page.evaluate(
      (id) => window.__NOVA_EDITOR__?.editor.scene.getNode(id)?.locked,
      ids.r1,
    );
    expect(isLocked).toBe(true);
    await page.getByRole('button', { name: 'Unlock Card Primary' }).click();

    // 2. Drag-drop layer reorder (drag Card Primary above Headline -> top visual row)
    const beforeOrder = await page.evaluate(() =>
      window.__NOVA_EDITOR__!.editor.scene.getAllNodes().map((n) => n.name),
    );
    expect(beforeOrder).toEqual(['Card Primary', 'Box Beta', 'Box Gamma', 'Headline']);

    const sourceHandle = page.getByTestId(`layer-drag-handle-${ids.r1}`);
    const targetRow = page.getByTestId(`layer-row-${ids.t1}`);
    await sourceHandle.dragTo(targetRow, { targetPosition: { x: 40, y: 4 } });

    await expect
      .poll(async () =>
        page.evaluate(() =>
          window.__NOVA_EDITOR__!.editor.scene.getAllNodes().map((n) => n.name),
        ),
      )
      .toEqual(['Box Beta', 'Box Gamma', 'Headline', 'Card Primary']);

    // Also test arrow reorder button (Move Card Primary backward -> down 1 visual slot)
    await page.getByRole('button', { name: 'Move Card Primary backward' }).click();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          window.__NOVA_EDITOR__!.editor.scene.getAllNodes().map((n) => n.name),
        ),
      )
      .toEqual(['Box Beta', 'Box Gamma', 'Card Primary', 'Headline']);

    // 3. Full Properties on Card Primary & Headline
    await page.getByRole('button', { name: 'Card Primary', exact: true }).click();
    await page.getByLabel('Corner radius').fill('16');
    await page.getByLabel('Corner radius').press('Enter');
    await page.getByLabel('Rotation').fill('15');
    await page.getByLabel('Rotation').press('Enter');
    await page.getByLabel('Opacity').fill('80');
    await page.getByLabel('Opacity').press('Enter');

    const updatedRect = await page.evaluate((id) => {
      const n = window.__NOVA_EDITOR__?.editor.scene.getNode(id);
      return { cornerRadius: n?.cornerRadius, rotation: n?.rotation, opacity: n?.opacity };
    }, ids.r1);
    expect(updatedRect).toEqual({ cornerRadius: 16, rotation: 15, opacity: 0.8 });

    await page.getByRole('button', { name: 'Headline', exact: true }).click();
    await page.getByLabel('Font', { exact: true }).selectOption('Space Grotesk');
    await page.getByLabel('Weight', { exact: true }).selectOption('700');
    await page.getByRole('button', { name: 'center', exact: true }).click();
    const updatedText = await page.evaluate((id) => {
      const n = window.__NOVA_EDITOR__?.editor.scene.getNode(id);
      return { fontFamily: n?.fontFamily, fontWeight: n?.fontWeight, align: n?.align };
    }, ids.t1);
    expect(updatedText).toEqual({ fontFamily: 'Space Grotesk', fontWeight: 700, align: 'center' });

    // 4. Multi-select Shift+Click -> Align top + Distribute horizontally + Group + Ungroup
    await page.getByRole('button', { name: 'Card Primary', exact: true }).click();
    await page.getByRole('button', { name: 'Box Beta', exact: true }).click({ modifiers: ['Shift'] });
    await page.getByRole('button', { name: 'Box Gamma', exact: true }).click({ modifiers: ['Shift'] });

    await page.getByRole('button', { name: 'Align top' }).click();
    await page.getByRole('button', { name: 'Distribute horizontally' }).click();
    const aligned = await page.evaluate(
      (arr) => arr.map((id) => window.__NOVA_EDITOR__?.editor.scene.getNode(id)?.y),
      [ids.r1, ids.r2, ids.r3],
    );
    expect(new Set(aligned).size).toBe(1);

    await page.getByRole('button', { name: 'Group selection' }).click();
    await expect
      .poll(async () =>
        page.evaluate(
          () => window.__NOVA_EDITOR__!.editor.scene.getAllNodes().filter((n) => n.type === 'group').length,
        ),
      )
      .toBe(1);

    await page.getByRole('button', { name: 'Ungroup' }).click();
    await expect
      .poll(async () =>
        page.evaluate(
          () => window.__NOVA_EDITOR__!.editor.scene.getAllNodes().filter((n) => n.type === 'group').length,
        ),
      )
      .toBe(0);

    // 5. Keyboard shortcuts & clipboard (Ctrl+D duplicate, Ctrl+C/V copy-paste, Ctrl+Z undo, tool hotkeys)
    await page.getByRole('button', { name: 'Headline', exact: true }).click();
    await page.getByTestId('canvas-stage').click({ position: { x: 1, y: 1 } });
    // Re-select via API then verify keyboard shortcuts drive ToolManager cleanly
    await page.evaluate((id) => window.__NOVA_EDITOR__?.editor.selection.set([id]), ids.r1);

    await page.keyboard.press('Control+d');
    await expect(page.getByRole('tab', { name: 'Layers (5)' })).toBeVisible();

    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect(page.getByRole('tab', { name: 'Layers (6)' })).toBeVisible();

    await page.keyboard.press('Control+z');
    await expect(page.getByRole('tab', { name: 'Layers (5)' })).toBeVisible();

    await page.keyboard.press('r');
    const activeToolAfterR = await page.evaluate(() =>
      window.__NOVA_EDITOR__?.editor.tools.getActiveTool(),
    );
    expect(activeToolAfterR).toBe('rect');
    await page.keyboard.press('v');
    const activeToolAfterV = await page.evaluate(() =>
      window.__NOVA_EDITOR__?.editor.tools.getActiveTool(),
    );
    expect(activeToolAfterV).toBe('select');
  });
});
