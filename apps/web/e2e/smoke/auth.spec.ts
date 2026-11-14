import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(CURRENT_DIR, '../../../../harness/evals/screenshots');

test.describe('P1-T11 Auth & Dashboard Shell', () => {
  test('registers a new user, lands on dashboard, reloads session via refresh cookie, and signs in', async ({
    page,
  }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const unique = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const email = `t11-${unique}@nova.dev`;
    const password = 'NovaStudio2026!';

    // Verify login screen renders cleanly & save screenshot
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in to your studio' })).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'p1-t11-login.png') });

    // Navigate to register and submit form
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page.getByRole('heading', { name: 'Create your NOVA account' })).toBeVisible();
    await page.getByLabel('Full name').fill('Nova Designer');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'p1-t11-register.png') });

    await page.getByRole('button', { name: 'Create account' }).click();

    // Lands on /dashboard
    await page.waitForURL('**/dashboard');
    await expect(page.getByRole('heading', { name: 'Welcome to NOVA STUDIO' })).toBeVisible();

    // Create first workspace in native <dialog>
    await page.getByRole('button', { name: 'Create workspace' }).click();
    const dialog = page.getByRole('dialog', { name: 'New workspace' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Workspace name').fill('Studio Alpha');
    await dialog.getByRole('button', { name: 'Create' }).click();

    await expect(page.getByRole('heading', { name: 'Studio Alpha' })).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'p1-t11-dashboard.png') });

    // Reload page -> HttpOnly refresh cookie rotates & preserves session in memory
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Studio Alpha' })).toBeVisible();

    // Sign out -> redirected to /login -> sign back in
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/login');

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await page.waitForURL('**/dashboard');
    await expect(page.getByRole('heading', { name: 'Studio Alpha' })).toBeVisible();
  });
});
