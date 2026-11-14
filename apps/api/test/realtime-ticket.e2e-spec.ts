import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  can,
  colorForUserId,
  RealtimeTicketClaimsSchema,
  RealtimeTicketResponseSchema,
  type Role,
} from '@nova/shared';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { getApiEnv } from '../src/common/env';
import { PrismaService } from '../src/prisma/prisma.service';

interface TestActor {
  role: Role | 'NON_MEMBER';
  userId: string;
  name: string;
  token: string;
}

describe('Realtime Ticket (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdEmails: string[] = [];
  const createdWorkspaceIds: string[] = [];

  async function registerUser(
    label: string,
  ): Promise<{ userId: string; name: string; token: string }> {
    const email = `rt-ticket-${label}-${randomUUID()}@nova.dev`;
    const name = `Ticket ${label}`;
    createdEmails.push(email);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, name, password: 'StrongPassword1!' });
    expect(res.status).toBe(201);
    return {
      userId: res.body.user.id as string,
      name,
      token: res.body.accessToken as string,
    };
  }

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
    if (createdWorkspaceIds.length > 0) {
      await prisma.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    }
    if (createdEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    }
    await app.close();
  });

  it('issues 60s HS256 realtime tickets per role, honors project overrides, and hides non-member/deleted projects with 404', async () => {
    const server = app.getHttpServer();
    const env = getApiEnv();
    const owner = await registerUser('owner');
    const editor = await registerUser('editor');
    const viewer = await registerUser('viewer');
    const outsider = await registerUser('outsider');

    const createWs = await request(server)
      .post('/api/v1/workspaces')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Realtime Ticket Studio' });
    expect(createWs.status).toBe(201);
    const workspaceId = createWs.body.workspace.id as string;
    createdWorkspaceIds.push(workspaceId);

    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: editor.userId, role: 'EDITOR' },
        { workspaceId, userId: viewer.userId, role: 'VIEWER' },
      ],
    });

    const createProj = await request(server)
      .post(`/api/v1/workspaces/${workspaceId}/projects`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Ticket Canvas' });
    expect(createProj.status).toBe(201);
    const projectId = createProj.body.project.id as string;

    const unauth = await request(server).post(`/api/v1/projects/${projectId}/realtime-ticket`);
    expect(unauth.status).toBe(401);

    const actors: TestActor[] = [
      { role: 'OWNER', ...owner },
      { role: 'EDITOR', ...editor },
      { role: 'VIEWER', ...viewer },
      { role: 'NON_MEMBER', ...outsider },
    ];

    for (const actor of actors) {
      const res = await request(server)
        .post(`/api/v1/projects/${projectId}/realtime-ticket`)
        .set('Authorization', `Bearer ${actor.token}`);

      if (actor.role === 'NON_MEMBER') {
        expect(res.status).toBe(404);
        continue;
      }

      const allowed = can(actor.role, 'project.realtime_connect');
      expect(allowed).toBe(true);
      expect(res.status).toBe(200);

      const parsedBody = RealtimeTicketResponseSchema.parse(res.body);
      expect(parsedBody.wsUrl).toBe(env.realtimeUrl);
      expect(parsedBody.role).toBe(actor.role);

      const decoded = jwt.verify(parsedBody.ticket, env.realtimeJwtSecret, {
        algorithms: ['HS256'],
      }) as jwt.JwtPayload;
      const claims = RealtimeTicketClaimsSchema.parse(decoded);
      expect(claims.sub).toBe(actor.userId);
      expect(claims.projectId).toBe(projectId);
      expect(claims.role).toBe(actor.role);
      expect(claims.name).toBe(actor.name);
      expect(claims.color).toBe(colorForUserId(actor.userId));
      expect(claims.type).toBe('realtime');
      expect(typeof decoded.iat).toBe('number');
      expect(typeof decoded.exp).toBe('number');
      expect((decoded.exp ?? 0) - (decoded.iat ?? 0)).toBe(60);
    }

    // Per-project override (workspace EDITOR downgraded to VIEWER on this project)
    await prisma.projectMember.create({
      data: {
        projectId,
        userId: editor.userId,
        role: 'VIEWER',
      },
    });
    const downgraded = await request(server)
      .post(`/api/v1/projects/${projectId}/realtime-ticket`)
      .set('Authorization', `Bearer ${editor.token}`);
    expect(downgraded.status).toBe(200);
    expect(downgraded.body.role).toBe('VIEWER');
    const downgradedClaims = RealtimeTicketClaimsSchema.parse(
      jwt.verify(downgraded.body.ticket as string, env.realtimeJwtSecret, {
        algorithms: ['HS256'],
      }),
    );
    expect(downgradedClaims.role).toBe('VIEWER');

    // Soft-deleted project returns 404 even for OWNER
    const delRes = await request(server)
      .delete(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(delRes.status).toBe(204);

    const afterDelete = await request(server)
      .post(`/api/v1/projects/${projectId}/realtime-ticket`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(afterDelete.status).toBe(404);
  });
});
