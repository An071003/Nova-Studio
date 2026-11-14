import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ERROR_CODES, NovaError, type ErrorCode } from '@nova/shared';
import type { Response } from 'express';
import { logger } from './logger';

function mapStatusToErrorCode(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.UNAUTHORIZED:
      return ERROR_CODES.AUTH_TOKEN_EXPIRED;
    case HttpStatus.FORBIDDEN:
      return ERROR_CODES.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ERROR_CODES.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ERROR_CODES.CONFLICT;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ERROR_CODES.RATE_LIMITED;
    case HttpStatus.BAD_REQUEST:
      return ERROR_CODES.VALIDATION_FAILED;
    default:
      return ERROR_CODES.INTERNAL_ERROR;
  }
}

@Catch()
export class NovaExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof NovaError) {
      res.status(exception.statusCode).json(exception.toResponse());
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : typeof body === 'object' && body !== null && 'message' in body
            ? String((body as { message: unknown }).message)
            : exception.message;
      const code = mapStatusToErrorCode(status);
      res.status(status).json({
        error: {
          code,
          message,
        },
      });
      return;
    }

    logger.error({ err: exception }, 'Unhandled exception');
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Internal server error',
      },
    });
  }
}
