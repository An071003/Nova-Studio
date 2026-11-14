import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(CURRENT_DIR, '../../../../harness/evals/screenshots');

test.describe('P1-T12 Dashboard CRUD', () => {
  test('switches workspaces, creates/renames/duplicates/filters/deletes designs, and captures screenshot', async ({
    page,
  }) => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const unique = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const email = `t12-${unique}@nova.dev`;
    const password = 'NovaStudio2026!';

    // Register a new user -> dashboard
    await page.goto('/register');
    await page.getByLabel('Full name').fill('Lead Designer');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/dashboard');

    // Create two workspaces & switch between them
    await page.getByRole('button', { name: 'Create workspace' }).click();
    const newWsDialog = page.getByRole('dialog', { name: 'New workspace' });
    await newWsDialog.getByLabel('Workspace name').fill('Brand Studio');
    await newWsDialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { name: 'Brand Studio' })).toBeVisible();

    await page.getByRole('button', { name: 'New workspace' }).click();
    await newWsDialog.getByLabel('Workspace name').fill('Video Lab');
    await newWsDialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { name: 'Video Lab' })).toBeVisible();

    // Switch back to Brand Studio
    await page.getByRole('navigation', { name: 'Workspace list' }).getByText('Brand Studio').click();
    await expect(page.getByRole('heading', { name: 'Brand Studio' })).toBeVisible();

    // Rename Brand Studio -> Creative Core
    await page.getByRole('button', { name: 'Rename workspace' }).click();
    const renameWsDialog = page.getByRole('dialog', { name: 'Rename workspace' });
    await renameWsDialog.getByLabel('Workspace name').fill('Creative Core');
    await renameWsDialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Creative Core' })).toBeVisible();

    // Create a design
    await page.getByRole('button', { name: 'New design' }).click();
    const newDesignDialog = page.getByRole('dialog', { name: 'New design' });
    await newDesignDialog.getByLabel('Design name').fill('Launch Poster');
    await newDesignDialog.getByRole('button', { name: 'Create design' }).click();
    await expect(page.getByRole('link', { name: 'Launch Poster' })).toBeVisible();

    // Duplicate the design
    await page.getByRole('button', { name: 'Duplicate Launch Poster' }).click();
    await expect(page.getByRole('link', { name: 'Launch Poster (Copy)' })).toBeVisible();

    // Rename the duplicate -> Social Square
    await page.getByRole('button', { name: 'Rename Launch Poster (Copy)' }).click();
    const renameDesignDialog = page.getByRole('dialog', { name: 'Rename design' });
    await renameDesignDialog.getByLabel('Design name').fill('Social Square');
    await renameDesignDialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('link', { name: 'Social Square' })).toBeVisible();

    // Save dashboard grid screenshot with both cards visible
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'p1-t12-dashboard.png') });

    // Search filter isolates Launch Poster
    const searchInput = page.getByLabel('Search designs');
    await searchInput.fill('Launch');
    await expect(page.getByRole('link', { name: 'Launch Poster' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Social Square' })).toBeHidden();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.getByRole('link', { name: 'Social Square' })).toBeVisible();

    // Delete Social Square
    await page.getByRole('button', { name: 'Delete Social Square' }).click();
    const deleteDialog = page.getByRole('dialog', { name: 'Delete design' });
    await deleteDialog.getByRole('button', { name: 'Delete design' }).click();
    await expect(page.getByRole('link', { name: 'Social Square' })).toBeHidden();
    await expect(page.getByRole('link', { name: 'Launch Poster' })).toBeVisible();
  });
});
