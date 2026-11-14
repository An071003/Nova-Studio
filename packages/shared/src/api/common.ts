import { z } from 'zod';
import { ERROR_CODES } from '../errors.js';

export const CursorPaginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CursorPaginationQuery = z.infer<typeof CursorPaginationQuerySchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum([
      ERROR_CODES.AUTH_INVALID_CREDENTIALS,
      ERROR_CODES.AUTH_TOKEN_EXPIRED,
      ERROR_CODES.FORBIDDEN,
      ERROR_CODES.NOT_FOUND,
      ERROR_CODES.VALIDATION_FAILED,
      ERROR_CODES.CONFLICT,
      ERROR_CODES.RATE_LIMITED,
      ERROR_CODES.ASSET_TOO_LARGE,
      ERROR_CODES.ASSET_TYPE_NOT_ALLOWED,
      ERROR_CODES.LAST_OWNER,
      ERROR_CODES.INTERNAL_ERROR,
    ]),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
