import { Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  NovaError,
  type CreateProjectDto,
  type CursorPaginationQuery,
  type ProjectDetailResponse,
  type ProjectSummary,
  type Role,
  type UpdateProjectDto,
} from '@nova/shared';
import type { Project } from '@prisma/client';
import * as Y from 'yjs';
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
export class ProjectsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}

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
}
