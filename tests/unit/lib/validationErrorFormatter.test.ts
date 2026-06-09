import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { formatZodValidationError } from '../../../src/lib/validationErrorFormatter.js';

describe('formatZodValidationError', () => {
  it('formats a small public message without dumping the raw Zod JSON payload', () => {
    const schema = z
      .object({
        title: z.string().min(1),
        frames: z.array(z.object({ id: z.string().uuid(), order: z.number().int().positive() })),
      })
      .strict();
    const result = schema.safeParse({
      title: '',
      frames: [{ id: 'not-a-uuid', order: 0 }],
      unexpected: true,
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    const message = formatZodValidationError(result.error);

    expect(message).toContain('Validation failed:');
    expect(message).toContain('title:');
    expect(message).toContain('frames[0].id:');
    expect(message).toContain('plus 1 more issue(s)');
    expect(message).not.toContain('"code"');
    expect(message.length).toBeLessThanOrEqual(500);
  });

  it('redacts sensitive values from validation messages', () => {
    const fakeApiKey = ['sk', 'secret123456789'].join('-');
    const schema = z.string().superRefine((_value, ctx) => {
      ctx.addIssue({
        code: 'custom',
        message: `provider returned Authorization: Bearer ${fakeApiKey}`,
      });
    });
    const result = schema.safeParse('x');

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    const message = formatZodValidationError(result.error);

    expect(message).toContain('Bearer [redacted]');
    expect(message).not.toContain(fakeApiKey);
  });
});
