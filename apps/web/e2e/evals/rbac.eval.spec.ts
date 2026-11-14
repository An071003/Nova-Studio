import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEEDED_ACCOUNTS, expect, test } from '../fixtures/multiplayer';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(CURRENT_DIR, '../../../../harness/evals/screenshots');

test.describe('P1-T17 Members, Invites & Live Role Downgrade Evals (E6)', () => {
  test.beforeAll(() => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  });

  test('E6: invite accept flow, LAST_OWNER guard, and live EDITOR -> VIEWER downgrade reconnect', async ({
    browser,
  }) => {
    const runId = Date.now();
    const userCEmail = `e6-member-${runId}@nova.dev`;
    const workspaceName = `E6 Studio ${runId}`;
    const projectName = `E6 Canvas ${runId}`;

    const ownerContext = await browser.newContext();
    const userCContext = await browser.newContext();

    try {
      const ownerPage = await ownerContext.newPage();

      // 1. Owner signs in via UI & creates an isolated workspace + project
      await ownerPage.goto('/login');
      await ownerPage.locator('#login-email').fill(SEEDED_ACCOUNTS.OWNER.email);
      await ownerPage.locator('#login-password').fill(SEEDED_ACCOUNTS.OWNER.password);
      await ownerPage.getByRole('button', { name: 'Sign in' }).click();
      await expect(ownerPage).toHaveURL(/\/dashboard/, { timeout: 15_000 });

      await ownerPage.getByRole('button', { name: 'New workspace' }).click();
      await ownerPage.locator('#workspace-name').fill(workspaceName);
      await ownerPage.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
      await expect(ownerPage.getByRole('heading', { name: workspaceName })).toBeVisible({
        timeout: 10_000,
      });

      await ownerPage.getByRole('button', { name: 'New design' }).click();
      await ownerPage.locator('#new-design-name').fill(projectName);
      await ownerPage.getByRole('dialog').getByRole('button', { name: 'Create design', exact: true }).click();
      await expect(ownerPage.getByRole('link', { name: projectName })).toBeVisible({
        timeout: 10_000,
      });

      // 2. Open Members dialog, verify LAST_OWNER guard, and create EDITOR invite link
      await ownerPage.getByTestId('manage-members-btn').click();
      const ownerRoleSelect = ownerPage.getByRole('combobox', {
        name: `Role for ${SEEDED_ACCOUNTS.OWNER.name}`,
      });
      await expect(ownerRoleSelect).toHaveValue('OWNER');
      await ownerRoleSelect.selectOption('EDITOR');

      await expect(ownerPage.getByTestId('members-error-banner')).toContainText(/owner/i, {
        timeout: 10_000,
      });
      await expect(ownerRoleSelect).toHaveValue('OWNER');

      await ownerPage.locator('#invite-role').selectOption('EDITOR');
      await ownerPage.getByTestId('create-invite-btn').click();
      const inviteInput = ownerPage.getByTestId('invite-url-input');
      await expect(inviteInput).toBeVisible({ timeout: 10_000 });
      const inviteUrl = await inviteInput.inputValue();
      expect(inviteUrl).toContain('/invite/');

      await ownerPage.getByRole('button', { name: 'Close dialog' }).click();

      // 3. New User C opens invite link, registers with ?next=/invite/<token>, accepts, opens canvas
      const userCPage = await userCContext.newPage();
      await userCPage.goto(inviteUrl);
      await expect(userCPage.getByRole('heading', { name: 'Workspace invitation' })).toBeVisible({
        timeout: 10_000,
      });

      await userCPage.getByRole('link', { name: 'Create account' }).click();
      await expect(userCPage).toHaveURL(/\/register\?next=/);
      await userCPage.locator('#register-name').fill('Collaborator C');
      await userCPage.locator('#register-email').fill(userCEmail);
      await userCPage.locator('#register-password').fill('StrongPassword1!');
      await userCPage.getByRole('button', { name: 'Create account' }).click();

      await expect(userCPage).toHaveURL(/\/invite\//, { timeout: 15_000 });
      await userCPage.getByTestId('accept-invite-btn').click();

      await expect(userCPage).toHaveURL(/\/dashboard/, { timeout: 15_000 });
      await userCPage.getByRole('link', { name: projectName }).first().click();

      await expect(userCPage).toHaveURL(/\/project\//, { timeout: 15_000 });
      await expect(userCPage.getByTestId('connection-status')).toHaveAttribute(
        'data-state',
        'connected',
        { timeout: 15_000 },
      );

      // Verify User C connects as EDITOR and can edit canvas
      const rectBtnC = userCPage.getByRole('button', { name: 'Rectangle (R)' });
      await expect(rectBtnC).toBeEnabled();
      await expect(userCPage.locator('header')).toContainText('EDITOR');

      const createdId = await userCPage.evaluate(() => {
        const res = window.__NOVA_EDITOR__?.editor.commands.execute({
          type: 'createNode',
          input: {
            type: 'rect',
            name: 'Editor C Card',
            x: 180,
            y: 140,
            width: 240,
            height: 140,
          },
        });
        return res?.createdIds[0] ?? '';
      });
      expect(createdId.length).toBeGreaterThan(0);

      // 4. Owner re-opens Members dialog and downgrades Collaborator C from EDITOR -> VIEWER
      await ownerPage.getByTestId('manage-members-btn').click();
      const userCRoleSelect = ownerPage.getByRole('combobox', {
        name: 'Role for Collaborator C',
      });
      await expect(userCRoleSelect).toHaveValue('EDITOR', { timeout: 10_000 });
      await userCRoleSelect.selectOption('VIEWER');
      await expect(userCRoleSelect).toHaveValue('VIEWER', { timeout: 10_000 });

      // 5. User C's open editor automatically reconnects in VIEWER read-only mode
      await expect(userCPage.locator('header')).toContainText('VIEWER', { timeout: 15_000 });
      await expect(rectBtnC).toBeDisabled({ timeout: 10_000 });
      await expect(userCPage.getByTestId('connection-status')).toHaveAttribute(
        'data-state',
        'connected',
        { timeout: 15_000 },
      );

      const isReadOnlyNow = await userCPage.evaluate(
        () => window.__NOVA_EDITOR__?.editor.commands.isReadOnly() ?? false,
      );
      expect(isReadOnlyNow).toBe(true);

      const blockedCreateCount = await userCPage.evaluate(() => {
        const res = window.__NOVA_EDITOR__?.editor.commands.execute({
          type: 'createNode',
          input: {
            type: 'rect',
            name: 'Blocked After Downgrade',
            x: 50,
            y: 50,
            width: 80,
            height: 80,
          },
        });
        return res?.createdIds.length ?? -1;
      });
      expect(blockedCreateCount).toBe(0);

      await userCPage.screenshot({ path: path.join(SCREENSHOT_DIR, 'E6.png') });
    } finally {
      await ownerContext.close();
      await userCContext.close();
    }
  });

  test('E7: project-level EDITOR -> VIEWER override, strict Viewer read-only UI, and server rejection on raw Y.Doc tamper', async ({
    browser,
  }) => {
    const runId = Date.now();
    const projectName = `E7 Override Deck ${runId}`;

    const ownerContext = await browser.newContext();
    const editorContext = await browser.newContext();

    try {
      const ownerPage = await ownerContext.newPage();

      // 1. OWNER signs in, selects seeded workspace "Nova Demo Studio", creates project & node
      await ownerPage.goto('/login');
      await ownerPage.locator('#login-email').fill(SEEDED_ACCOUNTS.OWNER.email);
      await ownerPage.locator('#login-password').fill(SEEDED_ACCOUNTS.OWNER.password);
      await ownerPage.getByRole('button', { name: 'Sign in' }).click();
      await expect(ownerPage).toHaveURL(/\/dashboard/, { timeout: 15_000 });

      await ownerPage.getByRole('button', { name: /Nova Demo Studio/i }).first().click();
      await expect(ownerPage.getByRole('heading', { name: 'Nova Demo Studio' })).toBeVisible({
        timeout: 10_000,
      });

      await ownerPage.getByRole('button', { name: 'New design' }).click();
      await ownerPage.locator('#new-design-name').fill(projectName);
      await ownerPage.getByRole('dialog').getByRole('button', { name: 'Create design', exact: true }).click();

      const projectLink = ownerPage.getByRole('link', { name: projectName }).first();
      await expect(projectLink).toBeVisible({ timeout: 10_000 });
      await projectLink.click();

      await expect(ownerPage).toHaveURL(/\/project\/[^/?#]+/, { timeout: 15_000 });
      const projectPath = new URL(ownerPage.url()).pathname;
      await expect(ownerPage.getByTestId('connection-status')).toHaveAttribute(
        'data-state',
        'connected',
        { timeout: 15_000 },
      );
      await ownerPage.waitForFunction(() => Boolean(window.__NOVA_EDITOR__?.renderer && window.__nova));

      const createdId = await ownerPage.evaluate(() => {
        const res = window.__NOVA_EDITOR__?.editor.commands.execute({
          type: 'createNode',
          input: {
            type: 'rect',
            name: 'Original Card',
            x: 160,
            y: 120,
            width: 240,
            height: 140,
          },
        });
        return res?.createdIds[0] ?? '';
      });
      expect(createdId.length).toBeGreaterThan(0);
      await expect(ownerPage.getByText('Original Card').first()).toBeVisible({ timeout: 10_000 });

      // 2. OWNER opens Share dialog and overrides workspace EDITOR -> VIEWER for this project
      await ownerPage.getByTestId('project-share-btn').click();
      const editorRoleSelect = ownerPage.getByRole('combobox', {
        name: `Project role for ${SEEDED_ACCOUNTS.EDITOR.name}`,
      });
      await expect(editorRoleSelect).toBeVisible({ timeout: 10_000 });
      await editorRoleSelect.selectOption('VIEWER');
      await expect(editorRoleSelect).toHaveValue('VIEWER', { timeout: 10_000 });

      const editorMemberRow = ownerPage.locator('li', {
        hasText: SEEDED_ACCOUNTS.EDITOR.email,
      });
      await expect(editorMemberRow).toContainText('VIEWER', { timeout: 10_000 });
      await ownerPage.getByRole('button', { name: 'Close dialog' }).click();

      // 3. Workspace EDITOR signs in and opens the project — receives strict VIEWER read-only mode
      const editorPage = await editorContext.newPage();
      await editorPage.goto('/login');
      await editorPage.locator('#login-email').fill(SEEDED_ACCOUNTS.EDITOR.email);
      await editorPage.locator('#login-password').fill(SEEDED_ACCOUNTS.EDITOR.password);
      await editorPage.getByRole('button', { name: 'Sign in' }).click();
      await expect(editorPage).toHaveURL(/\/dashboard/, { timeout: 15_000 });

      await editorPage.goto(projectPath);
      await expect(editorPage.getByTestId('connection-status')).toHaveAttribute(
        'data-state',
        'connected',
        { timeout: 15_000 },
      );
      await editorPage.waitForFunction(() => Boolean(window.__NOVA_EDITOR__?.renderer && window.__nova));

      await expect(editorPage.locator('header')).toContainText('VIEWER', { timeout: 10_000 });
      await expect(editorPage.getByRole('button', { name: 'Rectangle (R)' })).toBeDisabled();
      await expect(editorPage.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
      await expect(editorPage.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled();
      await expect(
        editorPage.getByRole('button', { name: 'Delete selected', exact: true }),
      ).toBeDisabled();
      await expect(editorPage.locator('footer')).toContainText('Read-only Viewer mode');
      await expect(editorPage.getByText('Original Card').first()).toBeVisible({ timeout: 10_000 });

      const isReadOnly = await editorPage.evaluate(
        () => window.__NOVA_EDITOR__?.editor.commands.isReadOnly() ?? false,
      );
      expect(isReadOnly).toBe(true);

      // Keyboard creation/undo shortcuts remain inert for VIEWER
      await editorPage.keyboard.press('r');
      await editorPage.keyboard.press('Control+z');
      const activeTool = await editorPage.evaluate(
        () => window.__NOVA_EDITOR__?.editor.tools.getActiveTool(),
      );
      expect(activeTool).not.toBe('rect');

      // 4. Viewer attempts raw Y.Doc mutation bypass in DevTools console, followed by awareness fence
      await editorPage.evaluate(() => {
        const handle = window.__NOVA_EDITOR__;
        if (!handle) throw new Error('Editor handle unavailable');
        const doc = handle.doc;
        doc.transact(() => {
          const nodesMap = doc.getMap('nodes');
          nodesMap.forEach((val) => {
            if (val && typeof (val as { set?: unknown }).set === 'function') {
              const ymap = val as { set: (k: string, v: unknown) => void };
              ymap.set('name', 'Hacked Card');
              ymap.set('x', 777);
            }
          });
          doc.getMap('meta').set('title', 'Hacked Title');
        });
        handle.editor.presence.setCursor({ x: 321, y: 321 });
      });

      // Wait until owner sees the subsequent awareness frame (proving prior WS frames reached server)
      await expect
        .poll(
          async () =>
            ownerPage.evaluate(() => {
              const remotes = window.__nova?.presences() ?? [];
              return remotes.some(
                (r) => r.presence.cursor?.x === 321 && r.presence.cursor?.y === 321,
              );
            }),
          { timeout: 10_000 },
        )
        .toBe(true);

      // 5. Server rejected the raw Y.Doc mutation — owner scene & title remain clean
      const ownerScene = await ownerPage.evaluate(() => window.__nova?.scene() ?? []);
      expect(ownerScene).toHaveLength(1);
      expect(ownerScene[0]).toMatchObject({ name: 'Original Card', x: 160, y: 120 });

      const ownerMetaTitle = await ownerPage.evaluate(() =>
        window.__NOVA_EDITOR__?.doc.getMap('meta').get('title'),
      );
      expect(ownerMetaTitle).not.toBe('Hacked Title');

      // 6. Reloading Viewer page restores clean server state (tamper gone locally & remotely)
      await editorPage.reload();
      await expect(editorPage.getByTestId('connection-status')).toHaveAttribute(
        'data-state',
        'connected',
        { timeout: 15_000 },
      );
      await editorPage.waitForFunction(() => Boolean(window.__NOVA_EDITOR__?.renderer && window.__nova));

      await expect(editorPage.getByText('Original Card').first()).toBeVisible({ timeout: 10_000 });
      const reloadedScene = await editorPage.evaluate(() => window.__nova?.scene() ?? []);
      expect(reloadedScene).toHaveLength(1);
      expect(reloadedScene[0]).toMatchObject({ name: 'Original Card', x: 160, y: 120 });

      await editorPage.screenshot({ path: path.join(SCREENSHOT_DIR, 'E7.png') });
    } finally {
      await ownerContext.close();
      await editorContext.close();
    }
  });
});
