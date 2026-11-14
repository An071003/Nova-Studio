export const ERROR_CODES = {
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  ASSET_TOO_LARGE: 'ASSET_TOO_LARGE',
  ASSET_TYPE_NOT_ALLOWED: 'ASSET_TYPE_NOT_ALLOWED',
  LAST_OWNER: 'LAST_OWNER',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const DEFAULT_STATUS_BY_CODE: Record<ErrorCode, number> = {
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  ASSET_TOO_LARGE: 400,
  ASSET_TYPE_NOT_ALLOWED: 400,
  LAST_OWNER: 409,
  INTERNAL_ERROR: 500,
};

export interface ErrorPayload {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export class NovaError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown, statusCode?: number) {
    super(message);
    this.name = 'NovaError';
    this.code = code;
    this.statusCode = statusCode ?? DEFAULT_STATUS_BY_CODE[code];
    this.details = details;
  }

  toResponse(): ErrorPayload {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}
