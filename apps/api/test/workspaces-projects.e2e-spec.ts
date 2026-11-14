import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { can, type PermissionAction, type Role } from '@nova/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

interface TestActor {
  role: Role | 'NON_MEMBER';
  userId: string;
  token: string;
}

describe('Workspaces & Projects (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdEmails: string[] = [];
  const createdWorkspaceIds: string[] = [];

  async function registerUser(label: string): Promise<{ userId: string; token: string }> {
    const email = `ws-proj-${label}-${randomUUID()}@nova.dev`;
    createdEmails.push(email);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, name: `User ${label}`, password: 'StrongPassword1!' });
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

  it('enforces role matrix across OWNER, EDITOR, VIEWER, and NON_MEMBER on workspace & project endpoints', async () => {
    const server = app.getHttpServer();
    const owner = await registerUser('owner');
    const editor = await registerUser('editor');
    const viewer = await registerUser('viewer');
    const outsider = await registerUser('outsider');

    // Create a fresh workspace owned by `owner`
    const createWs = await request(server)
      .post('/api/v1/workspaces')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Matrix Studio' });
    expect(createWs.status).toBe(201);
    const workspaceId = createWs.body.workspace.id as string;
    createdWorkspaceIds.push(workspaceId);
    expect(createWs.body.workspace.role).toBe('OWNER');

    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: editor.userId, role: 'EDITOR' },
        { workspaceId, userId: viewer.userId, role: 'VIEWER' },
      ],
    });

    // Seed one target project in the workspace
    const seedProj = await request(server)
      .post(`/api/v1/workspaces/${workspaceId}/projects`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Target Deck' });
    expect(seedProj.status).toBe(201);
    const targetProjectId = seedProj.body.project.id as string;

    // Put OWNER last because OWNER's DELETE soft-deletes targetProjectId
    const actors: TestActor[] = [
      { role: 'VIEWER', ...viewer },
      { role: 'EDITOR', ...editor },
      { role: 'NON_MEMBER', ...outsider },
      { role: 'OWNER', ...owner },
    ];

    function expectedStatus(actorRole: TestActor['role'], action: PermissionAction, okStatus: number): number {
      if (actorRole === 'NON_MEMBER') {
        return 404;
      }
      return can(actorRole, action) ? okStatus : 403;
    }

    for (const actor of actors) {
      const wsView = await request(server)
        .get(`/api/v1/workspaces/${workspaceId}`)
        .set('Authorization', `Bearer ${actor.token}`);
      expect(wsView.status).toBe(expectedStatus(actor.role, 'workspace.view', 200));

      const wsPatch = await request(server)
        .patch(`/api/v1/workspaces/${workspaceId}`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ name: `Renamed By ${actor.role}` });
      expect(wsPatch.status).toBe(expectedStatus(actor.role, 'workspace.update', 200));

      const wsMembers = await request(server)
        .get(`/api/v1/workspaces/${workspaceId}/members`)
        .set('Authorization', `Bearer ${actor.token}`);
      expect(wsMembers.status).toBe(expectedStatus(actor.role, 'workspace.view', 200));

      const projList = await request(server)
        .get(`/api/v1/workspaces/${workspaceId}/projects`)
        .set('Authorization', `Bearer ${actor.token}`);
      expect(projList.status).toBe(expectedStatus(actor.role, 'project.view', 200));

      const projCreate = await request(server)
        .post(`/api/v1/workspaces/${workspaceId}/projects`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ name: `Project By ${actor.role}` });
      expect(projCreate.status).toBe(expectedStatus(actor.role, 'project.create', 201));

      const projGet = await request(server)
        .get(`/api/v1/projects/${targetProjectId}`)
        .set('Authorization', `Bearer ${actor.token}`);
      expect(projGet.status).toBe(expectedStatus(actor.role, 'project.view', 200));

      const projPatch = await request(server)
        .patch(`/api/v1/projects/${targetProjectId}`)
        .set('Authorization', `Bearer ${actor.token}`)
        .send({ name: `Updated By ${actor.role}` });
      expect(projPatch.status).toBe(expectedStatus(actor.role, 'project.update', 200));

      const projDup = await request(server)
        .post(`/api/v1/projects/${targetProjectId}/duplicate`)
        .set('Authorization', `Bearer ${actor.token}`);
      expect(projDup.status).toBe(expectedStatus(actor.role, 'project.duplicate', 201));

      const projDel = await request(server)
        .delete(`/api/v1/projects/${targetProjectId}`)
        .set('Authorization', `Bearer ${actor.token}`);
      expect(projDel.status).toBe(expectedStatus(actor.role, 'project.delete', 204));
    }
  });

  it('creates initial Yjs doc, paginates with cursor, duplicates doc state, and soft-deletes with AuditLog', async () => {
    const server = app.getHttpServer();
    const owner = await registerUser('crud');

    const wsRes = await request(server)
      .post('/api/v1/workspaces')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'CRUD Studio' });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.workspace.id as string;
    createdWorkspaceIds.push(workspaceId);

    // Create 3 projects for pagination test
    const createdIds: string[] = [];
    for (const name of ['Alpha', 'Beta', 'Gamma']) {
      const res = await request(server)
        .post(`/api/v1/workspaces/${workspaceId}/projects`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name });
      expect(res.status).toBe(201);
      createdIds.push(res.body.project.id as string);
    }

    // Verify Yjs initial document on the first project
    const firstId = createdIds[0]!;
    const docRow = await prisma.projectDocument.findUnique({ where: { projectId: firstId } });
    expect(docRow).not.toBeNull();
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, new Uint8Array(docRow!.state));
    expect(ydoc.getMap('meta').get('title')).toBe('Alpha');
    expect(ydoc.getMap('meta').get('schemaVersion')).toBe(1);
    const pages = ydoc.getMap<Y.Map<unknown>>('pages');
    expect(pages.get('page:main')?.get('name')).toBe('Page 1');

    // Cursor pagination: limit=2 returns 2 items + nextCursor, then remaining 1 item
    const page1 = await request(server)
      .get(`/api/v1/workspaces/${workspaceId}/projects?limit=2`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(page1.status).toBe(200);
    expect(page1.body.projects).toHaveLength(2);
    expect(typeof page1.body.nextCursor).toBe('string');

    const page2 = await request(server)
      .get(`/api/v1/workspaces/${workspaceId}/projects?limit=2&cursor=${page1.body.nextCursor as string}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(page2.status).toBe(200);
    expect(page2.body.projects).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();

    // Duplicate clones doc state and appends (Copy)
    const dupRes = await request(server)
      .post(`/api/v1/projects/${firstId}/duplicate`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(dupRes.status).toBe(201);
    expect(dupRes.body.project.name).toBe('Alpha (Copy)');
    const dupDoc = await prisma.projectDocument.findUnique({
      where: { projectId: dupRes.body.project.id as string },
    });
    expect(dupDoc).not.toBeNull();
    const dupYdoc = new Y.Doc();
    Y.applyUpdate(dupYdoc, new Uint8Array(dupDoc!.state));
    expect(dupYdoc.getMap('meta').get('title')).toBe('Alpha');

    // Soft delete hides project and logs AuditLog
    const delRes = await request(server)
      .delete(`/api/v1/projects/${firstId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(delRes.status).toBe(204);

    const getDeleted = await request(server)
      .get(`/api/v1/projects/${firstId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(getDeleted.status).toBe(404);

    const audit = await prisma.auditLog.findFirst({
      where: { workspaceId, action: 'project.deleted', targetId: firstId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(owner.userId);
  });

  it('supports project-level member role overrides, LAST_OWNER guard, clearing overrides, and AuditLog', async () => {
    const server = app.getHttpServer();
    const owner = await registerUser('pm-owner');
    const editor = await registerUser('pm-editor');
    const viewer = await registerUser('pm-viewer');

    const createWs = await request(server)
      .post('/api/v1/workspaces')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Override Studio' });
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
      .send({ name: 'Override Deck' });
    expect(createProj.status).toBe(201);
    const projectId = createProj.body.project.id as string;

    const initialList = await request(server)
      .get(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(initialList.status).toBe(200);
    const initialEditorRow = (initialList.body as Array<Record<string, unknown>>).find(
      (m) => m.userId === editor.userId,
    );
    expect(initialEditorRow).toMatchObject({
      userId: editor.userId,
      workspaceRole: 'EDITOR',
      overrideRole: null,
      effectiveRole: 'EDITOR',
    });

    // EDITOR cannot modify project member overrides
    const forbiddenPut = await request(server)
      .put(`/api/v1/projects/${projectId}/members/${viewer.userId}`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ role: 'EDITOR' });
    expect(forbiddenPut.status).toBe(403);

    // Sole workspace OWNER cannot be overridden down from OWNER
    const lastOwnerPut = await request(server)
      .put(`/api/v1/projects/${projectId}/members/${owner.userId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ role: 'VIEWER' });
    expect(lastOwnerPut.status).toBe(409);
    expect(lastOwnerPut.body.error.code).toBe('LAST_OWNER');

    // OWNER downgrades workspace EDITOR -> project VIEWER
    const downgradeRes = await request(server)
      .put(`/api/v1/projects/${projectId}/members/${editor.userId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ role: 'VIEWER' });
    expect(downgradeRes.status).toBe(200);
    expect(downgradeRes.body).toMatchObject({
      userId: editor.userId,
      workspaceRole: 'EDITOR',
      overrideRole: 'VIEWER',
      effectiveRole: 'VIEWER',
    });

    const updatedList = await request(server)
      .get(`/api/v1/projects/${projectId}/members`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(updatedList.status).toBe(200);
    expect(
      (updatedList.body as Array<Record<string, unknown>>).find((m) => m.userId === editor.userId),
    ).toMatchObject({
      workspaceRole: 'EDITOR',
      overrideRole: 'VIEWER',
      effectiveRole: 'VIEWER',
    });

    const detailAsViewer = await request(server)
      .get(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${editor.token}`);
    expect(detailAsViewer.status).toBe(200);
    expect(detailAsViewer.body.role).toBe('VIEWER');

    const patchAsViewer = await request(server)
      .patch(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ name: 'Should Fail' });
    expect(patchAsViewer.status).toBe(403);

    const ticketAsViewer = await request(server)
      .post(`/api/v1/projects/${projectId}/realtime-ticket`)
      .set('Authorization', `Bearer ${editor.token}`);
    expect(ticketAsViewer.status).toBe(200);
    expect(ticketAsViewer.body.role).toBe('VIEWER');

    const updateAudit = await prisma.auditLog.findFirst({
      where: {
        workspaceId,
        action: 'project.member_override_updated',
        targetId: `${projectId}:${editor.userId}`,
      },
    });
    expect(updateAudit).not.toBeNull();

    // Clearing via DELETE restores workspace EDITOR role
    const clearDelete = await request(server)
      .delete(`/api/v1/projects/${projectId}/members/${editor.userId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(clearDelete.status).toBe(204);

    const patchRestored = await request(server)
      .patch(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${editor.token}`)
      .send({ name: 'Restored Editor Deck' });
    expect(patchRestored.status).toBe(200);

    const ticketRestored = await request(server)
      .post(`/api/v1/projects/${projectId}/realtime-ticket`)
      .set('Authorization', `Bearer ${editor.token}`);
    expect(ticketRestored.status).toBe(200);
    expect(ticketRestored.body.role).toBe('EDITOR');

    const clearAudit = await prisma.auditLog.findFirst({
      where: {
        workspaceId,
        action: 'project.member_override_cleared',
        targetId: `${projectId}:${editor.userId}`,
      },
    });
    expect(clearAudit).not.toBeNull();

    // Clearing via PUT { role: null } works symmetrically on promoted VIEWER
    const promoteRes = await request(server)
      .put(`/api/v1/projects/${projectId}/members/${viewer.userId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ role: 'EDITOR' });
    expect(promoteRes.status).toBe(200);
    expect(promoteRes.body.effectiveRole).toBe('EDITOR');

    const clearPut = await request(server)
      .put(`/api/v1/projects/${projectId}/members/${viewer.userId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ role: null });
    expect(clearPut.status).toBe(200);
    expect(clearPut.body).toMatchObject({
      workspaceRole: 'VIEWER',
      overrideRole: null,
      effectiveRole: 'VIEWER',
    });
  });
});
