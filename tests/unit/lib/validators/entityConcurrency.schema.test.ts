import { describe, expect, it } from 'vitest';
import { updateEntityBodySchema } from '../../../../src/lib/validators/entity.schema.js';

describe('entity concurrency schema', () => {
  it('entity update は current revision を必須にする', () => {
    expect(updateEntityBodySchema.safeParse({ name: 'Ren' }).success).toBe(false);
    expect(
      updateEntityBodySchema.safeParse({
        name: 'Ren',
        expected_updated_at: '2026-07-25T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});
