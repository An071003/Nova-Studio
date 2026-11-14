import { z } from 'zod';
import { RoleSchema } from '../permissions.js';

export const CreateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export type CreateWorkspaceDto = z.infer<typeof CreateWorkspaceSchema>;

export const UpdateWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export type UpdateWorkspaceDto = z.infer<typeof UpdateWorkspaceSchema>;

export const UpdateMemberRoleSchema = z.object({
  role: RoleSchema,
});

export type UpdateMemberRoleDto = z.infer<typeof UpdateMemberRoleSchema>;

export const CreateInviteSchema = z.object({
  email: z.string().trim().email().max(255).toLowerCase().optional(),
  role: RoleSchema.default('EDITOR'),
});

export type CreateInviteDto = z.infer<typeof CreateInviteSchema>;

export const WorkspaceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: RoleSchema,
  createdAt: z.string(),
});

export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;

export const WorkspaceMemberSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  name: z.string(),
  avatarUrl: z.string().nullable().optional(),
  role: RoleSchema,
  joinedAt: z.string(),
});

export type WorkspaceMemberDto = z.infer<typeof WorkspaceMemberSchema>;

export const InviteResponseSchema = z.object({
  id: z.string(),
  inviteUrl: z.string(),
  role: RoleSchema,
  email: z.string().nullable(),
  expiresAt: z.string(),
});

export type InviteResponse = z.infer<typeof InviteResponseSchema>;
