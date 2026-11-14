import { RoleSchema, type Role } from '@nova/shared';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

export const RealtimeTicketClaimsSchema = z.object({
  sub: z.string().min(1),
  projectId: z.string().min(1),
  role: RoleSchema,
  name: z.string().min(1),
  color: z.string().min(1),
  avatarUrl: z.string().optional(),
  type: z.literal('realtime'),
});

export type RealtimeTicketClaims = z.infer<typeof RealtimeTicketClaimsSchema>;

export interface RealtimeConnectionContext {
  userId: string;
  projectId: string;
  role: Role;
  name: string;
  color: string;
  avatarUrl?: string;
}

/** Extracts the database project ID from a Hocuspocus document name (supports optional `project:` prefix). */
export function extractProjectIdFromDocName(documentName: string): string {
  const trimmed = documentName.trim();
  const projectId = trimmed.startsWith('project:') ? trimmed.slice('project:'.length) : trimmed;
  if (!projectId) {
    throw new Error('Invalid project document name');
  }
  return projectId;
}

/** Signs a short-lived HS256 realtime ticket JWT for a user and project. */
export function signRealtimeTicket(
  claims: Omit<RealtimeTicketClaims, 'type'>,
  secret: string,
  expiresInSeconds = 60,
): string {
  const payload = RealtimeTicketClaimsSchema.parse({
    ...claims,
    type: 'realtime',
  });
  return jwt.sign(payload, secret, {
    algorithm: 'HS256',
    expiresIn: expiresInSeconds,
  });
}

/** Verifies a realtime ticket JWT and ensures it grants access to the requested project document. */
export function verifyRealtimeTicket(
  token: string,
  secret: string,
  expectedProjectId: string,
): RealtimeConnectionContext {
  if (!token) {
    throw new Error('Missing realtime ticket');
  }

  let decoded: string | jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid realtime ticket';
    throw new Error(`Unauthorized: ${message}`);
  }

  const parsed = RealtimeTicketClaimsSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error('Unauthorized: malformed realtime ticket claims');
  }

  if (parsed.data.projectId !== expectedProjectId) {
    throw new Error('Forbidden: realtime ticket project mismatch');
  }

  return {
    userId: parsed.data.sub,
    projectId: parsed.data.projectId,
    role: parsed.data.role,
    name: parsed.data.name,
    color: parsed.data.color,
    ...(parsed.data.avatarUrl !== undefined ? { avatarUrl: parsed.data.avatarUrl } : {}),
  };
}
