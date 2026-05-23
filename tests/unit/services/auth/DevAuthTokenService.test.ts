import { jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import { createDevAuthToken } from '../../../../src/services/auth/DevAuthTokenService.js';

describe('createDevAuthToken', () => {
  it('creates a valid HS256 token with default claims', async () => {
    const secret = 'unit-test-secret';

    const result = await createDevAuthToken({
      jwtSecret: secret,
    });

    const verified = await jwtVerify(
      result.token,
      new TextEncoder().encode(secret),
      { algorithms: ['HS256'] },
    );

    expect(verified.payload.sub).toBe('dev-local-user');
    expect(verified.payload.email).toBe('dev@local.lyra');
    expect(result.expiresInHours).toBe(12);
  });

  it('accepts custom email, subject, and expiry', async () => {
    const secret = 'unit-test-secret';

    const result = await createDevAuthToken({
      jwtSecret: secret,
      subject: 'custom-user',
      email: 'custom@example.com',
      expiresInHours: 1,
    });

    const verified = await jwtVerify(
      result.token,
      new TextEncoder().encode(secret),
      { algorithms: ['HS256'] },
    );

    expect(verified.payload.sub).toBe('custom-user');
    expect(verified.payload.email).toBe('custom@example.com');
    expect(result.expiresInHours).toBe(1);
  });

  it('rejects non-positive expiry', async () => {
    await expect(
      createDevAuthToken({
        jwtSecret: 'unit-test-secret',
        expiresInHours: 0,
      }),
    ).rejects.toThrow('expiresInHours must be a positive number');
  });
});
