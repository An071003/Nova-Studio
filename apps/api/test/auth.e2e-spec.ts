import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdEmails: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (createdEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    }
    await app.close();
  });

  it('registers, logs in, reads /me, rotates refresh token, detects reuse, and logs out', async () => {
    const email = `auth-${randomUUID()}@nova.dev`;
    createdEmails.push(email);
    const server = app.getHttpServer();

    // Register
    const regRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, name: 'Test User', password: 'StrongPassword1!' });
    expect(regRes.status).toBe(201);
    expect(regRes.body.user.email).toBe(email);
    expect(typeof regRes.body.accessToken).toBe('string');

    const regCookies = regRes.headers['set-cookie'] as string[] | undefined;
    expect(regCookies?.some((c) => c.includes('nova_refresh=') && c.includes('HttpOnly'))).toBe(
      true,
    );

    // Duplicate register -> 409 CONFLICT
    const dupRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, name: 'Test User', password: 'StrongPassword1!' });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe('CONFLICT');

    // Login with wrong password -> 401 AUTH_INVALID_CREDENTIALS
    const badLogin = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'WrongPassword!' });
    expect(badLogin.status).toBe(401);
    expect(badLogin.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');

    // Login valid via agent (tracks cookies)
    const agent = request.agent(server);
    const loginRes = await agent
      .post('/api/v1/auth/login')
      .send({ email, password: 'StrongPassword1!' });
    expect(loginRes.status).toBe(200);
    const accessToken = loginRes.body.accessToken as string;
    const initialCookies = loginRes.headers['set-cookie'] as unknown as string[];
    const stolenRefreshCookie = initialCookies.find((c) => c.startsWith('nova_refresh='))!;
    expect(stolenRefreshCookie).toBeDefined();

    // GET /me without token -> 401
    const unauthMe = await request(server).get('/api/v1/me');
    expect(unauthMe.status).toBe(401);
    expect(unauthMe.body.error.code).toBe('AUTH_TOKEN_EXPIRED');

    // GET /me with token -> 200
    const meRes = await request(server)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe(email);
    expect(Array.isArray(meRes.body.workspaces)).toBe(true);

    // Rotate refresh token -> new accessToken & new refresh cookie
    const refreshRes = await agent.post('/api/v1/auth/refresh');
    expect(refreshRes.status).toBe(200);
    expect(typeof refreshRes.body.accessToken).toBe('string');

    // Reuse detection: replaying the OLD (already rotated) refresh cookie revokes entire family!
    const reuseRes = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', stolenRefreshCookie);
    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.error.code).toBe('AUTH_TOKEN_EXPIRED');

    // Now even the NEW refresh cookie held by `agent` is revoked because the family was compromised
    const afterReuseRes = await agent.post('/api/v1/auth/refresh');
    expect(afterReuseRes.status).toBe(401);

    // Re-login and logout -> 204 + revokes family
    const login2 = await agent
      .post('/api/v1/auth/login')
      .send({ email, password: 'StrongPassword1!' });
    expect(login2.status).toBe(200);

    const logoutRes = await agent.post('/api/v1/auth/logout');
    expect(logoutRes.status).toBe(204);

    const refreshAfterLogout = await agent.post('/api/v1/auth/refresh');
    expect(refreshAfterLogout.status).toBe(401);
  });

  it('returns seeded user workspaces on GET /me', async () => {
    const server = app.getHttpServer();
    const loginRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'owner@nova.dev', password: 'Passw0rd!' });
    expect(loginRes.status).toBe(200);

    const meRes = await request(server)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.workspaces.length).toBeGreaterThanOrEqual(1);
    expect(meRes.body.workspaces[0].role).toBe('OWNER');
  });

  it('enforces 10/min rate limit on auth endpoints (429 RATE_LIMITED)', async () => {
    const server = app.getHttpServer();
    let gotRateLimited = false;
    for (let i = 0; i < 12; i += 1) {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'missing@nova.dev', password: 'wrong' });
      if (res.status === 429) {
        expect(res.body.error.code).toBe('RATE_LIMITED');
        gotRateLimited = true;
        break;
      }
    }
    expect(gotRateLimited).toBe(true);
  });
});
