import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateWorkspaceDto,
  Role,
  UpdateWorkspaceDto,
  WorkspaceMemberDto,
  WorkspaceSummary,
} from '@nova/shared';
import { PermissionService } from '../permissions/permission.service';
import { PrismaService } from '../prisma/prisma.service';

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
export class WorkspacesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}

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
}
