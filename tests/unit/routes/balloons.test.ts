import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { Balloon } from '../../../src/domain/types/balloon.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../src/services/credit/CreditService.js';
import type { BalloonServicePort } from '../../../src/services/page/BalloonService.js';

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
    return { monthlyCredits: 0, purchasedCredits: 0, totalCredits: 0, monthlyExpiresAt: null };
  }

  public async grantSignupBonus(_userId: string): Promise<CreditBalanceSnapshot> {
    return this.getBalance(_userId);
  }

  public async consumeCredits(_params: ConsumeCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance(_params.userId);
  }

  public async refundCredits(_params: RefundCreditsParams): Promise<CreditBalanceSnapshot> {
    return this.getBalance(_params.userId);
  }
}

class FakeBalloonService implements BalloonServicePort {
  public async createBalloon(_userId: string, pageId: string): Promise<Balloon> {
    return buildBalloon({ id: 'balloon-1', pageId });
  }

  public async listBalloons(_userId: string, pageId: string): Promise<Balloon[]> {
    return [buildBalloon({ id: 'balloon-1', pageId })];
  }

  public async updateBalloon(_userId: string, balloonId: string): Promise<Balloon> {
    return buildBalloon({ id: balloonId, text: '更新後' });
  }

  public async deleteBalloon(_userId: string, _balloonId: string): Promise<void> {}
}

describe('balloon routes', () => {
  it('JWT が正しければ Balloon を作成できる', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request('/api/pages/33333333-3333-4333-8333-333333333333/balloons', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        balloon_type: 'speech',
        text: 'こんにちは',
        position: {
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.2,
        },
        tail: {
          base_x: 0.2,
          base_y: 0.3,
          tip_x: 0.4,
          tip_y: 0.5,
        },
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: 'balloon-1',
      page_id: '33333333-3333-4333-8333-333333333333',
      tail: {
        base_x: 0.2,
        base_y: 0.3,
        tip_x: 0.4,
        tip_y: 0.5,
      },
    });
  });

  it('一覧取得で balloons を返す', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request('/api/pages/33333333-3333-4333-8333-333333333333/balloons', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      balloons: [
        {
          id: 'balloon-1',
          page_id: '33333333-3333-4333-8333-333333333333',
        },
      ],
    });
  });

  it('不正な UUID は 422 になる', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request('/api/balloons/not-a-uuid', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: '更新後',
      }),
    });

    expect(response.status).toBe(422);
  });

  it('認証なしなら 401 になる', async () => {
    const app = createTestApp();

    const response = await app.request('/api/pages/33333333-3333-4333-8333-333333333333/balloons');

    expect(response.status).toBe(401);
  });

  it('DELETE は 204 を返す', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request('/api/balloons/11111111-1111-4111-8111-111111111111', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(204);
  });
});

function createTestApp(): ReturnType<typeof createApp> {
  return createApp({
    balloonService: new FakeBalloonService(),
    creditService: new FakeCreditService(),
    userProvisioningService: new FakeUserProvisioningService(),
    jwtSecret,
  });
}

function buildBalloon(overrides: Partial<Balloon> = {}): Balloon {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    pageId: '33333333-3333-4333-8333-333333333333',
    speakerEntityId: null,
    balloonType: 'speech',
    writingMode: 'vertical',
    text: 'こんにちは',
    position: {
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.2,
    },
    tail: {
      baseX: 0.2,
      baseY: 0.3,
      tipX: 0.4,
      tipY: 0.5,
    },
    fontSize: 18,
    fontFamily: 'manga_gothic',
    panelOrderReference: 1,
    zIndex: 10,
    ...overrides,
  };
}

async function createToken(): Promise<string> {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.supabaseId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(jwtSecret));
}
