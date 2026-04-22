import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';
import type { ConsumeCreditsParams, CreditServicePort } from '../../../src/services/credit/CreditService.js';

const jwtSecret = 'unit-test-secret';
const testUser: AuthenticatedUser = {
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
        ...testUser,
        supabaseId: claims.sub,
        email: claims.email,
      },
      isNewUser: false,
    };
  }
}

class FakeCreditService implements CreditServicePort {
  public async getBalance(_userId: string): Promise<CreditBalanceSnapshot> {
    return {
      monthlyCredits: 25,
      purchasedCredits: 175,
      totalCredits: 200,
      monthlyExpiresAt: null,
    };
  }

  public async grantSignupBonus(_userId: string): Promise<CreditBalanceSnapshot> {
    return this.getBalance(_userId);
  }

  public async consumeCredits(_params: ConsumeCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance(_params.userId);
  }
}

describe('billing routes', () => {
  it('Authorizationヘッダーがない場合に401になる', async () => {
    const app = createApp({
      creditService: new FakeCreditService(),
      userProvisioningService: new FakeUserProvisioningService(),
      jwtSecret,
    });

    const response = await app.request('/api/billing/balance');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      },
    });
  });

  it('JWTが正しい場合にクレジット残高を返す', async () => {
    const app = createApp({
      creditService: new FakeCreditService(),
      userProvisioningService: new FakeUserProvisioningService(),
      jwtSecret,
    });
    const token = await createToken();

    const response = await app.request('/api/billing/balance', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      monthly_credits: 25,
      purchased_credits: 175,
      total_credits: 200,
      monthly_expires_at: null,
    });
  });
});

async function createToken(): Promise<string> {
  return new SignJWT({ email: testUser.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(testUser.supabaseId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(jwtSecret));
}
