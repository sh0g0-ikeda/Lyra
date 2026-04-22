import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type { Entity, EntityServicePort } from '../../../src/services/entity/EntityService.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';
import type { ConsumeCreditsParams, CreditServicePort } from '../../../src/services/credit/CreditService.js';

const jwtSecret = 'unit-test-secret';
const user: AuthenticatedUser = {
  id: 'user-1',
  supabaseId: 'supabase-user-1',
  email: 'user@example.com',
  displayName: null,
  planCode: 'free',
};
const workId = '11111111-1111-4111-8111-111111111111';
const entityId = '22222222-2222-4222-8222-222222222222';
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
}

class FakeEntityService implements EntityServicePort {
  public async createEntity(
    userId: string,
    requestedWorkId: string,
    input: Parameters<EntityServicePort['createEntity']>[2],
  ): Promise<Entity> {
    return {
      id: entityId,
      workId: requestedWorkId,
      userId,
      entityType: input.entityType,
      name: input.name,
      freeDescription: input.freeDescription,
      structuredFields: input.structuredFields,
      promptSupplement: null,
      speechProfile: input.speechProfile,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
  }

  public async listEntities(_userId: string, requestedWorkId: string): Promise<Entity[]> {
    return [
      {
        id: entityId,
        workId: requestedWorkId,
        userId: user.id,
        entityType: 'character',
        name: '月華',
        freeDescription: '黒髪ロングの女性将校',
        structuredFields: { art_style: 'anime' },
        promptSupplement: null,
        speechProfile: {},
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      },
    ];
  }

  public async getEntity(_userId: string, requestedEntityId: string): Promise<Entity> {
    return {
      id: requestedEntityId,
      workId,
      userId: user.id,
      entityType: 'character',
      name: '月華',
      freeDescription: null,
      structuredFields: {},
      promptSupplement: null,
      speechProfile: {},
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
  }

  public async updateEntity(
    _userId: string,
    requestedEntityId: string,
    input: Parameters<EntityServicePort['updateEntity']>[2],
  ): Promise<Entity> {
    return {
      id: requestedEntityId,
      workId,
      userId: user.id,
      entityType: input.entityType ?? 'character',
      name: input.name ?? '月華',
      freeDescription: input.freeDescription ?? null,
      structuredFields: input.structuredFields ?? {},
      promptSupplement: null,
      speechProfile: input.speechProfile ?? {},
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
  }

  public async deleteEntity(_userId: string, _requestedEntityId: string): Promise<void> {}
}

describe('entity routes', () => {
  it('JWTが正しい場合にエンティティを作成できる', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request(`/api/works/${workId}/entities`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        entity_type: 'character',
        name: '月華',
        free_description: '黒髪ロングの女性将校',
        structured_fields: {
          art_style: 'anime',
        },
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: entityId,
      work_id: workId,
      entity_type: 'character',
      name: '月華',
      status: 'draft',
    });
  });

  it('名前が空の場合にVALIDATION_ERRORになる', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request(`/api/works/${workId}/entities`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        entity_type: 'object',
        name: '',
        structured_fields: {},
      }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
      },
    });
  });

  it('Authorizationヘッダーがない場合に401になる', async () => {
    const app = createTestApp();

    const response = await app.request(`/api/entities/${entityId}`);

    expect(response.status).toBe(401);
  });
});

function createTestApp(): ReturnType<typeof createApp> {
  return createApp({
    creditService: new FakeCreditService(),
    entityService: new FakeEntityService(),
    userProvisioningService: new FakeUserProvisioningService(),
    jwtSecret,
  });
}

async function createToken(): Promise<string> {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.supabaseId)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(jwtSecret));
}
