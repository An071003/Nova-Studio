import { z } from 'zod';

export const AUTO_VERSION_QUEUE = 'auto-version';

export const CreateVersionSchema = z.object({
  label: z.string().trim().min(1).max(120),
  stateBase64: z.string().min(1).optional(),
});

export type CreateVersionDto = z.infer<typeof CreateVersionSchema>;

export const RestoreVersionBodySchema = z.object({
  currentStateBase64: z.string().min(1).optional(),
});

export type RestoreVersionBodyDto = z.infer<typeof RestoreVersionBodySchema>;

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

export const RestoreVersionResponseSchema = z.object({
  version: VersionSummarySchema,
  backupVersion: VersionSummarySchema,
});

export type RestoreVersionResponse = z.infer<typeof RestoreVersionResponseSchema>;
