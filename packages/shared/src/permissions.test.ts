import { describe, expect, it } from 'vitest';
import {
  can,
  PERMISSION_ACTIONS,
  resolveEffectiveRole,
  ROLES,
  type PermissionAction,
  type Role,
} from './permissions.js';

const EXPECTED_MATRIX: Record<Role, Record<PermissionAction, boolean>> = {
  OWNER: {
    'workspace.view': true,
    'workspace.update': true,
    'workspace.manage_members': true,
    'workspace.invite': true,
    'project.view': true,
    'project.create': true,
    'project.update': true,
    'project.duplicate': true,
    'project.delete': true,
    'project.realtime_connect': true,
    'canvas.edit': true,
    'asset.upload': true,
    'version.create': true,
    'version.restore': true,
    'version.view': true,
    'project.export': true,
  },
  EDITOR: {
    'workspace.view': true,
    'workspace.update': false,
    'workspace.manage_members': false,
    'workspace.invite': false,
    'project.view': true,
    'project.create': true,
    'project.update': true,
    'project.duplicate': true,
    'project.delete': false,
    'project.realtime_connect': true,
    'canvas.edit': true,
    'asset.upload': true,
    'version.create': true,
    'version.restore': true,
    'version.view': true,
    'project.export': true,
  },
  VIEWER: {
    'workspace.view': true,
    'workspace.update': false,
    'workspace.manage_members': false,
    'workspace.invite': false,
    'project.view': true,
    'project.create': false,
    'project.update': false,
    'project.duplicate': false,
    'project.delete': false,
    'project.realtime_connect': true,
    'canvas.edit': false,
    'asset.upload': false,
    'version.create': false,
    'version.restore': false,
    'version.view': true,
    'project.export': true,
  },
};

describe('permissions matrix (07-SECURITY)', () => {
  it('matches every role x action pair in 07-SECURITY', () => {
    for (const role of ROLES) {
      for (const action of PERMISSION_ACTIONS) {
        expect(can(role, action)).toBe(EXPECTED_MATRIX[role][action]);
      }
    }
  });

  it('denies null and undefined roles for every action', () => {
    for (const action of PERMISSION_ACTIONS) {
      expect(can(null, action)).toBe(false);
      expect(can(undefined, action)).toBe(false);
    }
  });

  it('resolves effective role with project override taking precedence', () => {
    expect(resolveEffectiveRole(null, 'OWNER')).toBeNull();
    expect(resolveEffectiveRole(undefined, 'EDITOR')).toBeNull();
    expect(resolveEffectiveRole('EDITOR', null)).toBe('EDITOR');
    expect(resolveEffectiveRole('EDITOR', undefined)).toBe('EDITOR');
    expect(resolveEffectiveRole('EDITOR', 'VIEWER')).toBe('VIEWER');
    expect(resolveEffectiveRole('VIEWER', 'EDITOR')).toBe('EDITOR');
  });
});
