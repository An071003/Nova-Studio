import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import {
  colorForUserId,
  ERROR_CODES,
  NovaError,
  RealtimeTicketClaimsSchema,
  RealtimeTicketResponseSchema,
  resolveEffectiveRole,
  type CreateProjectDto,
  type CursorPaginationQuery,
  type ProjectDetailResponse,
  type ProjectMemberDto,
  type ProjectSummary,
  type RealtimeTicketResponse,
  type Role,
  type UpdateProjectDto,
  type UpdateProjectMemberDto,
} from '@nova/shared';
import type { Project } from '@prisma/client';
import { Redis } from 'ioredis';
import jwt from 'jsonwebtoken';
import * as Y from 'yjs';
import { getApiEnv } from '../common/env';
import { PermissionService } from '../permissions/permission.service';
import { PrismaService } from '../prisma/prisma.service';

export function createInitialProjectDocBytes(title: string): Uint8Array<ArrayBuffer> {
  const doc = new Y.Doc();
  doc.transact(() => {
    const meta = doc.getMap('meta');
    meta.set('schemaVersion', 1);
    meta.set('createdAt', Date.now());
    meta.set('title', title);

    const pages = doc.getMap<Y.Map<unknown>>('pages');
    const mainPage = new Y.Map<unknown>();
    mainPage.set('id', 'page:main');
    mainPage.set('name', 'Page 1');
    mainPage.set('index', 'a0');
    mainPage.set('background', '#1A1A1E');
    pages.set('page:main', mainPage);
  });
  return Uint8Array.from(Y.encodeStateAsUpdate(doc));
}

function toProjectSummary(p: Project): ProjectSummary {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    name: p.name,
    thumbnailUrl: p.thumbnailKey ? `/api/v1/projects/${p.id}/thumbnail` : null,
    createdById: p.createdById,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

@Injectable()
export class ProjectsService implements OnModuleDestroy {
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

  private async publishProjectRoleChange(payload: {
    userId: string;
    workspaceId: string;
    projectId: string;
    role: Role;
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
      // Best-effort notification; Postgres remains authoritative on reconnect
    }
  }

  async listInWorkspace(
    userId: string,
    workspaceId: string,
    query: CursorPaginationQuery,
  ): Promise<{ projects: ProjectSummary[]; nextCursor: string | null }> {
    await this.permissions.assertWorkspace(userId, workspaceId, 'project.view');

    const rows = await this.prisma.project.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;
    return {
      projects: items.map(toProjectSummary),
      nextCursor,
    };
  }

  async create(
    userId: string,
    workspaceId: string,
    dto: CreateProjectDto,
  ): Promise<ProjectDetailResponse> {
    const { role } = await this.permissions.assertWorkspace(userId, workspaceId, 'project.create');
    const initialBytes = createInitialProjectDocBytes(dto.name);

    const project = await this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          workspaceId,
          name: dto.name,
          createdById: userId,
        },
      });
      await tx.projectDocument.create({
        data: {
          projectId: created.id,
          state: initialBytes,
          schemaVersion: 1,
        },
      });
      return created;
    });

    return { project: toProjectSummary(project), role };
  }

  async getById(userId: string, projectId: string): Promise<ProjectDetailResponse> {
    const { project, role } = await this.permissions.assertProject(userId, projectId, 'project.view');
    return { project: toProjectSummary(project), role };
  }

  async update(
    userId: string,
    projectId: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectDetailResponse> {
    const { role } = await this.permissions.assertProject(userId, projectId, 'project.update');
    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { name: dto.name },
    });
    return { project: toProjectSummary(updated), role };
  }

  async remove(userId: string, projectId: string): Promise<void> {
    const { project } = await this.permissions.assertProject(userId, projectId, 'project.delete');
    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: projectId },
        data: { deletedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          workspaceId: project.workspaceId,
          actorId: userId,
          action: 'project.deleted',
          targetType: 'Project',
          targetId: projectId,
          meta: { name: project.name },
        },
      });
    });
  }

  async duplicate(userId: string, projectId: string): Promise<ProjectDetailResponse> {
    const { project } = await this.permissions.assertProject(
      userId,
      projectId,
      'project.duplicate',
    );
    const sourceDoc = await this.prisma.projectDocument.findUnique({
      where: { projectId },
    });
    if (!sourceDoc) {
      throw new NovaError(ERROR_CODES.NOT_FOUND, 'Project document not found');
    }

    const copyName = `${project.name} (Copy)`.slice(0, 120);
    const created = await this.prisma.$transaction(async (tx) => {
      const copy = await tx.project.create({
        data: {
          workspaceId: project.workspaceId,
          name: copyName,
          createdById: userId,
        },
      });
      await tx.projectDocument.create({
        data: {
          projectId: copy.id,
          state: Uint8Array.from(sourceDoc.state),
          schemaVersion: sourceDoc.schemaVersion,
        },
      });
      return copy;
    });

    const effective = await this.permissions.assertProject(userId, created.id, 'project.view');
    return { project: toProjectSummary(created), role: effective.role as Role };
  }

  async issueRealtimeTicket(userId: string, projectId: string): Promise<RealtimeTicketResponse> {
    const { role } = await this.permissions.assertProject(
      userId,
      projectId,
      'project.realtime_connect',
    );

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, avatarUrl: true },
    });
    if (!user) {
      throw new NovaError(ERROR_CODES.NOT_FOUND, 'User not found');
    }

    const env = getApiEnv();
    const claims = RealtimeTicketClaimsSchema.parse({
      sub: user.id,
      projectId,
      role,
      name: user.name,
      color: colorForUserId(user.id),
      ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
      type: 'realtime',
    });

    const ticket = jwt.sign(claims, env.realtimeJwtSecret, {
      algorithm: 'HS256',
      expiresIn: 60,
    });

    return RealtimeTicketResponseSchema.parse({
      ticket,
      wsUrl: env.realtimeUrl,
      role,
    });
  }

  async listProjectMembers(userId: string, projectId: string): Promise<ProjectMemberDto[]> {
    const { project } = await this.permissions.assertProject(userId, projectId, 'project.view');

    const [workspaceMembers, overrides] = await Promise.all([
      this.prisma.workspaceMember.findMany({
        where: { workspaceId: project.workspaceId },
        include: { user: true },
        orderBy: { joinedAt: 'asc' },
      }),
      this.prisma.projectMember.findMany({
        where: { projectId },
      }),
    ]);

    const overrideByUserId = new Map<string, Role>(
      overrides.map((o) => [o.userId, o.role as Role]),
    );

    return workspaceMembers.map((wm) => {
      const workspaceRole = wm.role as Role;
      const overrideRole = overrideByUserId.get(wm.userId) ?? null;
      const effectiveRole = resolveEffectiveRole(workspaceRole, overrideRole) ?? workspaceRole;
      return {
        userId: wm.userId,
        email: wm.user.email,
        name: wm.user.name,
        avatarUrl: wm.user.avatarUrl,
        workspaceRole,
        overrideRole,
        effectiveRole,
      };
    });
  }

  async setProjectMemberRole(
    actorUserId: string,
    projectId: string,
    targetUserId: string,
    dto: UpdateProjectMemberDto,
  ): Promise<ProjectMemberDto> {
    const { project } = await this.permissions.assertProject(
      actorUserId,
      projectId,
      'workspace.manage_members',
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const wm = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: project.workspaceId, userId: targetUserId },
        },
        include: { user: true },
      });
      if (!wm) {
        throw new NovaError(ERROR_CODES.NOT_FOUND, 'Workspace member not found');
      }

      const workspaceRole = wm.role as Role;
      if (workspaceRole === 'OWNER' && dto.role !== null && dto.role !== 'OWNER') {
        const ownerCount = await tx.workspaceMember.count({
          where: { workspaceId: project.workspaceId, role: 'OWNER' },
        });
        if (ownerCount <= 1) {
          throw new NovaError(
            ERROR_CODES.LAST_OWNER,
            'Workspace must retain at least one owner',
          );
        }
      }

      if (dto.role === null) {
        await tx.projectMember.deleteMany({
          where: { projectId, userId: targetUserId },
        });
      } else {
        await tx.projectMember.upsert({
          where: { projectId_userId: { projectId, userId: targetUserId } },
          create: { projectId, userId: targetUserId, role: dto.role },
          update: { role: dto.role },
        });
      }

      const overrideRole = dto.role;
      const effectiveRole = resolveEffectiveRole(workspaceRole, overrideRole) ?? workspaceRole;

      await tx.auditLog.create({
        data: {
          workspaceId: project.workspaceId,
          actorId: actorUserId,
          action:
            overrideRole === null
              ? 'project.member_override_cleared'
              : 'project.member_override_updated',
          targetType: 'project_member',
          targetId: `${projectId}:${targetUserId}`,
          meta: {
            projectId,
            userId: targetUserId,
            overrideRole,
            effectiveRole,
          },
        },
      });

      return {
        member: {
          userId: wm.userId,
          email: wm.user.email,
          name: wm.user.name,
          avatarUrl: wm.user.avatarUrl,
          workspaceRole,
          overrideRole,
          effectiveRole,
        } satisfies ProjectMemberDto,
        effectiveRole,
      };
    });

    await this.publishProjectRoleChange({
      userId: targetUserId,
      workspaceId: project.workspaceId,
      projectId,
      role: result.effectiveRole,
    });

    return result.member;
  }

  async removeProjectMemberOverride(
    actorUserId: string,
    projectId: string,
    targetUserId: string,
  ): Promise<void> {
    await this.setProjectMemberRole(actorUserId, projectId, targetUserId, { role: null });
  }
}
