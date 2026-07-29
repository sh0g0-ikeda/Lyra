import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  entitiesResponseSchema,
  entityImportResponseSchema,
  entityReferenceGenerationAvailabilitySchema,
  entityReferenceSetSchema,
  entitySchema,
  jobAcceptedSchema,
} from '../../../packages/api-contract/src/mobileApiSchemas.js';
import { createApp } from '../../../src/app.js';
import { REQUEST_BODY_LIMITS } from '../../../src/routes/requestBody.js';
import { env } from '../../../src/lib/env.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { EntityReferenceSet } from '../../../src/domain/types/entityReference.js';
import type { AuthenticatedUser, SupabaseJwtClaims } from '../../../src/domain/types/user.js';
import type { Entity, EntityServicePort } from '../../../src/services/entity/EntityService.js';
import type {
  ConfirmEntityReferencesRequest,
  EntityReferenceServicePort,
} from '../../../src/services/entity/EntityReferenceService.js';
import type {
  EntityReferenceImageExportServicePort,
  ExportedEntityReferenceImage,
} from '../../../src/services/entity/EntityReferenceImageExportService.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../src/services/credit/CreditService.js';
import { createReferenceCandidateToken } from '../../../src/services/entity/ReferenceCandidateToken.js';

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
  public lastUpdateInput: Parameters<EntityServicePort['updateEntity']>[2] | null = null;
  public listEntitiesPageRequest: { limit: number; cursor: { sort: string | number; id: string } | null } | null = null;
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

  public async listEntitiesPage(
    userId: string,
    requestedWorkId: string,
    request: { limit: number; cursor: { sort: string | number; id: string } | null },
  ): Promise<{ items: Entity[]; nextCursor: string | null }> {
    this.listEntitiesPageRequest = request;
    return {
      items: await this.listEntities(userId, requestedWorkId),
      nextCursor: 'eyJ2IjoxLCJrIjoiZW50aXRpZXMiLCJzb3J0IjoiMjAyNi0wNC0yMlQwMDowMDowMC4wMDBaIiwiaWQiOiIyMjIyMjIyMi0yMjIyLTQyMjItODIyMi0yMjIyMjIyMjIyMjIifQ',
    };
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
    this.lastUpdateInput = input;
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

class InvalidEntityResponseService extends FakeEntityService {
  public override async getEntity(userId: string, requestedEntityId: string): Promise<Entity> {
    const entity = await super.getEntity(userId, requestedEntityId);
    return {
      ...entity,
      name: 42 as unknown as string,
    };
  }
}

class FakeEntityReferenceService implements EntityReferenceServicePort {
  public generationEnabled = true;
  public lastImportRequest: Record<string, unknown> | null = null;
  public lastConfirmRequest: ConfirmEntityReferencesRequest | null = null;
  public lastGenerateReferenceRequest: { userId: string; entityId: string; sourceS3Key?: string | null } | null = null;

  public isReferenceGenerationEnabled(): boolean {
    return this.generationEnabled;
  }

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

  public async importUploadedImage(
    userId: string,
    input: {
      entityType: 'character' | 'nonhuman' | 'object';
      imageData: Buffer;
      mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
      tmpImageS3Key: string;
      tmpImageCdnUrl: string;
    },
  ): Promise<{
    suggestedFields: Record<string, unknown>;
    promptSupplement: string;
    tmpImageS3Key: string;
    tmpImageCdnUrl: string;
  }> {
    this.lastImportRequest = {
      userId,
      entityType: input.entityType,
      uploadedImageBytes: input.imageData.length,
      mimeType: input.mimeType,
    };

    return {
      suggestedFields: { art_style: 'anime' },
      promptSupplement: 'anime heroine, full body, military uniform',
      tmpImageS3Key: input.tmpImageS3Key,
      tmpImageCdnUrl: input.tmpImageCdnUrl,
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

class FakeEntityReferenceImageExportService implements EntityReferenceImageExportServicePort {
  public lastReferenceRequest: { userId: string; entityId: string; refId: string } | null = null;
  public lastCandidateRequest: { userId: string; entityId: string; s3Key: string } | null = null;

  public async exportReferenceImage(
    userId: string,
    requestedEntityId: string,
    refId: string,
  ): Promise<ExportedEntityReferenceImage> {
    this.lastReferenceRequest = { userId, entityId: requestedEntityId, refId };

    return {
      imageData: Buffer.from('reference-image'),
      mimeType: 'image/png',
    };
  }

  public async exportCandidateImage(
    userId: string,
    requestedEntityId: string,
    s3Key: string,
  ): Promise<ExportedEntityReferenceImage> {
    this.lastCandidateRequest = { userId, entityId: requestedEntityId, s3Key };

    return {
      imageData: Buffer.from('reference-image'),
      mimeType: 'image/png',
    };
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
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      id: entityId,
      work_id: workId,
      entity_type: 'character',
      name: 'Mizuki',
      prompt_supplement: 'anime heroine',
      status: 'draft',
    });
    expect(payload).not.toHaveProperty('user_id');
    expect(entitySchema.parse(payload)).toMatchObject(payload);
  });

  it('entity read responses do not expose internal user ids', async () => {
    const app = createTestApp();
    const token = await createToken();
    const authHeaders = {
      Authorization: `Bearer ${token}`,
    };

    const listResponse = await app.request(`/api/works/${workId}/entities`, {
      headers: authHeaders,
    });
    const getResponse = await app.request(`/api/entities/${entityId}`, {
      headers: authHeaders,
    });

    expect(listResponse.status).toBe(200);
    expect(getResponse.status).toBe(200);

    const rawListPayload = await listResponse.json();
    expect(rawListPayload).not.toHaveProperty('next_cursor');
    const listPayload = entitiesResponseSchema.parse(rawListPayload);
    const rawGetPayload = await getResponse.json();
    const getPayload = entitySchema.parse(rawGetPayload);

    expect(listPayload.entities[0]).not.toHaveProperty('user_id');
    expect(getPayload).not.toHaveProperty('user_id');
  });

  it('未知のキー付き create body は 422 になる', async () => {
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

  it('import-image は suggested_fields と候補トークンを返す', async () => {
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
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      suggested_fields: { art_style: 'anime' },
      prompt_supplement: 'anime heroine, full body, military uniform',
    });
    expect(typeof payload.tmp_image_token).toBe('string');
    expect(payload).not.toHaveProperty('tmp_image_s3_key');
    expect(entityImportResponseSchema.parse(payload)).toMatchObject(payload);
    expect(referenceService.lastImportRequest).toMatchObject({
      userId: user.id,
      entityType: 'character',
    });
  });

  it('import-image uses the generation rate limit bucket', async () => {
    const app = createTestApp();
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
    expect(response.headers.get('x-ratelimit-limit')).toBe('10');
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

  it('reference generation availability はサーバー設定を返す', async () => {
    const referenceService = new FakeEntityReferenceService();
    referenceService.generationEnabled = false;
    const app = createTestApp(referenceService);
    const token = await createToken();

    const response = await app.request('/api/entities/reference-generation-availability', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(entityReferenceGenerationAvailabilitySchema.parse(payload)).toEqual({ enabled: false });
  });

  it('returns a bounded entity page only when limit is supplied', async () => {
    const entityService = new FakeEntityService();
    const app = createTestApp(new FakeEntityReferenceService(), new FakeEntityReferenceImageExportService(), entityService);
    const token = await createToken();

    const response = await app.request(`/api/works/${workId}/entities?limit=2`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ entities: [expect.any(Object)], next_cursor: expect.any(String) });
    expect(entityService.listEntitiesPageRequest).toEqual({ limit: 2, cursor: null });
  });

  it('rejects invalid entity page limits and cursors before the service call', async () => {
    const entityService = new FakeEntityService();
    const app = createTestApp(new FakeEntityReferenceService(), new FakeEntityReferenceImageExportService(), entityService);
    const token = await createToken();
    const headers = { Authorization: `Bearer ${token}` };
    const workCursor = 'eyJ2IjoxLCJrIjoid29ya3MiLCJzb3J0IjoiMjAyNi0wNC0yMlQwMDowMDowMC4wMDBaIiwiaWQiOiIxMTExMTExMS0xMTExLTQxMTEtODExMS0xMTExMTExMTExMTEifQ';

    for (const query of ['?limit=0', '?limit=101', '?limit=1.5', '?cursor=bad', `?cursor=${workCursor}`, `?limit=1&cursor=${workCursor}`, `?limit=1&cursor=${'a'.repeat(1025)}`]) {
      const response = await app.request(`/api/works/${workId}/entities${query}`, { headers });
      expect(response.status).toBe(422);
    }
    expect(entityService.listEntitiesPageRequest).toBeNull();
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
    const payload = await response.json();
    expect(jobAcceptedSchema.parse(payload)).toEqual({
      job_id: '33333333-3333-4333-8333-333333333333',
    });
  });

  it('generate-reference は source_s3_key を後方互換で受ける', async () => {
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
      source: 'upload',
    });
    expect(referenceImages[0]).not.toHaveProperty('s3_key');
    expect(referenceImages[0]).not.toHaveProperty('cdn_url');
    expect(entityReferenceSetSchema.parse(payload)).toMatchObject(payload);
    expect(referenceService.lastConfirmRequest).toEqual({
      selectedS3Keys: ['tmp/user-1/entities/imports/source.png'],
      primaryS3Key: undefined,
      promptSupplement: 'anime heroine',
    });
  });

  it('confirm は候補トークンを内部S3キーへ解決して reference_set を返す', async () => {
    const referenceService = new FakeEntityReferenceService();
    const app = createTestApp(referenceService);
    const token = await createToken();
    const candidateToken = createReferenceCandidateToken({
      userId: user.id,
      entityId,
      s3Key: 'tmp/user-1/entities/imports/source.png',
    }, {
      secret: env.REFERENCE_CANDIDATE_TOKEN_SECRET
        ?? env.SUPABASE_JWT_SECRET
        ?? env.STRIPE_WEBHOOK_SECRET
        ?? 'development-reference-candidate-token-secret',
    });

    const response = await app.request(`/api/entities/${entityId}/reference/confirm`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        selected_candidate_tokens: [candidateToken],
        primary_candidate_token: candidateToken,
        prompt_supplement: 'anime heroine',
      }),
    });

    expect(response.status).toBe(200);
    expect(referenceService.lastConfirmRequest).toEqual({
      selectedS3Keys: ['tmp/user-1/entities/imports/source.png'],
      primaryS3Key: 'tmp/user-1/entities/imports/source.png',
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
    const payload = await response.json();
    expect(entityReferenceSetSchema.parse(payload)).toMatchObject({
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
  it('entity update は expected_updated_at を必須として service へ渡す', async () => {
    const entityService = new FakeEntityService();
    const app = createTestApp(new FakeEntityReferenceService(), new FakeEntityReferenceImageExportService(), entityService);
    const token = await createToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    const revision = '2026-04-22T00:00:00.000Z';

    const missingRevision = await app.request(`/api/entities/${entityId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ name: 'Ren' }),
    });
    expect(missingRevision.status).toBe(422);

    const response = await app.request(`/api/entities/${entityId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ name: 'Ren', expected_updated_at: revision }),
    });
    expect(response.status).toBe(200);
    expect(entitySchema.parse(await response.json())).toMatchObject({ id: entityId, name: 'Ren' });
    expect(entityService.lastUpdateInput?.expectedUpdatedAt).toBe(revision);
  });
  it('entity response が canonical schema に違反する場合は fail-closed になる', async () => {
    const app = createTestApp(
      new FakeEntityReferenceService(),
      new FakeEntityReferenceImageExportService(),
      new InvalidEntityResponseService(),
    );
    const token = await createToken();

    const response = await app.request(`/api/entities/${entityId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(500);
  });
  it('reference image export returns an authenticated image', async () => {
    const exportService = new FakeEntityReferenceImageExportService();
    const app = createTestApp(new FakeEntityReferenceService(), exportService);
    const token = await createToken();

    const response = await app.request(`/api/entities/${entityId}/reference/ref-1/image`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.text()).toBe('reference-image');
    expect(exportService.lastReferenceRequest).toEqual({
      userId: user.id,
      entityId,
      refId: 'ref-1',
    });
  });

  it('reference candidate image export returns an authenticated image', async () => {
    const exportService = new FakeEntityReferenceImageExportService();
    const app = createTestApp(new FakeEntityReferenceService(), exportService);
    const token = await createToken();
    const s3Key = 'tmp/user-1/entities/imports/source.png';
    const candidateToken = createReferenceCandidateToken({
      userId: user.id,
      entityId,
      s3Key,
    }, {
      secret: env.REFERENCE_CANDIDATE_TOKEN_SECRET
        ?? env.SUPABASE_JWT_SECRET
        ?? env.STRIPE_WEBHOOK_SECRET
        ?? 'development-reference-candidate-token-secret',
    });

    const response = await app.request(
      `/api/entities/${entityId}/reference-candidate-image?candidate_token=${encodeURIComponent(candidateToken)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.text()).toBe('reference-image');
    expect(exportService.lastCandidateRequest).toEqual({
      userId: user.id,
      entityId,
      s3Key,
    });
  });
});

function createTestApp(
  entityReferenceService: EntityReferenceServicePort = new FakeEntityReferenceService(),
  entityReferenceImageExportService: EntityReferenceImageExportServicePort = new FakeEntityReferenceImageExportService(),
  entityService: EntityServicePort = new FakeEntityService(),
): ReturnType<typeof createApp> {
  return createApp({
    creditService: new FakeCreditService(),
    entityReferenceService,
    entityReferenceImageExportService,
    entityService,
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
