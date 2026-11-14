import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  ERROR_CODES,
  NovaError,
  type CreateInviteDto,
  type CreateWorkspaceDto,
  type InviteResponse,
  type Role,
  type UpdateMemberRoleDto,
  type UpdateWorkspaceDto,
  type WorkspaceMemberDto,
  type WorkspaceSummary,
} from '@nova/shared';
import { Redis } from 'ioredis';
import { getApiEnv } from '../common/env';
import { PermissionService } from '../permissions/permission.service';
import { PrismaService } from '../prisma/prisma.service';

const ROLE_RANK: Record<Role, number> = {
  VIEWER: 1,
  EDITOR: 2,
  OWNER: 3,
};

function hashInviteToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

function makeSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = randomBytes(3).toString('hex');
  return `${base || 'workspace'}-${suffix}`;
}

@Injectable()
export class WorkspacesService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {
    this.redis = new Redis(getApiEnv().redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });
    this.redis.on('error', () => {
      // Avoid unhandled error events during tests or transient Redis disconnects
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }

  private async publishRoleChange(payload: {
    userId: string;
    workspaceId: string;
    role: Role | null;
  }): Promise<void> {
    try {
      if (this.redis.status === 'wait') {
        await this.redis.connect();
      }
      await this.redis.publish(
        `nova:role-change:${payload.workspaceId}`,
        JSON.stringify(payload),
      );
    } catch {
      // Best-effort realtime signal; Postgres remains authoritative on reconnect
    }
  }

  async create(userId: string, dto: CreateWorkspaceDto): Promise<WorkspaceSummary> {
    const slug = makeSlug(dto.name);
    const created = await this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: { name: dto.name, slug },
      });
      await tx.workspaceMember.create({
        data: { workspaceId: workspace.id, userId, role: 'OWNER' },
      });
      return workspace;
    });

    return {
      id: created.id,
      name: created.name,
      slug: created.slug,
      role: 'OWNER',
      createdAt: created.createdAt.toISOString(),
    };
  }

  async getById(userId: string, workspaceId: string): Promise<WorkspaceSummary> {
    const { workspace, role } = await this.permissions.assertWorkspace(
      userId,
      workspaceId,
      'workspace.view',
    );
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      role,
      createdAt: workspace.createdAt.toISOString(),
    };
  }

  async update(
    userId: string,
    workspaceId: string,
    dto: UpdateWorkspaceDto,
  ): Promise<WorkspaceSummary> {
    const { role } = await this.permissions.assertWorkspace(
      userId,
      workspaceId,
      'workspace.update',
    );
    const updated = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { name: dto.name },
    });
    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      role,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  async listMembers(userId: string, workspaceId: string): Promise<WorkspaceMemberDto[]> {
    await this.permissions.assertWorkspace(userId, workspaceId, 'workspace.view');
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });
    return members.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      avatarUrl: m.user.avatarUrl,
      role: m.role as Role,
      joinedAt: m.joinedAt.toISOString(),
    }));
  }

  async updateMemberRole(
    actorUserId: string,
    workspaceId: string,
    targetUserId: string,
    dto: UpdateMemberRoleDto,
  ): Promise<WorkspaceMemberDto> {
    await this.permissions.assertWorkspace(actorUserId, workspaceId, 'workspace.manage_members');

    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
        include: { user: true },
      });
      if (!existing) {
        throw new NovaError(ERROR_CODES.NOT_FOUND, 'Workspace member not found');
      }

      if (existing.role === 'OWNER' && dto.role !== 'OWNER') {
        const ownerCount = await tx.workspaceMember.count({
          where: { workspaceId, role: 'OWNER' },
        });
        if (ownerCount <= 1) {
          throw new NovaError(
            ERROR_CODES.LAST_OWNER,
            'Workspace must retain at least one owner',
          );
        }
      }

      const member = await tx.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
        data: { role: dto.role },
        include: { user: true },
      });

      await tx.auditLog.create({
        data: {
          workspaceId,
          actorId: actorUserId,
          action: 'workspace.member_role_updated',
          targetType: 'workspace_member',
          targetId: targetUserId,
          meta: {
            previousRole: existing.role,
            nextRole: dto.role,
          },
        },
      });

      return member;
    });

    await this.publishRoleChange({
      userId: targetUserId,
      workspaceId,
      role: dto.role,
    });

    return {
      userId: updated.userId,
      email: updated.user.email,
      name: updated.user.name,
      avatarUrl: updated.user.avatarUrl,
      role: updated.role as Role,
      joinedAt: updated.joinedAt.toISOString(),
    };
  }

  async removeMember(
    actorUserId: string,
    workspaceId: string,
    targetUserId: string,
  ): Promise<void> {
    if (actorUserId === targetUserId) {
      await this.permissions.assertWorkspace(actorUserId, workspaceId, 'workspace.view');
    } else {
      await this.permissions.assertWorkspace(actorUserId, workspaceId, 'workspace.manage_members');
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      });
      if (!existing) {
        throw new NovaError(ERROR_CODES.NOT_FOUND, 'Workspace member not found');
      }

      if (existing.role === 'OWNER') {
        const ownerCount = await tx.workspaceMember.count({
          where: { workspaceId, role: 'OWNER' },
        });
        if (ownerCount <= 1) {
          throw new NovaError(
            ERROR_CODES.LAST_OWNER,
            'Workspace must retain at least one owner',
          );
        }
      }

      await tx.projectMember.deleteMany({
        where: {
          userId: targetUserId,
          project: { workspaceId },
        },
      });

      await tx.workspaceMember.delete({
        where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      });

      await tx.auditLog.create({
        data: {
          workspaceId,
          actorId: actorUserId,
          action: 'workspace.member_removed',
          targetType: 'workspace_member',
          targetId: targetUserId,
          meta: {
            previousRole: existing.role,
          },
        },
      });
    });

    await this.publishRoleChange({
      userId: targetUserId,
      workspaceId,
      role: null,
    });
  }

  async createInvite(
    actorUserId: string,
    workspaceId: string,
    dto: CreateInviteDto,
  ): Promise<InviteResponse> {
    await this.permissions.assertWorkspace(actorUserId, workspaceId, 'workspace.invite');

    const rawToken = randomBytes(24).toString('base64url');
    const tokenHash = hashInviteToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invite = await this.prisma.$transaction(async (tx) => {
      const created = await tx.invite.create({
        data: {
          workspaceId,
          email: dto.email ?? null,
          role: dto.role,
          tokenHash,
          expiresAt,
          createdById: actorUserId,
        },
      });

      await tx.auditLog.create({
        data: {
          workspaceId,
          actorId: actorUserId,
          action: 'workspace.invite_created',
          targetType: 'invite',
          targetId: created.id,
          meta: {
            email: dto.email ?? null,
            role: dto.role,
          },
        },
      });

      return created;
    });

    const env = getApiEnv();
    const baseUrl = env.webUrl.replace(/\/$/, '');
    return {
      id: invite.id,
      inviteUrl: `${baseUrl}/invite/${rawToken}`,
      role: invite.role as Role,
      email: invite.email,
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  async acceptInvite(userId: string, rawToken: string): Promise<WorkspaceSummary> {
    const tokenHash = hashInviteToken(rawToken);

    const workspaceId = await this.prisma.$transaction(async (tx) => {
      const invite = await tx.invite.findUnique({ where: { tokenHash } });
      if (!invite) {
        throw new NovaError(ERROR_CODES.NOT_FOUND, 'Invite not found');
      }
      if (invite.acceptedAt || invite.expiresAt.getTime() <= Date.now()) {
        throw new NovaError(
          ERROR_CODES.CONFLICT,
          'Invite has already been used or expired',
        );
      }

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true },
      });
      if (!user) {
        throw new NovaError(ERROR_CODES.NOT_FOUND, 'User not found');
      }

      if (invite.email && invite.email.toLowerCase() !== user.email.toLowerCase()) {
        throw new NovaError(
          ERROR_CODES.FORBIDDEN,
          'This invite was issued for a different email address',
        );
      }

      const marked = await tx.invite.updateMany({
        where: { id: invite.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (marked.count === 0) {
        throw new NovaError(
          ERROR_CODES.CONFLICT,
          'Invite has already been used or expired',
        );
      }

      const existingMember = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
      });
      if (!existingMember) {
        await tx.workspaceMember.create({
          data: {
            workspaceId: invite.workspaceId,
            userId,
            role: invite.role,
          },
        });
      } else if (ROLE_RANK[invite.role as Role] > ROLE_RANK[existingMember.role as Role]) {
        await tx.workspaceMember.update({
          where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId } },
          data: { role: invite.role },
        });
      }

      await tx.auditLog.create({
        data: {
          workspaceId: invite.workspaceId,
          actorId: userId,
          action: 'workspace.invite_accepted',
          targetType: 'invite',
          targetId: invite.id,
          meta: {
            workspaceId: invite.workspaceId,
            role: invite.role,
          },
        },
      });

      return invite.workspaceId;
    });

    return this.getById(userId, workspaceId);
  }
}
