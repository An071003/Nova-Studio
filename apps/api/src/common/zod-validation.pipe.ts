import type { PipeTransform } from '@nestjs/common';
import { ERROR_CODES, NovaError } from '@nova/shared';
import type { ZodType } from 'zod';

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new NovaError(
        ERROR_CODES.VALIDATION_FAILED,
        'Request validation failed',
        parsed.error.flatten(),
      );
    }
    return parsed.data;
  }
}
