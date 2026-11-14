import { Global, Inject, Injectable, Module } from '@nestjs/common';
import {
  can,
  ERROR_CODES,
  NovaError,
  resolveEffectiveRole,
  type PermissionAction,
  type Role,
} from '@nova/shared';
import type { Project, Workspace } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PermissionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async assertWorkspace(
    userId: string,
    workspaceId: string,
    action: PermissionAction,
  ): Promise<{ workspace: Workspace; role: Role }> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        members: {
          where: { userId },
          take: 1,
        },
      },
    });

    const member = workspace?.members[0];
    if (!workspace || !member) {
      throw new NovaError(ERROR_CODES.NOT_FOUND, 'Workspace not found');
    }

    const role = member.role as Role;
    if (!can(role, action)) {
      throw new NovaError(ERROR_CODES.FORBIDDEN, 'Insufficient workspace permissions');
    }

    return { workspace, role };
  }

  async assertProject(
    userId: string,
    projectId: string,
    action: PermissionAction,
  ): Promise<{ project: Project; role: Role }> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      include: {
        workspace: {
          include: {
            members: {
              where: { userId },
              take: 1,
            },
          },
        },
        members: {
          where: { userId },
          take: 1,
        },
      },
    });

    const workspaceMember = project?.workspace.members[0];
    if (!project || !workspaceMember) {
      throw new NovaError(ERROR_CODES.NOT_FOUND, 'Project not found');
    }

    const projectMember = project.members[0];
    const effectiveRole = resolveEffectiveRole(
      workspaceMember.role as Role,
      projectMember?.role as Role | undefined,
    );
    if (!effectiveRole || !can(effectiveRole, action)) {
      throw new NovaError(ERROR_CODES.FORBIDDEN, 'Insufficient project permissions');
    }

    return { project, role: effectiveRole };
  }
}

@Global()
@Module({
  providers: [PermissionService],
  exports: [PermissionService],
})
export class PermissionsModule {}
