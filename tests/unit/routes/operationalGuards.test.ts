import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type { RateLimitResult, RateLimitStore } from '../../../src/middleware/rateLimit.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../src/services/credit/CreditService.js';

const jwtSecret = 'unit-test-secret';
const user: AuthenticatedUser = {
  id: 'user-1',
  supabaseId: 'supabase-user-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};

class FakeUserProvisioningService implements UserProvisioningPort {
  public async provisionFromSupabaseClaims(claims: SupabaseJwtClaims): Promise<ProvisionedUser> {
    return {
      user: {
        ...user,
        supabaseId: claims.sub,
        email: claims.email,
      },
      isNewUser: false,
    };
  }
}

class FakeCreditService implements CreditServicePort {
  public async getBalance(_userId: string): Promise<CreditBalanceSnapshot> {
    return { monthlyCredits: 10, purchasedCredits: 0, totalCredits: 10, monthlyExpiresAt: null };
  }

  public async grantSignupBonus(userId: string): Promise<CreditBalanceSnapshot> {
    return this.getBalance(userId);
  }

  public async consumeCredits(params: ConsumeCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance(params.userId);
  }

  public async refundCredits(params: RefundCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance(params.userId);
  }
}

class FixedRateLimitStore implements RateLimitStore {
  private calls = 0;

  public async consume(): Promise<RateLimitResult> {
    this.calls += 1;

    if (this.calls === 1) {
      return {
        allowed: true,
        remaining: 0,
        retryAfterSeconds: 60,
        resetAt: new Date('2026-05-01T00:00:00.000Z'),
      };
    }

    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 60,
      resetAt: new Date('2026-05-01T00:00:00.000Z'),
    };
  }
}

describe('operational guards', () => {
  it('returns x-request-id on healthz', async () => {
    const app = createApp();

    const response = await app.request('/healthz');

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('returns security headers on rejected API preflight', async () => {
    const app = createApp();

    const response = await app.request('/api/works', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://unconfigured-origin.example',
      },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('returns 429 with retry-after once the rate limit is exceeded', async () => {
    const app = createApp({
      creditService: new FakeCreditService(),
      userProvisioningService: new FakeUserProvisioningService(),
      rateLimitStore: new FixedRateLimitStore(),
      jwtSecret,
    });
    const token = await createToken();

    const firstResponse = await app.request('/api/billing/balance', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const secondResponse = await app.request('/api/billing/balance', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(429);
    expect(secondResponse.headers.get('retry-after')).toBe('60');
    await expect(secondResponse.json()).resolves.toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded for read. Retry after 60 seconds',
      },
    });
  });

  it('allows protected routes without Authorization when dev auth bypass is enabled', async () => {
    const app = createApp({
      creditService: new FakeCreditService(),
      userProvisioningService: new FakeUserProvisioningService(),
      enableDevAuthBypass: true,
      devAuthBypassClaims: {
        sub: user.supabaseId,
        email: user.email,
      },
    });

    const response = await app.request('/api/billing/balance');

    expect(response.status).toBe(200);
  });

  it('does not apply rate limiting when dev auth bypass is enabled', async () => {
    const app = createApp({
      creditService: new FakeCreditService(),
      userProvisioningService: new FakeUserProvisioningService(),
      rateLimitStore: new FixedRateLimitStore(),
      enableDevAuthBypass: true,
      devAuthBypassClaims: {
        sub: user.supabaseId,
        email: user.email,
      },
    });

    const firstResponse = await app.request('/api/billing/balance');
    const secondResponse = await app.request('/api/billing/balance');

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
  });
});

async function createToken(): Promise<string> {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.supabaseId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(jwtSecret));
}
