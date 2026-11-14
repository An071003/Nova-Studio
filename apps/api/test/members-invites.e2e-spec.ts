import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ERROR_CODES } from '@nova/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Workspace Members & Invites (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdEmails: string[] = [];
  const createdWorkspaceIds: string[] = [];

  async function registerUser(label: string): Promise<{
    userId: string;
    email: string;
    token: string;
  }> {
    const email = `members-${label}-${randomUUID()}@nova.dev`;
    createdEmails.push(email);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, name: `User ${label}`, password: 'StrongPassword1!' });
    expect(res.status).toBe(201);
    return {
      userId: res.body.user.id as string,
      email,
      token: res.body.accessToken as string,
    };
  }

  function extractTokenFromInviteUrl(inviteUrl: string): string {
    const parts = inviteUrl.split('/');
    return parts[parts.length - 1] ?? '';
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

  it('creates and accepts invites, updates roles with LAST_OWNER guard, removes members, and logs AuditLog', async () => {
    const server = app.getHttpServer();
    const owner = await registerUser('owner');
    const invitee = await registerUser('invitee');
    const wrongUser = await registerUser('wrong');
    const secondOwner = await registerUser('second-owner');

    const wsRes = await request(server)
      .post('/api/v1/workspaces')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Team Members Workspace' });
    expect(wsRes.status).toBe(201);
    const workspaceId = wsRes.body.workspace.id as string;
    createdWorkspaceIds.push(workspaceId);

    // 1. OWNER cannot downgrade sole OWNER (LAST_OWNER 409)
    const soleOwnerDowngrade = await request(server)
      .patch(`/api/v1/workspaces/${workspaceId}/members/${owner.userId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ role: 'EDITOR' });
    expect(soleOwnerDowngrade.status).toBe(409);
    expect(soleOwnerDowngrade.body.error.code).toBe(ERROR_CODES.LAST_OWNER);

    // OWNER cannot remove self as sole OWNER (LAST_OWNER 409)
    const soleOwnerDelete = await request(server)
      .delete(`/api/v1/workspaces/${workspaceId}/members/${owner.userId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(soleOwnerDelete.status).toBe(409);
    expect(soleOwnerDelete.body.error.code).toBe(ERROR_CODES.LAST_OWNER);

    // 2. Email-scoped invite: wrong user receives 403, target user accepts 200
    const emailInviteRes = await request(server)
      .post(`/api/v1/workspaces/${workspaceId}/invites`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ email: invitee.email, role: 'EDITOR' });
    expect(emailInviteRes.status).toBe(201);
    expect(emailInviteRes.body.inviteUrl).toContain('/invite/');
    expect(emailInviteRes.body.role).toBe('EDITOR');
    const inviteToken = extractTokenFromInviteUrl(emailInviteRes.body.inviteUrl as string);
    expect(inviteToken.length).toBeGreaterThan(10);

    const wrongAccept = await request(server)
      .post(`/api/v1/invites/${inviteToken}/accept`)
      .set('Authorization', `Bearer ${wrongUser.token}`);
    expect(wrongAccept.status).toBe(403);
    expect(wrongAccept.body.error.code).toBe(ERROR_CODES.FORBIDDEN);

    const acceptRes = await request(server)
      .post(`/api/v1/invites/${inviteToken}/accept`)
      .set('Authorization', `Bearer ${invitee.token}`);
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.workspace.id).toBe(workspaceId);
    expect(acceptRes.body.workspace.role).toBe('EDITOR');

    // Second accept of same token fails with 409 CONFLICT
    const reuseRes = await request(server)
      .post(`/api/v1/invites/${inviteToken}/accept`)
      .set('Authorization', `Bearer ${invitee.token}`);
    expect(reuseRes.status).toBe(409);
    expect(reuseRes.body.error.code).toBe(ERROR_CODES.CONFLICT);

    // Unknown token -> 404
    const missingTokenRes = await request(server)
      .post('/api/v1/invites/nonexistent-token-123/accept')
      .set('Authorization', `Bearer ${invitee.token}`);
    expect(missingTokenRes.status).toBe(404);

    // 3. Non-OWNER (EDITOR) cannot create invites or change roles (403)
    const editorCreateInvite = await request(server)
      .post(`/api/v1/workspaces/${workspaceId}/invites`)
      .set('Authorization', `Bearer ${invitee.token}`)
      .send({ role: 'VIEWER' });
    expect(editorCreateInvite.status).toBe(403);

    const editorRolePatch = await request(server)
      .patch(`/api/v1/workspaces/${workspaceId}/members/${owner.userId}`)
      .set('Authorization', `Bearer ${invitee.token}`)
      .send({ role: 'VIEWER' });
    expect(editorRolePatch.status).toBe(403);

    // 4. OWNER downgrades invitee EDITOR -> VIEWER
    const downgradeRes = await request(server)
      .patch(`/api/v1/workspaces/${workspaceId}/members/${invitee.userId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ role: 'VIEWER' });
    expect(downgradeRes.status).toBe(200);
    expect(downgradeRes.body.member.role).toBe('VIEWER');

    // Verify GET members reflects VIEWER role
    const membersRes = await request(server)
      .get(`/api/v1/workspaces/${workspaceId}/members`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(membersRes.status).toBe(200);
    const updatedInvitee = (membersRes.body.members as Array<{ userId: string; role: string }>).find(
      (m) => m.userId === invitee.userId,
    );
    expect(updatedInvitee?.role).toBe('VIEWER');

    // 5. Open invite for second owner, then owner can leave / downgrade if another OWNER remains
    const openInviteRes = await request(server)
      .post(`/api/v1/workspaces/${workspaceId}/invites`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ role: 'OWNER' });
    expect(openInviteRes.status).toBe(201);
    const openToken = extractTokenFromInviteUrl(openInviteRes.body.inviteUrl as string);

    const secondAccept = await request(server)
      .post(`/api/v1/invites/${openToken}/accept`)
      .set('Authorization', `Bearer ${secondOwner.token}`);
    expect(secondAccept.status).toBe(200);
    expect(secondAccept.body.workspace.role).toBe('OWNER');

    // Invitee cannot remove someone else (403), but can remove self (204)
    const forbiddenRemove = await request(server)
      .delete(`/api/v1/workspaces/${workspaceId}/members/${secondOwner.userId}`)
      .set('Authorization', `Bearer ${invitee.token}`);
    expect(forbiddenRemove.status).toBe(403);

    const removeByOwner = await request(server)
      .delete(`/api/v1/workspaces/${workspaceId}/members/${invitee.userId}`)
      .set('Authorization', `Bearer ${owner.token}`);
    expect(removeByOwner.status).toBe(204);

    // 6. Verify AuditLog rows in DB
    const auditLogs = await prisma.auditLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    const actions = auditLogs.map((l) => l.action);
    expect(actions).toContain('workspace.invite_created');
    expect(actions).toContain('workspace.invite_accepted');
    expect(actions).toContain('workspace.member_role_updated');
    expect(actions).toContain('workspace.member_removed');
  });
});
