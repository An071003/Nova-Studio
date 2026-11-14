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
});
