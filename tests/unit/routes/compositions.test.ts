import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import type { CompositionGalleryItem } from '../../../src/domain/types/composition.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type {
  CompositionGalleryQuery,
  CompositionGalleryServicePort,
} from '../../../src/services/composition/CompositionGalleryService.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../src/services/credit/CreditService.js';
import { compositionsResponseSchema } from '../../../packages/api-contract/src/mobileApiSchemas.js';

const jwtSecret = 'unit-test-secret';
const user: AuthenticatedUser = {
  id: 'user-1',
  supabaseId: 'supabase-user-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};
const now = new Date('2026-04-22T00:00:00.000Z');

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

class FakeCompositionGalleryService implements CompositionGalleryServicePort {
  public lastQuery: CompositionGalleryQuery | null = null;

  public async listCompositions(query: CompositionGalleryQuery): Promise<CompositionGalleryItem[]> {
    this.lastQuery = query;
    return [buildComposition({ category: query.category ?? 'battle', entityCount: query.entityCount ?? 1 })];
  }
}

describe('composition routes', () => {
  it('JWTが正しい場合に構図ギャラリーを取得できる', async () => {
    const compositionGalleryService = new FakeCompositionGalleryService();
    const app = createTestApp(compositionGalleryService);
    const token = await createToken();

    const response = await app.request('/api/compositions?category=battle&entity_count=2&tag=action', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    expect(compositionGalleryService.lastQuery).toMatchObject({
      category: 'battle',
      entityCount: 2,
      tag: 'action',
      limit: 100,
    });
    const payload = (await response.json()) as Record<string, unknown>;
    expect(compositionsResponseSchema.safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({
      compositions: [
        {
          id: 'battle_single_001',
          category: 'battle',
          entity_count: 2,
          preview_cdn_url: 'https://img.lyra.app/composition/battle_single_001.png',
          composition_prompt: 'single character, full body, battle stance',
        },
      ],
    });
    const compositions = payload.compositions as Array<Record<string, unknown>>;
    expect(compositions[0]).not.toHaveProperty('preview_s3_key');
  });

  it('entity_countが0の場合にVALIDATION_ERRORになる', async () => {
    const app = createTestApp(new FakeCompositionGalleryService());
    const token = await createToken();

    const response = await app.request('/api/compositions?entity_count=0', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(422);
  });

  it('Authorizationヘッダーがない場合に401になる', async () => {
    const app = createTestApp(new FakeCompositionGalleryService());

    const response = await app.request('/api/compositions');

    expect(response.status).toBe(401);
  });
});

function createTestApp(
  compositionGalleryService: CompositionGalleryServicePort,
): ReturnType<typeof createApp> {
  return createApp({
    compositionGalleryService,
    creditService: new FakeCreditService(),
    userProvisioningService: new FakeUserProvisioningService(),
    jwtSecret,
  });
}

function buildComposition(overrides: Partial<CompositionGalleryItem> = {}): CompositionGalleryItem {
  return {
    id: 'battle_single_001',
    name: 'Battle Single',
    category: 'battle',
    entityCount: 1,
    previewS3Key: 'composition/battle_single_001.png',
    previewCdnUrl: 'https://img.lyra.app/composition/battle_single_001.png',
    compositionPrompt: 'single character, full body, battle stance',
    shotType: 'full_body',
    angle: 'front',
    tags: ['battle', 'action'],
    createdAt: now,
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
