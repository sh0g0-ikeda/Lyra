import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { assertMobileResponseContract } from '../../../src/routes/mobileResponseContract.js';

describe('Mobile production response contract', () => {
  it('transform付きschemaでも検証後のwire payloadを変更しない', () => {
    const schema = z
      .object({
        organization: z.object({ id: z.string().uuid() }),
      })
      .transform(({ organization }) => organization);
    const payload = {
      organization: { id: '11111111-1111-4111-8111-111111111111' },
    };

    expect(assertMobileResponseContract(schema, payload)).toBe(payload);
  });

  it('default付きschemaでも省略されたwire fieldを追加しない', () => {
    const schema = z.object({
      items: z.array(z.string()),
      next_cursor: z.string().nullable().optional().default(null),
    });
    const payload = { items: [] };

    expect(assertMobileResponseContract(schema, payload)).toEqual({ items: [] });
    expect('next_cursor' in assertMobileResponseContract(schema, payload)).toBe(false);
  });

  it('不正payloadの値を例外メッセージへ漏らさない', () => {
    const secret = 'provider-secret-value';

    expect(() =>
      assertMobileResponseContract(z.object({ id: z.string().uuid() }), {
        id: secret,
      })
    ).toThrowError('Mobile response contract validation failed');

    try {
      assertMobileResponseContract(z.object({ id: z.string().uuid() }), {
        id: secret,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
