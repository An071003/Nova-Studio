import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DEFAULT_PAGE_ID } from '@nova/shared';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

function encodeSceneYjsDoc(userId: string, assetId: string): Uint8Array<ArrayBuffer> {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap('meta');
    meta.set('schemaVersion', 1);
    const nodes = doc.getMap('nodes');

    const frame = new Y.Map();
    frame.set('id', 'frame-1');
    frame.set('type', 'frame');
    frame.set('pageId', DEFAULT_PAGE_ID);
    frame.set('parentId', null);
    frame.set('index', 'a0');
    frame.set('name', 'Social Post');
    frame.set('x', 50);
    frame.set('y', 60);
    frame.set('width', 400);
    frame.set('height', 300);
    frame.set('rotation', 0);
    frame.set('opacity', 1);
    frame.set('visible', true);
    frame.set('locked', false);
    frame.set('fill', '#FFFFFF');
    frame.set('stroke', '#373D4A');
    frame.set('strokeWidth', 1);
    frame.set('createdBy', userId);
    frame.set('updatedAt', Date.now());
    nodes.set('frame-1', frame);

    const rect = new Y.Map();
    rect.set('id', 'rect-1');
    rect.set('type', 'rect');
    rect.set('pageId', DEFAULT_PAGE_ID);
    rect.set('parentId', 'frame-1');
    rect.set('index', 'a1');
    rect.set('name', 'Accent Box');
    rect.set('x', 70);
    rect.set('y', 80);
    rect.set('width', 140);
    rect.set('height', 90);
    rect.set('rotation', 0);
    rect.set('opacity', 1);
    rect.set('visible', true);
    rect.set('locked', false);
    rect.set('fill', '#7C5CFF');
    rect.set('stroke', null);
    rect.set('strokeWidth', 0);
    rect.set('cornerRadius', 8);
    rect.set('createdBy', userId);
    rect.set('updatedAt', Date.now());
    nodes.set('rect-1', rect);

    const img = new Y.Map();
    img.set('id', 'img-1');
    img.set('type', 'image');
    img.set('pageId', DEFAULT_PAGE_ID);
    img.set('parentId', 'frame-1');
    img.set('index', 'a2');
    img.set('name', 'Uploaded Sticker');
    img.set('x', 240);
    img.set('y', 100);
    img.set('width', 80);
    img.set('height', 80);
    img.set('rotation', 0);
    img.set('opacity', 1);
    img.set('visible', true);
    img.set('locked', false);
    img.set('fill', null);
    img.set('stroke', null);
    img.set('strokeWidth', 0);
    img.set('assetId', assetId);
    img.set('createdBy', userId);
    img.set('updatedAt', Date.now());
    nodes.set('img-1', img);
  });

  const encoded = new Uint8Array(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return encoded;
}

describe('Project Exports and Thumbnails (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdEmails: string[] = [];
  const createdWorkspaceIds: string[] = [];

  async function registerUser(label: string): Promise<{ userId: string; token: string }> {
    const email = `exp-${label}-${randomUUID()}@nova.dev`;
    createdEmails.push(email);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, name: `Export ${label}`, password: 'StrongPassword1!' });
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

  it('exports 2x Frame PNG via S3, maintains WebP project thumbnail, and enforces RBAC', async () => {
    const server = app.getHttpServer();
    const owner = await registerUser('owner');
    const viewer = await registerUser('viewer');
    const outsider = await registerUser('outsider');

    const wsRes = await request(server)
      .post('/api/v1/workspaces')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Export Studio' });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.workspace.id as string;
    createdWorkspaceIds.push(workspaceId);

    await prisma.workspaceMember.create({
      data: { workspaceId, userId: viewer.userId, role: 'VIEWER' },
    });

    const projRes = await request(server)
      .post(`/api/v1/workspaces/${workspaceId}/projects`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Poster Launch' });
    expect(projRes.status).toBe(201);
    const projectId = projRes.body.project.id as string;

    const pngFixture = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: { r: 34, g: 211, b: 166, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const uploadRes = await request(server)
      .post(`/api/v1/projects/${projectId}/assets/upload-url`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({
        filename: 'sticker.png',
        mimeType: 'image/png',
        sizeBytes: pngFixture.byteLength,
      });
    expect(uploadRes.status).toBe(201);

    const putRes = await fetch(uploadRes.body.putUrl as string, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array(pngFixture),
    });
    expect(putRes.ok).toBe(true);

    const confirmRes = await request(server)
      .post(`/api/v1/assets/${uploadRes.body.assetId as string}/confirm`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(confirmRes.status).toBe(200);
    const assetId = confirmRes.body.asset.id as string;

    const sceneBytes = encodeSceneYjsDoc(owner.userId, assetId);
    await prisma.projectDocument.upsert({
      where: { projectId },
      create: { projectId, state: sceneBytes, schemaVersion: 1 },
      update: { state: sceneBytes },
    });

    // Outsider cannot export (404)
    const outsiderExport = await request(server)
      .post(`/api/v1/projects/${projectId}/exports`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ format: 'png', scale: 2, nodeIds: ['frame-1'] });
    expect(outsiderExport.status).toBe(404);

    // Owner creates 2x Frame export
    const exportRes = await request(server)
      .post(`/api/v1/projects/${projectId}/exports`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ format: 'png', scale: 2, nodeIds: ['frame-1'] });
    expect(exportRes.status).toBe(201);
    expect(exportRes.body.status).toBe('READY');
    expect(exportRes.body.width).toBe(800);
    expect(exportRes.body.height).toBe(600);
    expect(typeof exportRes.body.url).toBe('string');

    const downloaded = await fetch(exportRes.body.url as string);
    expect(downloaded.ok).toBe(true);
    const pngMeta = await sharp(Buffer.from(await downloaded.arrayBuffer())).metadata();
    expect(pngMeta.format).toBe('png');
    expect(pngMeta.width).toBe(800);
    expect(pngMeta.height).toBe(600);

    // Job polling works for viewer and rejects outsider
    const viewerJob = await request(server)
      .get(`/api/v1/exports/${exportRes.body.jobId as string}`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(viewerJob.status).toBe(200);
    expect(viewerJob.body.width).toBe(800);

    const outsiderJob = await request(server)
      .get(`/api/v1/exports/${exportRes.body.jobId as string}`)
      .set('Authorization', `Bearer ${outsider.token}`);
    expect(outsiderJob.status).toBe(404);

    // Viewer can also export project
    const viewerExport = await request(server)
      .post(`/api/v1/projects/${projectId}/exports`)
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ format: 'png', scale: 1 });
    expect(viewerExport.status).toBe(201);
    expect(viewerExport.body.width).toBe(400);
    expect(viewerExport.body.height).toBe(300);

    // Dashboard project listing exposes thumbnailUrl and GET /thumbnail serves WebP
    const listRes = await request(server)
      .get(`/api/v1/workspaces/${workspaceId}/projects`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.projects[0]?.thumbnailUrl).toBe(`/api/v1/projects/${projectId}/thumbnail`);

    const thumbRes = await request(server)
      .get(`/api/v1/projects/${projectId}/thumbnail`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(thumbRes.status).toBe(200);
    expect(thumbRes.headers['content-type']).toContain('image/webp');
    const thumbMeta = await sharp(thumbRes.body as Buffer).metadata();
    expect(thumbMeta.format).toBe('webp');
    expect(thumbMeta.width).toBe(400);
    expect(thumbMeta.height).toBe(225);

    // Viewer cannot mutate thumbnail directly; Owner can
    const viewerRefresh = await request(server)
      .post(`/api/v1/projects/${projectId}/thumbnail`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(viewerRefresh.status).toBe(403);

    const ownerRefresh = await request(server)
      .post(`/api/v1/projects/${projectId}/thumbnail`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(ownerRefresh.status).toBe(200);
    expect(ownerRefresh.body.thumbnailUrl).toBe(`/api/v1/projects/${projectId}/thumbnail`);
  });
});
