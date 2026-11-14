import { z } from 'zod';

export const ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const PERMISSION_ACTIONS = [
  'workspace.view',
  'workspace.update',
  'workspace.manage_members',
  'workspace.invite',
  'project.view',
  'project.create',
  'project.update',
  'project.duplicate',
  'project.delete',
  'project.realtime_connect',
  'canvas.edit',
  'asset.upload',
  'version.create',
  'version.restore',
  'version.view',
  'project.export',
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const PERMISSION_MATRIX: Record<Role, ReadonlySet<PermissionAction>> = {
  OWNER: new Set<PermissionAction>(PERMISSION_ACTIONS),
  EDITOR: new Set<PermissionAction>([
    'workspace.view',
    'project.view',
    'project.create',
    'project.update',
    'project.duplicate',
    'project.realtime_connect',
    'canvas.edit',
    'asset.upload',
    'version.create',
    'version.restore',
    'version.view',
    'project.export',
  ]),
  VIEWER: new Set<PermissionAction>([
    'workspace.view',
    'project.view',
    'project.realtime_connect',
    'version.view',
    'project.export',
  ]),
};

export function can(role: Role | null | undefined, action: PermissionAction): boolean {
  if (!role) {
    return false;
  }
  const allowed = PERMISSION_MATRIX[role];
  return allowed.has(action);
}

export function resolveEffectiveRole(
  workspaceRole: Role | null | undefined,
  projectOverrideRole: Role | null | undefined,
): Role | null {
  if (!workspaceRole) {
    return null;
  }
  return projectOverrideRole ?? workspaceRole;
}
