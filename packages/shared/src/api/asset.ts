import { z } from 'zod';

export const ALLOWED_ASSET_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
] as const;

export type AllowedAssetMimeType = (typeof ALLOWED_ASSET_MIME_TYPES)[number];

export const MAX_ASSET_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

export const AssetStatusSchema = z.enum(['PENDING', 'READY', 'FAILED']);
export type AssetStatus = z.infer<typeof AssetStatusSchema>;

export const CreateUploadUrlSchema = z.object({
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().positive(),
  filename: z.string().trim().min(1).max(255),
});

export type CreateUploadUrlDto = z.infer<typeof CreateUploadUrlSchema>;

export const UploadUrlResponseSchema = z.object({
  assetId: z.string(),
  putUrl: z.string().url(),
  expiresIn: z.number().int().positive(),
});

export type UploadUrlResponse = z.infer<typeof UploadUrlResponseSchema>;

export const AssetSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  status: AssetStatusSchema,
  createdAt: z.string(),
});

export type AssetDto = z.infer<typeof AssetSchema>;

export const AssetUrlResponseSchema = z.object({
  url: z.string().url(),
  expiresIn: z.number().int().positive(),
});

export type AssetUrlResponse = z.infer<typeof AssetUrlResponseSchema>;
