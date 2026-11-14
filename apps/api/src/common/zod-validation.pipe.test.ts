import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ERROR_CODES, NovaError } from '@nova/shared';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(z.object({ name: z.string().min(2) }));

  it('returns parsed data on valid input', () => {
    expect(pipe.transform({ name: 'Nova' })).toEqual({ name: 'Nova' });
  });

  it('throws NovaError VALIDATION_FAILED on invalid input', () => {
    expect(() => pipe.transform({ name: '' })).toThrow(NovaError);
    try {
      pipe.transform({ name: '' });
    } catch (err) {
      expect(err).toBeInstanceOf(NovaError);
      expect((err as NovaError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
      expect((err as NovaError).statusCode).toBe(400);
    }
  });
});
