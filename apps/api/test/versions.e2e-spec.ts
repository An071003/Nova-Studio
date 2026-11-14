import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { getApiEnv } from '../src/common/env';
import { PrismaService } from '../src/prisma/prisma.service';

function encodeYjsDocWithText(label: string): string {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap('meta');
    meta.set('schemaVersion', 1);
    meta.set('title', label);
    const nodes = doc.getMap('nodes');
    const rect = new Y.Map();
    rect.set('id', 'node-1');
    rect.set('type', 'rect');
    rect.set('name', label);
    rect.set('x', 100);
    rect.set('y', 100);
    rect.set('width', 200);
    rect.set('height', 120);
    nodes.set('node-1', rect);
  });
  const encoded = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
  doc.destroy();
  return encoded;
}

describe('Project Versions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdEmails: string[] = [];
  const createdWorkspaceIds: string[] = [];

  async function registerUser(label: string): Promise<{ userId: string; token: string }> {
    const email = `ver-${label}-${randomUUID()}@nova.dev`;
    createdEmails.push(email);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, name: `Version ${label}`, password: 'StrongPassword1!' });
    expect(res.status).toBe(201);
    return {
      userId: res.body.user.id as string,
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

  it('creates, previews, and restores versions with Before restore auto-backup, Redis pub/sub, RBAC, and AuditLog', async () => {
    const server = app.getHttpServer();
    const owner = await registerUser('owner');
    const viewer = await registerUser('viewer');
    const outsider = await registerUser('outsider');

    const wsRes = await request(server)
      .post('/api/v1/workspaces')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Versions Studio' });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.workspace.id as string;
    createdWorkspaceIds.push(workspaceId);

    await prisma.workspaceMember.create({
      data: { workspaceId, userId: viewer.userId, role: 'VIEWER' },
    });

    const projRes = await request(server)
      .post(`/api/v1/workspaces/${workspaceId}/projects`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Versioned Deck' });
    expect(projRes.status).toBe(201);
    const projectId = projRes.body.project.id as string;

    const v1Base64 = encodeYjsDocWithText('Version One Shape');
    const createV1 = await request(server)
      .post(`/api/v1/projects/${projectId}/versions`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ label: 'v1 milestone', stateBase64: v1Base64 });
    expect(createV1.status).toBe(201);
    expect(createV1.body.version).toMatchObject({
      projectId,
      label: 'v1 milestone',
      isAuto: false,
      createdById: owner.userId,
    });
    const v1Id = createV1.body.version.id as string;

    // VIEWER can list and preview, but cannot create or restore
    const listAsViewer = await request(server)
      .get(`/api/v1/projects/${projectId}/versions`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(listAsViewer.status).toBe(200);
    expect(listAsViewer.body.versions).toHaveLength(1);

    const previewAsViewer = await request(server)
      .get(`/api/v1/projects/${projectId}/versions/${v1Id}/preview`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(previewAsViewer.status).toBe(200);
    expect(previewAsViewer.body.id).toBe(v1Id);
    expect(previewAsViewer.body.stateBase64).toBe(v1Base64);

    const createAsViewer = await request(server)
      .post(`/api/v1/projects/${projectId}/versions`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ label: 'Viewer blocked' });
    expect(createAsViewer.status).toBe(403);

    const restoreAsViewer = await request(server)
      .post(`/api/v1/projects/${projectId}/versions/${v1Id}/restore`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(restoreAsViewer.status).toBe(403);

    // Non-member receives 404
    const listAsOutsider = await request(server)
      .get(`/api/v1/projects/${projectId}/versions`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(listAsOutsider.status).toBe(404);

    // Mutate current document bytes in Postgres before restore
    const v2Base64 = encodeYjsDocWithText('Modified State Before Restore');
    await prisma.projectDocument.update({
      where: { projectId },
      data: { state: Uint8Array.from(Buffer.from(v2Base64, 'base64')) },
    });

    // Subscribe to Redis restore channel to verify broadcast
    const sub = new Redis(getApiEnv().redisUrl, { maxRetriesPerRequest: null });
    const receivedMessages: string[] = [];
    await sub.subscribe(`nova:restore:${projectId}`);
    sub.on('message', (_channel, message) => {
      receivedMessages.push(message);
    });

    try {
      const restoreRes = await request(server)
        .post(`/api/v1/projects/${projectId}/versions/${v1Id}/restore`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({});
      expect(restoreRes.status).toBe(200);
      expect(restoreRes.body.version.id).toBe(v1Id);
      expect(restoreRes.body.backupVersion).toMatchObject({
        projectId,
        label: 'Before restore',
        isAuto: true,
      });

      const docAfter = await prisma.projectDocument.findUnique({ where: { projectId } });
      expect(Buffer.from(docAfter!.state).toString('base64')).toBe(v1Base64);

      const backupPreview = await request(server)
        .get(`/api/v1/projects/${projectId}/versions/${restoreRes.body.backupVersion.id as string}/preview`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(backupPreview.status).toBe(200);
      expect(backupPreview.body.stateBase64).toBe(v2Base64);

      await vi.waitFor(() => {
        expect(receivedMessages).toContain(v1Base64);
      });

      const audits = await prisma.auditLog.findMany({
        where: { workspaceId, action: { in: ['version.created', 'version.restored'] } },
      });
      expect(audits.map((a) => a.action)).toEqual(
        expect.arrayContaining(['version.created', 'version.restored']),
      );
    } finally {
      await sub.quit();
    }
  });
});
