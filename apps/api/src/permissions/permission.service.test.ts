import { ERROR_CODES, NovaError, type Role } from '@nova/shared';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { PermissionService } from './permission.service';

function makePrismaStub(overrides: {
  workspace?: { id: string; name: string; slug: string; members: Array<{ role: Role }> } | null;
  project?: {
    id: string;
    workspaceId: string;
    name: string;
    deletedAt: Date | null;
    workspace: { members: Array<{ role: Role }> };
    members: Array<{ role: Role }>;
  } | null;
}): PrismaService {
  return {
    workspace: {
      findUnique: vi.fn().mockResolvedValue(overrides.workspace ?? null),
    },
    project: {
      findFirst: vi.fn().mockResolvedValue(overrides.project ?? null),
    },
  } as unknown as PrismaService;
}

describe('PermissionService', () => {
  it('returns workspace and role when member has permission', async () => {
    const prisma = makePrismaStub({
      workspace: { id: 'ws-1', name: 'Studio', slug: 'studio', members: [{ role: 'OWNER' }] },
    });
    const service = new PermissionService(prisma);

    const res = await service.assertWorkspace('user-1', 'ws-1', 'workspace.update');
    expect(res.role).toBe('OWNER');
    expect(res.workspace.id).toBe('ws-1');
  });

  it('throws NOT_FOUND when workspace is missing or user is not a member', async () => {
    const missingWs = new PermissionService(makePrismaStub({ workspace: null }));
    await expect(missingWs.assertWorkspace('user-1', 'ws-1', 'workspace.view')).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });

    const nonMember = new PermissionService(
      makePrismaStub({
        workspace: { id: 'ws-1', name: 'Studio', slug: 'studio', members: [] },
      }),
    );
    await expect(
      nonMember.assertWorkspace('user-2', 'ws-1', 'workspace.view'),
    ).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it('throws FORBIDDEN when member role lacks required workspace action', async () => {
    const editor = new PermissionService(
      makePrismaStub({
        workspace: { id: 'ws-1', name: 'Studio', slug: 'studio', members: [{ role: 'EDITOR' }] },
      }),
    );

    await expect(
      editor.assertWorkspace('user-1', 'ws-1', 'workspace.update'),
    ).rejects.toBeInstanceOf(NovaError);
    await expect(
      editor.assertWorkspace('user-1', 'ws-1', 'workspace.update'),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
  });

  it('applies ProjectMember override role over WorkspaceMember role', async () => {
    // Workspace VIEWER elevated to EDITOR on project -> can edit/update project
    const elevated = new PermissionService(
      makePrismaStub({
        project: {
          id: 'proj-1',
          workspaceId: 'ws-1',
          name: 'Deck',
          deletedAt: null,
          workspace: { members: [{ role: 'VIEWER' }] },
          members: [{ role: 'EDITOR' }],
        },
      }),
    );
    const ok = await elevated.assertProject('user-1', 'proj-1', 'project.update');
    expect(ok.role).toBe('EDITOR');

    // Workspace EDITOR restricted to VIEWER on project -> forbidden from project.update
    const restricted = new PermissionService(
      makePrismaStub({
        project: {
          id: 'proj-1',
          workspaceId: 'ws-1',
          name: 'Deck',
          deletedAt: null,
          workspace: { members: [{ role: 'EDITOR' }] },
          members: [{ role: 'VIEWER' }],
        },
      }),
    );
    await expect(
      restricted.assertProject('user-1', 'proj-1', 'project.update'),
    ).rejects.toMatchObject({
      code: ERROR_CODES.FORBIDDEN,
    });
  });

  it('throws NOT_FOUND when project is deleted or user is outside workspace', async () => {
    const service = new PermissionService(makePrismaStub({ project: null }));
    await expect(service.assertProject('user-1', 'proj-1', 'project.view')).rejects.toMatchObject({
      code: ERROR_CODES.NOT_FOUND,
    });
  });
});
