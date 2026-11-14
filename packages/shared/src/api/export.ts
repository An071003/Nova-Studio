import { z } from 'zod';
import { CanvasNodeSchema } from '../doc/node.js';

export const EXPORT_PROCESS_QUEUE = 'export-process';

export const CreateExportSchema = z.object({
  format: z.literal('png').default('png'),
  scale: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(1),
  nodeIds: z.array(z.string().min(1)).max(1000).optional(),
  background: z.string().max(32).nullable().optional(),
  stateBase64: z.string().min(1).optional(),
});

export type CreateExportDto = z.infer<typeof CreateExportSchema>;

export const ExportStatusSchema = z.enum(['PENDING', 'PROCESSING', 'READY', 'FAILED']);
export type ExportStatus = z.infer<typeof ExportStatusSchema>;

export const ExportJobResponseSchema = z.object({
  jobId: z.string(),
  status: ExportStatusSchema,
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  url: z.string().url().optional(),
  error: z.string().optional(),
});

export type ExportJobResponse = z.infer<typeof ExportJobResponseSchema>;

export const ExportProcessJobSchema = z.object({
  jobId: z.string().min(1),
  projectId: z.string().min(1),
  format: z.literal('png'),
  scale: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  nodeIds: z.array(z.string().min(1)).max(1000).optional(),
  background: z.string().max(32).nullable().optional(),
  key: z.string().min(1),
  thumbnailKey: z.string().min(1).optional(),
  nodes: z.array(CanvasNodeSchema).optional(),
  assetKeys: z.record(z.string(), z.string()).optional(),
});

export type ExportProcessJob = z.infer<typeof ExportProcessJobSchema>;
