import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConfigurationError } from '../../../src/domain/errors/index.js';
import { assertMobileResponseContract } from '../../../src/routes/mobileResponseContract.js';

describe('Mobile向けレスポンス契約', () => {
  it('transform付きschemaでも元のwire payloadを同一参照で返す', () => {
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

  it('default付きschemaでも省略fieldをwire payloadへ追加しない', () => {
    const schema = z.object({
      items: z.array(z.string()),
      next_cursor: z.string().nullable().optional().default(null),
    });
    const payload = { items: [] };

    expect(assertMobileResponseContract(schema, payload)).toBe(payload);
    expect('next_cursor' in assertMobileResponseContract(schema, payload)).toBe(false);
  });

  it('schemaに違反するpayloadは安定したConfigurationErrorで拒否する', () => {
    const invoke = (): void => {
      assertMobileResponseContract(z.object({ id: z.string().uuid() }), {
        id: 'invalid-id',
      });
    };

    expect(invoke).toThrowError(ConfigurationError);
    expect(invoke).toThrowError('Mobile response contract validation failed');
  });

  it('不正payloadの値を例外メッセージへ漏らさない', () => {
    const secret = 'provider-secret-value';
    let capturedError: unknown;

    try {
      assertMobileResponseContract(z.object({ id: z.string().uuid() }), {
        id: secret,
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(ConfigurationError);
    expect(String(capturedError)).not.toContain(secret);
  });
});
