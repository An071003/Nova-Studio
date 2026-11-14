import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(CURRENT_DIR, '../..');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @nova/shared build && pnpm --filter api build && node apps/api/dist/main.js',
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        NOVA_E2E_THROTTLE_LIMIT: '200',
      },
      url: 'http://localhost:4000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
    },
    {
      command: 'pnpm --filter @nova/shared build && pnpm --filter @nova/editor-core build && pnpm --filter realtime build && node apps/realtime/dist/main.js',
      cwd: ROOT_DIR,
      url: 'http://localhost:4001/health',
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
    },
    {
      command: 'pnpm --filter @nova/ui build && pnpm --filter web dev',
      cwd: ROOT_DIR,
      url: 'http://localhost:3000/login',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
