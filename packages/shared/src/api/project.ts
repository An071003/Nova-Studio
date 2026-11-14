import { z } from 'zod';
import { RoleSchema } from '../permissions.js';

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export type CreateProjectDto = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export type UpdateProjectDto = z.infer<typeof UpdateProjectSchema>;

export const UpdateProjectMemberSchema = z.object({
  role: RoleSchema.nullable(),
});

export type UpdateProjectMemberDto = z.infer<typeof UpdateProjectMemberSchema>;

export const ProjectMemberSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  name: z.string(),
  avatarUrl: z.string().nullable().optional(),
  workspaceRole: RoleSchema,
  overrideRole: RoleSchema.nullable(),
  effectiveRole: RoleSchema,
});

export type ProjectMemberDto = z.infer<typeof ProjectMemberSchema>;

export const ProjectSummarySchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  thumbnailUrl: z.string().nullable(),
  createdById: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectDetailResponseSchema = z.object({
  project: ProjectSummarySchema,
  role: RoleSchema,
});

export type ProjectDetailResponse = z.infer<typeof ProjectDetailResponseSchema>;

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

export const RealtimeTicketResponseSchema = z.object({
  ticket: z.string(),
  wsUrl: z.string(),
  role: RoleSchema,
});

export type RealtimeTicketResponse = z.infer<typeof RealtimeTicketResponseSchema>;
