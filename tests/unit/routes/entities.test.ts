import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../src/app.js';
import { REQUEST_BODY_LIMITS } from '../../../src/routes/requestBody.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { EntityReferenceSet } from '../../../src/domain/types/entityReference.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type { Entity, EntityServicePort } from '../../../src/services/entity/EntityService.js';
import type {
  ConfirmEntityReferencesRequest,
  EntityReferenceServicePort,
} from '../../../src/services/entity/EntityReferenceService.js';
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
      promptSupplement: input.promptSupplement ?? null,
      structuredFields: input.structuredFields,
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
        name: 'Mizuki',
        freeDescription: 'Black long hair swordswoman',
        promptSupplement: 'anime swordswoman, black long hair, military uniform',
        structuredFields: { art_style: 'anime' },
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
      name: 'Mizuki',
      freeDescription: null,
      promptSupplement: null,
      structuredFields: {},
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
      name: input.name ?? 'Mizuki',
      freeDescription: input.freeDescription ?? null,
      promptSupplement: input.promptSupplement ?? null,
      structuredFields: input.structuredFields ?? {},
      speechProfile: input.speechProfile ?? {},
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
  }

  public async deleteEntity(_userId: string, _requestedEntityId: string): Promise<void> {}
}

class FakeEntityReferenceService implements EntityReferenceServicePort {
  public lastImportRequest: Record<string, unknown> | null = null;
  public lastConfirmRequest: ConfirmEntityReferencesRequest | null = null;
  public lastGenerateReferenceRequest: { userId: string; entityId: string; sourceS3Key?: string | null } | null = null;

  public async getReferenceSet(): Promise<EntityReferenceSet> {
    return buildReferenceSet();
  }

  public async importImage(
    userId: string,
    input: { entityType: 'character' | 'nonhuman' | 'object'; imageBase64: string },
  ): Promise<{
    suggestedFields: Record<string, unknown>;
    promptSupplement: string;
    tmpImageS3Key: string;
    tmpImageCdnUrl: string;
  }> {
    this.lastImportRequest = { userId, ...input };

    return {
      suggestedFields: { art_style: 'anime' },
      promptSupplement: 'anime heroine, full body, military uniform',
      tmpImageS3Key: 'tmp/user-1/entities/imports/source.png',
      tmpImageCdnUrl: 'https://cdn.lyra.test/tmp/user-1/entities/imports/source.png',
    };
  }

  public async enqueueReferenceGeneration(
    userId: string,
    entityId: string,
    input?: { sourceS3Key?: string | null },
  ): Promise<{ jobId: string }> {
    this.lastGenerateReferenceRequest = {
      userId,
      entityId,
      sourceS3Key: input?.sourceS3Key,
    };

    return {
      jobId: '33333333-3333-4333-8333-333333333333',
    };
  }

  public async confirmReferences(
    _userId: string,
    _entityId: string,
    input: ConfirmEntityReferencesRequest,
  ): Promise<EntityReferenceSet> {
    this.lastConfirmRequest = input;

    return buildReferenceSet();
  }

  public async deleteReference(
    _userId: string,
    _entityId: string,
    _refId: string,
  ): Promise<EntityReferenceSet> {
    return buildReferenceSet({ images: [], primaryRefId: null, status: 'empty' });
  }
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
        name: 'Mizuki',
        prompt_supplement: 'anime heroine',
        structured_fields: {
          gender_expression: 'female',
          face_shape: 'oval',
          eyebrow_shape: 'soft_arch',
          nose_shape: 'small',
          mouth_shape: 'soft',
          art_style: 'anime',
          hair: {
            color: 'black',
            length: 'long',
            style: 'straight',
            arrangement: 'down',
          },
          eyes: {
            color: 'blue',
            shape: 'gentle',
          },
          clothing: {
            description: 'navy military jacket with gold trim',
          },
        },
      }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: entityId,
      work_id: workId,
      entity_type: 'character',
      name: 'Mizuki',
      prompt_supplement: 'anime heroine',
      status: 'draft',
    });
  });

  it('未知キー付きの create body は 422 になる', async () => {
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
        name: 'Sword',
        injected: true,
      }),
    });

    expect(response.status).toBe(422);
  });

  it('import-image は suggested_fields と tmp key を返す', async () => {
    const referenceService = new FakeEntityReferenceService();
    const app = createTestApp(referenceService);
    const token = await createToken();

    const response = await app.request('/api/entities/import-image', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        entity_type: 'character',
        image_base64: 'data:image/png;base64,YWJj',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      suggested_fields: { art_style: 'anime' },
      prompt_supplement: 'anime heroine, full body, military uniform',
      tmp_image_s3_key: 'tmp/user-1/entities/imports/source.png',
      tmp_image_cdn_url: 'https://cdn.lyra.test/tmp/user-1/entities/imports/source.png',
    });
    expect(referenceService.lastImportRequest).toMatchObject({
      userId: user.id,
      entityType: 'character',
    });
  });

  it('import-image は巨大な JSON body を service 呼び出し前に 413 にする', async () => {
    const referenceService = new FakeEntityReferenceService();
    const app = createTestApp(referenceService);
    const token = await createToken();

    const response = await app.request('/api/entities/import-image', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': String(REQUEST_BODY_LIMITS.ENTITY_IMPORT_JSON_BYTES + 1),
      },
      body: '{}',
    });

    expect(response.status).toBe(413);
    expect(referenceService.lastImportRequest).toBeNull();
  });

  it('generate-reference は 202 と job_id を返す', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request(`/api/entities/${entityId}/generate-reference`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      job_id: '33333333-3333-4333-8333-333333333333',
    });
  });

  it('generate-reference は source_s3_key を受けて full-body 候補化に渡す', async () => {
    const referenceService = new FakeEntityReferenceService();
    const app = createTestApp(referenceService);
    const token = await createToken();

    const response = await app.request(`/api/entities/${entityId}/generate-reference`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_s3_key: 'tmp/user-1/entities/imports/source.png',
      }),
    });

    expect(response.status).toBe(202);
    expect(referenceService.lastGenerateReferenceRequest).toEqual({
      userId: user.id,
      entityId,
      sourceS3Key: 'tmp/user-1/entities/imports/source.png',
    });
  });

  it('generate-reference は巨大な optional JSON body を 413 にする', async () => {
    const referenceService = new FakeEntityReferenceService();
    const app = createTestApp(referenceService);
    const token = await createToken();

    const response = await app.request(`/api/entities/${entityId}/generate-reference`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': String(REQUEST_BODY_LIMITS.SMALL_JSON_BYTES + 1),
      },
      body: '{}',
    });

    expect(response.status).toBe(413);
    expect(referenceService.lastGenerateReferenceRequest).toBeNull();
  });

  it('confirm は reference_set を返す', async () => {
    const referenceService = new FakeEntityReferenceService();
    const app = createTestApp(referenceService);
    const token = await createToken();

    const response = await app.request(`/api/entities/${entityId}/reference/confirm`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        selected_s3_keys: ['tmp/user-1/entities/imports/source.png'],
        prompt_supplement: 'anime heroine',
      }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      entity_id: entityId,
      primary_ref_id: 'ref-1',
      status: 'partial',
    });
    const referenceImages = payload.reference_images as Array<Record<string, unknown>>;
    expect(referenceImages[0]).toMatchObject({
      ref_id: 'ref-1',
      cdn_url: 'https://cdn.lyra.test/saved/user-1/entities/entity-1/ref-1.png',
    });
    expect(referenceImages[0]).not.toHaveProperty('s3_key');
    expect(referenceService.lastConfirmRequest).toEqual({
      selectedS3Keys: ['tmp/user-1/entities/imports/source.png'],
      primaryS3Key: undefined,
      promptSupplement: 'anime heroine',
    });
  });

  it('confirm の duplicate key は 422 になる', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request(`/api/entities/${entityId}/reference/confirm`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        selected_s3_keys: ['tmp/user-1/entities/imports/source.png', 'tmp/user-1/entities/imports/source.png'],
      }),
    });

    expect(response.status).toBe(422);
  });

  it('delete reference は更新後の reference_set を返す', async () => {
    const app = createTestApp();
    const token = await createToken();

    const response = await app.request(`/api/entities/${entityId}/reference/ref-1`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      entity_id: entityId,
      primary_ref_id: null,
      status: 'empty',
    });
  });

  it('Authorization ヘッダーがない場合は 401 になる', async () => {
    const app = createTestApp();

    const response = await app.request(`/api/entities/${entityId}`);

    expect(response.status).toBe(401);
  });
});

function createTestApp(
  entityReferenceService: EntityReferenceServicePort = new FakeEntityReferenceService(),
): ReturnType<typeof createApp> {
  return createApp({
    creditService: new FakeCreditService(),
    entityReferenceService,
    entityService: new FakeEntityService(),
    enableDevAuthBypass: false,
    userProvisioningService: new FakeUserProvisioningService(),
    jwtSecret,
  });
}

function buildReferenceSet(overrides: Partial<EntityReferenceSet> = {}): EntityReferenceSet {
  return {
    entityId,
    primaryRefId: 'ref-1',
    status: 'partial',
    updatedAt: now,
    images: [
      {
        refId: 'ref-1',
        s3Key: 'saved/user-1/entities/entity-1/ref-1.png',
        cdnUrl: 'https://cdn.lyra.test/saved/user-1/entities/entity-1/ref-1.png',
        source: 'upload',
        createdAt: now.toISOString(),
      },
    ],
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
