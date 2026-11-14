import { z } from 'zod';

export const CreateExportSchema = z.object({
  format: z.literal('png').default('png'),
  scale: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(1),
  nodeIds: z.array(z.string().min(1)).max(1000).optional(),
});

export type CreateExportDto = z.infer<typeof CreateExportSchema>;

export const ExportStatusSchema = z.enum(['PENDING', 'PROCESSING', 'READY', 'FAILED']);
export type ExportStatus = z.infer<typeof ExportStatusSchema>;

export const ExportJobResponseSchema = z.object({
  jobId: z.string(),
  status: ExportStatusSchema,
  url: z.string().url().optional(),
  error: z.string().optional(),
});

export type ExportJobResponse = z.infer<typeof ExportJobResponseSchema>;
