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

export const RealtimeTicketResponseSchema = z.object({
  ticket: z.string(),
  wsUrl: z.string(),
  role: RoleSchema,
});

export type RealtimeTicketResponse = z.infer<typeof RealtimeTicketResponseSchema>;
