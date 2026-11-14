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
});
