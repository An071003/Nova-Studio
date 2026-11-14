import { z } from 'zod';

export const CreateVersionSchema = z.object({
  label: z.string().trim().min(1).max(120),
});

export type CreateVersionDto = z.infer<typeof CreateVersionSchema>;

export const VersionSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  label: z.string(),
  createdById: z.string(),
  createdAt: z.string(),
  isAuto: z.boolean(),
});

export type VersionSummary = z.infer<typeof VersionSummarySchema>;

export const VersionPreviewSchema = z.object({
  id: z.string(),
  label: z.string(),
  stateBase64: z.string(),
  createdAt: z.string(),
});

export type VersionPreview = z.infer<typeof VersionPreviewSchema>;
