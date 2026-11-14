import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ASSET_MIME_TYPES,
  CanvasNodeSchema,
  colorForUserId,
  CreateExportSchema,
  CreateProjectSchema,
  CreateUploadUrlSchema,
  CreateWorkspaceSchema,
  CursorPaginationQuerySchema,
  ERROR_CODES,
  LoginSchema,
  MAX_ASSET_SIZE_BYTES,
  NovaError,
  PRESENCE_COLORS,
  PresenceSchema,
  RegisterSchema,
} from './index.js';

describe('@nova/shared schemas & errors', () => {
  it('formats NovaError responses with default and custom status codes', () => {
    const err = new NovaError(ERROR_CODES.FORBIDDEN, 'Access denied', { action: 'project.delete' });
    expect(err.statusCode).toBe(403);
    expect(err.toResponse()).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Access denied',
        details: { action: 'project.delete' },
      },
    });

    const minimal = new NovaError(ERROR_CODES.NOT_FOUND, 'Missing');
    expect(minimal.statusCode).toBe(404);
    expect(minimal.toResponse()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Missing',
      },
    });
  });

  it('validates auth, workspace, project, pagination, and export schemas', () => {
    const reg = RegisterSchema.parse({
      email: '  Alice@Nova.DEV ',
      name: ' Alice ',
      password: 'Password123',
    });
    expect(reg.email).toBe('alice@nova.dev');
    expect(reg.name).toBe('Alice');

    expect(() => RegisterSchema.parse({ email: 'bad', name: 'A', password: '123' })).toThrow();
    expect(LoginSchema.parse({ email: 'USER@nova.dev', password: 'secret' }).email).toBe(
      'user@nova.dev',
    );
    expect(CreateWorkspaceSchema.parse({ name: ' Studio ' }).name).toBe('Studio');
    expect(CreateProjectSchema.parse({ name: ' Poster ' }).name).toBe('Poster');

    const page = CursorPaginationQuerySchema.parse({});
    expect(page.limit).toBe(20);
    expect(() => CursorPaginationQuerySchema.parse({ limit: 500 })).toThrow();

    const exp = CreateExportSchema.parse({});
    expect(exp).toEqual({ format: 'png', scale: 1 });
  });

  it('validates asset constraints constants and upload schema', () => {
    expect(MAX_ASSET_SIZE_BYTES).toBe(25 * 1024 * 1024);
    expect(ALLOWED_ASSET_MIME_TYPES).toContain('image/svg+xml');
    const valid = CreateUploadUrlSchema.parse({
      mimeType: 'image/png',
      sizeBytes: 2048,
      filename: 'hero.png',
    });
    expect(valid.filename).toBe('hero.png');
  });

  it('validates CanvasNode, Presence, and deterministic presence colors', () => {
    const node = CanvasNodeSchema.parse({
      id: 'n1',
      type: 'rect',
      index: 'a0',
      name: 'Rect 1',
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      createdBy: 'u1',
      updatedAt: 1700000000000,
    });
    expect(node.pageId).toBe('page:main');
    expect(node.opacity).toBe(1);

    const presence = PresenceSchema.parse({
      user: { id: 'u1', name: 'Alice', color: colorForUserId('u1') },
      cursor: { x: 100, y: 200 },
      selection: ['n1'],
      tool: 'select',
    });
    expect(PRESENCE_COLORS).toContain(presence.user.color);
    expect(colorForUserId('u1')).toBe(colorForUserId('u1'));
    expect(colorForUserId('')).toBe(PRESENCE_COLORS[0]);
  });
});
