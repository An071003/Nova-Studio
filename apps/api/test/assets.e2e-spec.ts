import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ERROR_CODES, MAX_ASSET_SIZE_BYTES, can, type Role } from '@nova/shared';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

interface TestActor {
  role: Role | 'NON_MEMBER';
  userId: string;
  token: string;
}

describe('Assets (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdEmails: string[] = [];
  const createdWorkspaceIds: string[] = [];

  async function registerUser(label: string): Promise<{ userId: string; token: string }> {
    const email = `assets-${label}-${randomUUID()}@nova.dev`;
    createdEmails.push(email);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, name: `Asset ${label}`, password: 'StrongPassword1!' });
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

  it('uploads PNG end-to-end, enforces RBAC, rejects 30MB and spoofed bytes, and sanitizes SVG', async () => {
    const server = app.getHttpServer();
    const owner = await registerUser('owner');
    const editor = await registerUser('editor');
    const viewer = await registerUser('viewer');
    const outsider = await registerUser('outsider');

    const createWs = await request(server)
      .post('/api/v1/workspaces')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Assets Studio' });
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
      .send({ name: 'Assets Canvas' });
    expect(createProj.status).toBe(201);
    const projectId = createProj.body.project.id as string;

    // 1. Reject 30MB file and disallowed MIME
    const oversizedRes = await request(server)
      .post(`/api/v1/projects/${projectId}/assets/upload-url`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({
        mimeType: 'image/png',
        sizeBytes: 30 * 1024 * 1024,
        filename: 'huge.png',
      });
    expect(oversizedRes.status).toBe(400);
    expect(oversizedRes.body.error.code).toBe(ERROR_CODES.ASSET_TOO_LARGE);
    expect(MAX_ASSET_SIZE_BYTES).toBe(25 * 1024 * 1024);

    const badMimeRes = await request(server)
      .post(`/api/v1/projects/${projectId}/assets/upload-url`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({
        mimeType: 'application/x-msdownload',
        sizeBytes: 512,
        filename: 'malware.exe',
      });
    expect(badMimeRes.status).toBe(400);
    expect(badMimeRes.body.error.code).toBe(ERROR_CODES.ASSET_TYPE_NOT_ALLOWED);

    // 2. Role matrix on upload-url (VIEWER 403, NON_MEMBER 404, OWNER/EDITOR 201)
    const actors: TestActor[] = [
      { role: 'VIEWER', ...viewer },
      { role: 'NON_MEMBER', ...outsider },
      { role: 'OWNER', ...owner },
      { role: 'EDITOR', ...editor },
    ];
    for (const actor of actors) {
      const res = await request(server)
        .post(`/api/v1/projects/${projectId}/assets/upload-url`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ mimeType: 'image/png', sizeBytes: 128, filename: 'role-check.png' });
      const expected =
        actor.role === 'NON_MEMBER' ? 404 : can(actor.role, 'asset.upload') ? 201 : 403;
      expect(res.status).toBe(expected);
    }

    // 3. Real PNG upload -> confirm -> signed URL + viewer can read URL
    const pngBytes = await sharp({
      create: {
        width: 160,
        height: 90,
        channels: 4,
        background: { r: 74, g: 222, b: 128, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const presignPng = await request(server)
      .post(`/api/v1/projects/${projectId}/assets/upload-url`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ mimeType: 'image/png', sizeBytes: pngBytes.byteLength, filename: 'green.png' });
    expect(presignPng.status).toBe(201);
    const { assetId: pngId, putUrl: pngPutUrl, expiresIn } = presignPng.body as {
      assetId: string;
      putUrl: string;
      expiresIn: number;
    };
    expect(expiresIn).toBeLessThanOrEqual(300);

    const putRes = await fetch(pngPutUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array(pngBytes),
    });
    expect(putRes.ok).toBe(true);

    const confirmPng = await request(server)
      .post(`/api/v1/assets/${pngId}/confirm`)
      .set('Authorization', `Bearer ${editor.token}`);
    expect(confirmPng.status).toBe(200);
    expect(confirmPng.body.asset.status).toBe('READY');
    expect(confirmPng.body.asset.width).toBe(160);
    expect(confirmPng.body.asset.height).toBe(90);

    const urlViewer = await request(server)
      .get(`/api/v1/assets/${pngId}/url`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(urlViewer.status).toBe(200);
    const getObjRes = await fetch(urlViewer.body.url as string);
    expect(getObjRes.ok).toBe(true);
    const downloaded = Buffer.from(await getObjRes.arrayBuffer());
    expect(downloaded.equals(pngBytes)).toBe(true);

    const listRes = await request(server)
      .get(`/api/v1/projects/${projectId}/assets`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.assets.some((a: { id: string }) => a.id === pngId)).toBe(true);

    // 4. Spoofed PNG payload (plain text uploaded to PNG presigned URL) -> 400 + FAILED
    const spoofBytes = Buffer.from('not really a png', 'utf8');
    const presignSpoof = await request(server)
      .post(`/api/v1/projects/${projectId}/assets/upload-url`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ mimeType: 'image/png', sizeBytes: spoofBytes.byteLength, filename: 'fake.png' });
    expect(presignSpoof.status).toBe(201);

    await fetch(presignSpoof.body.putUrl as string, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array(spoofBytes),
    });

    const confirmSpoof = await request(server)
      .post(`/api/v1/assets/${presignSpoof.body.assetId}/confirm`)
      .set('Authorization', `Bearer ${editor.token}`);
    expect(confirmSpoof.status).toBe(400);
    expect(confirmSpoof.body.error.code).toBe(ERROR_CODES.ASSET_TYPE_NOT_ALLOWED);

    const failedAsset = await prisma.asset.findUnique({
      where: { id: presignSpoof.body.assetId as string },
    });
    expect(failedAsset?.status).toBe('FAILED');

    // 5. Dirty SVG gets sanitized before READY
    const dirtySvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" onload="alert(1)"><script>alert(1)</script><rect width="64" height="64" fill="#7C5CFF"/></svg>',
      'utf8',
    );
    const presignSvg = await request(server)
      .post(`/api/v1/projects/${projectId}/assets/upload-url`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ mimeType: 'image/svg+xml', sizeBytes: dirtySvg.byteLength, filename: 'icon.svg' });
    expect(presignSvg.status).toBe(201);

    await fetch(presignSvg.body.putUrl as string, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/svg+xml' },
      body: new Uint8Array(dirtySvg),
    });

    const confirmSvg = await request(server)
      .post(`/api/v1/assets/${presignSvg.body.assetId}/confirm`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(confirmSvg.status).toBe(200);
    expect(confirmSvg.body.asset.status).toBe('READY');

    const svgUrlRes = await request(server)
      .get(`/api/v1/assets/${presignSvg.body.assetId}/url`)
      .set('Authorization', `Bearer ${viewer.token}`);
    const fetchedSvg = await (await fetch(svgUrlRes.body.url as string)).text();
    expect(fetchedSvg).not.toMatch(/<script|onload=/i);
    expect(fetchedSvg).toContain('<rect');
  });
});
