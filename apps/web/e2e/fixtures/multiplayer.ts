import { expect, test as base, type Browser, type BrowserContext, type Page } from '@playwright/test';

export interface SeededAccount {
  email: string;
  password: string;
  name: string;
}

export const SEEDED_ACCOUNTS: Record<'OWNER' | 'EDITOR' | 'VIEWER', SeededAccount> = {
  OWNER: { email: 'owner@nova.dev', password: 'Passw0rd!', name: 'Nova Owner' },
  EDITOR: { email: 'editor@nova.dev', password: 'Passw0rd!', name: 'Nova Editor' },
  VIEWER: { email: 'viewer@nova.dev', password: 'Passw0rd!', name: 'Nova Viewer' },
};

export interface EditorTabSession {
  context: BrowserContext;
  page: Page;
  account: SeededAccount;
  userId: string;
}

export interface MultiplayerHarness {
  projectId: string;
  sessions: EditorTabSession[];
  closeAll: () => Promise<void>;
}

async function loginContext(
  context: BrowserContext,
  account: SeededAccount,
): Promise<{ userId: string; workspaceId: string }> {
  const loginRes = await context.request.post('/api/v1/auth/login', {
    data: { email: account.email, password: account.password },
  });
  expect(loginRes.ok()).toBe(true);
  const loginJson = (await loginRes.json()) as {
    user: { id: string };
    accessToken: string;
  };

  const meRes = await context.request.get('/api/v1/me', {
    headers: { Authorization: `Bearer ${loginJson.accessToken}` },
  });
  expect(meRes.ok()).toBe(true);
  const meJson = (await meRes.json()) as {
    workspaces: Array<{ id: string; slug: string; name: string }>;
  };
  const demoWs =
    meJson.workspaces.find((w) => w.slug === 'nova-demo') ?? meJson.workspaces[0];
  expect(demoWs).toBeDefined();
  return { userId: loginJson.user.id, workspaceId: demoWs!.id };
}

export async function createMultiplayerProject(
  browser: Browser,
  projectNamePrefix: string,
  roles: Array<'OWNER' | 'EDITOR' | 'VIEWER'> = ['OWNER', 'EDITOR'],
): Promise<MultiplayerHarness> {
  const contexts: BrowserContext[] = [];

  try {
    const firstRole = roles[0] ?? 'OWNER';
    const firstAccount = SEEDED_ACCOUNTS[firstRole];
    const firstContext = await browser.newContext();
    contexts.push(firstContext);
    const { userId: firstUserId, workspaceId } = await loginContext(firstContext, firstAccount);

    // Create an isolated project via REST API using freshly refreshed token
    const refreshRes = await firstContext.request.post('/api/v1/auth/refresh');
    expect(refreshRes.ok()).toBe(true);
    const refreshJson = (await refreshRes.json()) as { accessToken: string };

    const createProjRes = await firstContext.request.post(
      `/api/v1/workspaces/${workspaceId}/projects`,
      {
        headers: { Authorization: `Bearer ${refreshJson.accessToken}` },
        data: { name: `${projectNamePrefix}-${Date.now()}` },
      },
    );
    expect(createProjRes.ok()).toBe(true);
    const createdProj = (await createProjRes.json()) as { project: { id: string } };
    const projectId = createdProj.project.id;

    const sessions: EditorTabSession[] = [];
    for (let i = 0; i < roles.length; i += 1) {
      const role = roles[i]!;
      const account = SEEDED_ACCOUNTS[role];
      const context = i === 0 ? firstContext : await browser.newContext();
      if (i > 0) contexts.push(context);

      const userId =
        i === 0 ? firstUserId : (await loginContext(context, account)).userId;

      const page = await context.newPage();
      await page.goto(`/project/${projectId}`);
      await expect(page.getByTestId('connection-status')).toHaveAttribute(
        'data-state',
        'connected',
        { timeout: 15_000 },
      );
      await page.waitForFunction(() => Boolean(window.__NOVA_EDITOR__?.renderer && window.__nova));
      sessions.push({ context, page, account, userId });
    }

    return {
      projectId,
      sessions,
      closeAll: async () => {
        await Promise.all(
          contexts.map((ctx) => ctx.close().catch(() => {})),
        );
      },
    };
  } catch (err) {
    await Promise.all(contexts.map((ctx) => ctx.close().catch(() => {})));
    throw err;
  }
}

export const test = base;
export { expect };
