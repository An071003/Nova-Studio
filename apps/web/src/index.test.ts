import { describe, expect, it, vi } from 'vitest';
import { WEB_APP_VERSION } from './index.js';
import { NovaApiClient, NovaApiError } from './lib/api.js';

describe('web', () => {
  it('connects all workspace libraries', () => {
    expect(WEB_APP_VERSION).toBe(4);
  });

  it('stores access token in memory and refreshes once on concurrent 401 responses', async () => {
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const headers = (init?.headers ?? {}) as Record<string, string>;

      if (url.endsWith('/auth/login')) {
        return new Response(
          JSON.stringify({
            user: { id: 'u1', email: 'a@nova.dev', name: 'Alice', avatarUrl: null },
            accessToken: 'expired-token',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return new Response(JSON.stringify({ accessToken: 'fresh-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/me')) {
        if (headers.Authorization !== 'Bearer fresh-token') {
          return new Response(
            JSON.stringify({ error: { code: 'AUTH_TOKEN_EXPIRED', message: 'Expired' } }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            user: { id: 'u1', email: 'a@nova.dev', name: 'Alice', avatarUrl: null },
            workspaces: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(null, { status: 404 });
    });

    const client = new NovaApiClient({
      baseUrl: 'http://localhost:4000/api/v1',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await client.login({ email: 'a@nova.dev', password: 'Password123!' });
    expect(client.getAccessToken()).toBe('expired-token');

    const [me1, me2] = await Promise.all([client.getMe(), client.getMe()]);
    expect(me1.user.email).toBe('a@nova.dev');
    expect(me2.user.email).toBe('a@nova.dev');
    expect(client.getAccessToken()).toBe('fresh-token');
    expect(refreshCalls).toBe(1);
  });

  it('invokes onUnauthenticated and throws NovaApiError when refresh fails', async () => {
    const onUnauthenticated = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/auth/refresh')) {
        return new Response(null, { status: 401 });
      }
      return new Response(
        JSON.stringify({ error: { code: 'AUTH_TOKEN_EXPIRED', message: 'Token expired' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const client = new NovaApiClient({
      baseUrl: '/api/v1',
      fetchImpl: fetchMock as unknown as typeof fetch,
      onUnauthenticated,
    });

    await expect(client.getMe()).rejects.toBeInstanceOf(NovaApiError);
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });
});
