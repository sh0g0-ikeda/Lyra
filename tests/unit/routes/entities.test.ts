import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { NotFoundError, ResourceStaleError } from '../../../src/domain/errors/index.js';
import { createApp } from '../../../src/app.js';
import { REQUEST_BODY_LIMITS } from '../../../src/routes/requestBody.js';
import { env } from '../../../src/lib/env.js';
import { decodeEntityListCursor } from '../../../src/domain/pagination.js';
import type { CreditBalanceSnapshot } from '../../../src/domain/types/credit.js';
import type { EntityReferenceSet } from '../../../src/domain/types/entityReference.js';
import type { ConfirmedEntityStateReference } from '../../../src/domain/types/entityStateReference.js';
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
  EntityListCursor,
  EntityListPage,
} from '../../../src/repositories/EntityRepository.js';
import type {
  ProvisionedUser,
  UserProvisioningPort,
} from '../../../src/services/auth/UserProvisioningService.js';
import type {
  ConsumeCreditsParams,
  CreditServicePort,
  RefundCreditsParams,
} from '../../../src/services/credit/CreditService.js';
import {
  createDraftReferenceCandidateToken,
  createReferenceCandidateToken,
  createStateReferenceCandidateToken,
  parseDraftReferenceCandidateToken,
  parseReferenceCandidateToken,
} from '../../../src/services/entity/ReferenceCandidateToken.js';
import type { EntityStateReferenceServicePort } from '../../../src/services/entity/EntityStateReferenceService.js';

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
const referenceTokenOptions = {
  secret: env.REFERENCE_CANDIDATE_TOKEN_SECRET
    ?? env.SUPABASE_JWT_SECRET
    ?? env.STRIPE_WEBHOOK_SECRET
    ?? 'development-reference-candidate-token-secret',
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
  public lastUpdate: Parameters<EntityServicePort['updateEntity']>[2] | null = null;
  public entityPage: EntityListPage = { entities: [], nextCursor: null };
  public pageCalls: Array<{
    userId: string;
    workId: string;
    limit: number;
    cursor: EntityListCursor | null;
    organizationId: string | null;
  }> = [];

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
    input: { limit: number; cursor: EntityListCursor | null },
    organizationId: string | null = null,
  ): Promise<EntityListPage> {
    this.pageCalls.push({
      userId,
      workId: requestedWorkId,
      ...input,
      organizationId,
    });
    return this.entityPage;
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
    this.lastUpdate = input;
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

  public async importUploadedImage(
    userId: string,
    input: {
      entityType: 'character' | 'nonhuman' | 'object';
      imageData: Buffer;
      mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
      tmpImageS3Key: string;
      tmpImageCdnUrl: string;
    },
  ): Promise<{
    suggestedFields: Record<string, unknown>;
    promptSupplement: string;
    tmpImageS3Key: string;
    tmpImageCdnUrl: string;
  }> {
    this.lastImportRequest = { userId, ...input };
    return {
      suggestedFields: { art_style: 'anime' },
      promptSupplement: 'uploaded image',
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

class FakeEntityStateReferenceService implements EntityStateReferenceServicePort {
  public enqueueInput: Record<string, unknown> | null = null;
  public confirmInput: Record<string, unknown> | null = null;
  public candidateReadInput: Record<string, unknown> | null = null;

  public async enqueueReferenceGeneration(
    userId: string,
    requestedEntityId: string,
    requestedStateId: string,
    organizationId: string | null = null,
  ): Promise<{ jobId: string; stateRevision: string }> {
    this.enqueueInput = { userId, entityId: requestedEntityId, stateId: requestedStateId, organizationId };
    return {
      jobId: '44444444-4444-4444-8444-444444444444',
      stateRevision: now.toISOString(),
    };
  }

  public async confirmReference(
    userId: string,
    requestedEntityId: string,
    requestedStateId: string,
    input: { jobId: string; candidateS3Key: string; expectedStateRevision: string },
    organizationId: string | null = null,
  ): Promise<ConfirmedEntityStateReference> {
    this.confirmInput = { userId, entityId: requestedEntityId, stateId: requestedStateId, organizationId, ...input };
    return {
      entityId: requestedEntityId,
      stateId: requestedStateId,
      stateRevision: '2026-04-22T00:00:00.001Z',
      referenceImage: {
        refId: `${input.jobId}-1`,
        s3Key: `saved/${userId}/entities/${requestedEntityId}/states/${requestedStateId}/${input.jobId}-1.png`,
        storageOwnerUserId: userId,
        imageModel: 'gpt-image-2',
        baseRefId: 'base-ref-1',
        createdAt: '2026-04-22T00:00:01.000Z',
        inputFingerprint: 'a'.repeat(64),
      },
    };
  }

  public async exportReferenceImage(): Promise<ExportedEntityReferenceImage> {
    return { imageData: Buffer.from('state-reference-image'), mimeType: 'image/png' };
  }

  public async exportCandidateImage(
    userId: string, entityId: string, stateId: string,
    input: { jobId: string; candidateS3Key: string; expectedStateRevision: string },
    organizationId: string | null = null,
  ): Promise<ExportedEntityReferenceImage> {
    this.candidateReadInput = { userId, entityId, stateId, ...input, organizationId };
    return { imageData: Buffer.from('state-candidate-image'), mimeType: 'image/png' };
  }
}

describe('entity routes', () => {
  it('状態専用署名候補だけをno-storeで読め、別stateやraw keyを拒否する', async () => {
    const service = new FakeEntityStateReferenceService();
    const app = createTestApp(undefined,undefined,undefined,service);
    const token = await createToken();
    const stateId = '33333333-3333-4333-8333-333333333333';
    const jobId = '44444444-4444-4444-8444-444444444444';
    const signed = createStateReferenceCandidateToken({userId:user.id,organizationId:null,entityId,stateId,jobId,
      s3Key:`session/${user.id}/entities/${entityId}/${jobId}-1.png`}, {
      secret:env.REFERENCE_CANDIDATE_TOKEN_SECRET ?? env.SUPABASE_JWT_SECRET ?? env.STRIPE_WEBHOOK_SECRET ?? 'development-reference-candidate-token-secret',
    });
    const query = new URLSearchParams({candidate_token:signed,expected_state_revision:now.toISOString()});
    const response = await app.request(`/api/entities/${entityId}/states/${stateId}/reference-candidate-image?${query}`, {
      headers:{Authorization:`Bearer ${token}`},
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.text()).toBe('state-candidate-image');
    expect(service.candidateReadInput).toMatchObject({stateId,jobId,expectedStateRevision:now.toISOString()});
    service.candidateReadInput=null;
    const wrong=await app.request(`/api/entities/${entityId}/states/77777777-7777-4777-8777-777777777777/reference-candidate-image?${query}`, {headers:{Authorization:`Bearer ${token}`}});
    expect(wrong.status).toBe(422);
    expect(service.candidateReadInput).toBeNull();
    query.set('s3_key','saved/foreign/private.png');
    expect((await app.request(`/api/entities/${entityId}/states/${stateId}/reference-candidate-image?${query}`,{headers:{Authorization:`Bearer ${token}`}})).status).toBe(422);
    expect(service.candidateReadInput).toBeNull();
  });

  it('状態reference previewを空bodyで受け付けjobとrevisionだけを返す', async () => {
    const stateReferences = new FakeEntityStateReferenceService();
    const app = createTestApp(undefined, undefined, undefined, stateReferences);
    const token = await createToken();
    const stateId = '33333333-3333-4333-8333-333333333333';

    const response = await app.request(`/api/entities/${entityId}/states/${stateId}/generate-reference`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      job_id: '44444444-4444-4444-8444-444444444444',
      state_revision: now.toISOString(),
    });
    expect(stateReferences.enqueueInput).toMatchObject({ entityId, stateId, userId: user.id });
  });

  it('状態候補tokenをjob/stateに束縛してconfirmし内部storage情報を返さない', async () => {
    const stateReferences = new FakeEntityStateReferenceService();
    const app = createTestApp(undefined, undefined, undefined, stateReferences);
    const token = await createToken();
    const stateId = '33333333-3333-4333-8333-333333333333';
    const jobId = '44444444-4444-4444-8444-444444444444';
    const candidateS3Key = `session/${user.id}/entities/${entityId}/${jobId}-1.png`;
    const candidateToken = createStateReferenceCandidateToken({
      userId: user.id,
      organizationId: null,
      entityId,
      stateId,
      jobId,
      s3Key: candidateS3Key,
    }, {
      secret: env.REFERENCE_CANDIDATE_TOKEN_SECRET
        ?? env.SUPABASE_JWT_SECRET
        ?? env.STRIPE_WEBHOOK_SECRET
        ?? 'development-reference-candidate-token-secret',
    });

    const response = await app.request(`/api/entities/${entityId}/states/${stateId}/reference/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidate_token: candidateToken,
        expected_state_revision: now.toISOString(),
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as Record<string, unknown>;
    expect(JSON.stringify(payload)).not.toContain('s3_key');
    expect(JSON.stringify(payload)).not.toContain('storage_owner_user_id');
    expect(stateReferences.confirmInput).toMatchObject({ jobId, candidateS3Key, stateId });
  });
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

    const listPayload = (await listResponse.json()) as { entities: Array<Record<string, unknown>> };
    const getPayload = (await getResponse.json()) as Record<string, unknown>;

    expect(listPayload.entities[0]).not.toHaveProperty('user_id');
    expect(listPayload).not.toHaveProperty('next_cursor');
    expect(getPayload).not.toHaveProperty('user_id');
  });

  it('Entity一覧をopaque cursorでpage取得する', async () => {
    const entityService = new FakeEntityService();
    const nextCursor: EntityListCursor = {
      createdAt: now,
      id: entityId,
    };
    entityService.entityPage = {
      entities: await entityService.listEntities(user.id, workId),
      nextCursor,
    };
    const app = createTestApp(
      new FakeEntityReferenceService(),
      new FakeEntityReferenceImageExportService(),
      entityService,
    );
    const token = await createToken();
    const headers = { Authorization: `Bearer ${token}` };

    const first = await app.request(
      `/api/works/${workId}/entities?limit=40`,
      { headers },
    );
    const firstPayload = (await first.json()) as { next_cursor: string };
    const second = await app.request(
      `/api/works/${workId}/entities?limit=10&cursor=${encodeURIComponent(firstPayload.next_cursor)}`,
      { headers },
    );

    expect(first.status).toBe(200);
    expect(decodeEntityListCursor(firstPayload.next_cursor)).toEqual(nextCursor);
    expect(second.status).toBe(200);
    expect(entityService.pageCalls).toEqual([
      {
        userId: user.id,
        workId,
        limit: 40,
        cursor: null,
        organizationId: null,
      },
      {
        userId: user.id,
        workId,
        limit: 10,
        cursor: nextCursor,
        organizationId: null,
      },
    ]);
  });

  it('Entity一覧の不正limit・cursorを422にする', async () => {
    const app = createTestApp();
    const token = await createToken();
    const headers = { Authorization: `Bearer ${token}` };

    const responses = await Promise.all([
      app.request(`/api/works/${workId}/entities?limit=0`, { headers }),
      app.request(`/api/works/${workId}/entities?limit=101`, { headers }),
      app.request(`/api/works/${workId}/entities?limit=1.5`, { headers }),
      app.request(`/api/works/${workId}/entities?cursor=opaque`, { headers }),
      app.request(`/api/works/${workId}/entities?limit=10&cursor=invalid`, { headers }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      422, 422, 422, 422, 422,
    ]);
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
    expect(parseDraftReferenceCandidateToken(payload.tmp_image_token as string, {
      userId: user.id,
      organizationId: null,
    }, referenceTokenOptions)).toMatchObject({
      entityType: 'character',
      s3Key: 'tmp/user-1/entities/imports/source.png',
    });
    expect(referenceService.lastImportRequest).toMatchObject({
      userId: user.id,
      entityType: 'character',
    });
  });

  it('既存entity指定importはownership確認後に従来のentity-bound候補を返す', async () => {
    const referenceService = new FakeEntityReferenceService();
    const entityService = new FakeEntityService();
    const app = createTestApp(referenceService, undefined, entityService);
    const token = await createToken();

    const response = await app.request('/api/entities/import-image', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_type: 'character',
        entity_id: entityId,
        image_base64: 'data:image/png;base64,YWJj',
      }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as { tmp_image_token: string };
    expect(parseReferenceCandidateToken(payload.tmp_image_token, {
      userId: user.id,
      entityId,
    }, referenceTokenOptions)).toBe('tmp/user-1/entities/imports/source.png');
    expect(referenceService.lastImportRequest).not.toBeNull();
  });

  it('既存entityの種類を未保存で変更してimportする場合も従来のv1候補を返す', async () => {
    const referenceService = new FakeEntityReferenceService();
    const app = createTestApp(referenceService);
    const token = await createToken();
    const response = await app.request('/api/entities/import-image', {
      method: 'POST', headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
      body: JSON.stringify({entity_type: 'object', entity_id: entityId, image_base64: 'data:image/png;base64,YWJj'}),
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as {tmp_image_token: string};
    expect(parseReferenceCandidateToken(payload.tmp_image_token, {userId: user.id, entityId}, referenceTokenOptions)).toBe('tmp/user-1/entities/imports/source.png');
    expect(referenceService.lastImportRequest).toMatchObject({userId: user.id, entityType: 'object'});
  });

  it.each(['import', 'bind'] as const)('%sでowned targetが存在しない場合は404となり画像処理を呼ばない', async (operation) => {
    const referenceService = new FakeEntityReferenceService();
    const entityService = new FakeEntityService();
    const ownershipCalls: Array<{userId: string; entityId: string; organizationId: string | null}> = [];
    entityService.getEntity = async (requestedUserId, requestedEntityId, organizationId: string | null = null): Promise<never> => {
      ownershipCalls.push({userId: requestedUserId, entityId: requestedEntityId, organizationId});
      throw new NotFoundError('Entity not found');
    };
    const app = createTestApp(referenceService, undefined, entityService);
    const token = await createToken();
    const candidateToken = createDraftReferenceCandidateToken({
      userId: user.id, organizationId: null, entityType: 'character',
      s3Key: 'tmp/user-1/entities/imports/source.png',
    }, referenceTokenOptions);
    const path = operation === 'import' ? '/api/entities/import-image' : '/api/entities/' + entityId + '/reference-candidate/bind';
    const body = operation === 'import'
      ? {entity_id: entityId, entity_type: 'character', image_base64: 'data:image/png;base64,YWJj'}
      : {candidate_token: candidateToken};
    const response = await app.request(path, {
      method: 'POST', headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(404);
    expect(ownershipCalls).toEqual([{userId: user.id, entityId, organizationId: null}]);
    expect(referenceService.lastImportRequest).toBeNull();
    expect(referenceService.lastGenerateReferenceRequest).toBeNull();
  });

  it('新規entity候補bindは未認証の場合に401となりEntityや画像へアクセスしない', async () => {
    const referenceService = new FakeEntityReferenceService();
    const entityService = new FakeEntityService();
    let ownershipCalls = 0;
    entityService.getEntity = async (): Promise<never> => {ownershipCalls += 1; throw new NotFoundError();};
    const app = createTestApp(referenceService, undefined, entityService);
    const response = await app.request('/api/entities/' + entityId + '/reference-candidate/bind', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({candidate_token: 'unsigned-token'}),
    });
    expect(response.status).toBe(401);
    expect(ownershipCalls).toBe(0);
    expect(referenceService.lastImportRequest).toBeNull();
    expect(referenceService.lastGenerateReferenceRequest).toBeNull();
  });

  it('新規entity候補bindは上限超過tokenを422としてEntityや画像へアクセスしない', async () => {
    const referenceService = new FakeEntityReferenceService();
    const entityService = new FakeEntityService();
    let ownershipCalls = 0;
    entityService.getEntity = async (): Promise<never> => {ownershipCalls += 1; throw new NotFoundError();};
    const app = createTestApp(referenceService, undefined, entityService);
    const token = await createToken();
    const response = await app.request('/api/entities/' + entityId + '/reference-candidate/bind', {
      method: 'POST', headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json'},
      body: JSON.stringify({candidate_token: 'x'.repeat(4097)}),
    });
    expect(response.status).toBe(422);
    expect(ownershipCalls).toBe(0);
    expect(referenceService.lastImportRequest).toBeNull();
    expect(referenceService.lastGenerateReferenceRequest).toBeNull();
  });

  it('新規entity候補はowned entityへbindしても期限とraw keyを公開しない', async () => {
    const referenceService = new FakeEntityReferenceService();
    const app = createTestApp(referenceService);
    const token = await createToken();
    const draftToken = createDraftReferenceCandidateToken({
      userId: user.id,
      organizationId: null,
      entityType: 'character',
      s3Key: 'tmp/user-1/entities/imports/source.png',
    }, referenceTokenOptions);

    const response = await app.request(`/api/entities/${entityId}/reference-candidate/bind`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_token: draftToken }),
    });

    expect(response.status).toBe(200);
    const payload = await response.json() as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['candidate_token']);
    expect(parseReferenceCandidateToken(payload.candidate_token as string, {
      userId: user.id,
      entityId,
    }, referenceTokenOptions)).toBe('tmp/user-1/entities/imports/source.png');
    expect(referenceService.lastGenerateReferenceRequest).toBeNull();
  });

  it.each([
    ['別organization', 'character', '33333333-3333-4333-8333-333333333333', 'tmp/user-1/entities/imports/source.png'],
    ['別entity type', 'object', null, 'tmp/user-1/entities/imports/source.png'],
    ['許可外source key', 'character', null, 'tmp/other-user/entities/imports/source.png'],
  ] as const)('新規entity候補bindは%sをpaid service前に拒否する', async (_label, entityType, organizationId, s3Key) => {
    const referenceService = new FakeEntityReferenceService();
    const app = createTestApp(referenceService);
    const token = await createToken();
    const draftToken = createDraftReferenceCandidateToken({
      userId: user.id,
      organizationId,
      entityType,
      s3Key,
    }, referenceTokenOptions);

    const response = await app.request(`/api/entities/${entityId}/reference-candidate/bind`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_token: draftToken }),
    });

    expect(response.status).toBe(422);
    expect(referenceService.lastImportRequest).toBeNull();
    expect(referenceService.lastGenerateReferenceRequest).toBeNull();
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

  it('Entity reference成功JSONを返す5 endpointは契約外Service値を500にする', async () => {
    const referenceService = new FakeEntityReferenceService();
    const invalidReferenceSet = buildReferenceSet({ entityId: '' });
    referenceService.getReferenceSet = async () => invalidReferenceSet;
    referenceService.confirmReferences = async () => invalidReferenceSet;
    referenceService.deleteReference = async () => invalidReferenceSet;
    referenceService.importImage = async () => ({
      suggestedFields: [] as unknown as Record<string, unknown>,
      promptSupplement: '',
      tmpImageS3Key: 'tmp/user-1/entities/imports/source.png',
      tmpImageCdnUrl: 'https://cdn.lyra.test/tmp/user-1/entities/imports/source.png',
    });
    referenceService.enqueueReferenceGeneration = async () => ({ jobId: '' });
    const app = createTestApp(referenceService);
    const token = await createToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const responses = await Promise.all([
      app.request(`/api/entities/${entityId}/reference-set`, { headers }),
      app.request('/api/entities/import-image', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          entity_type: 'character',
          image_base64: 'data:image/png;base64,YWJj',
        }),
      }),
      app.request(`/api/entities/${entityId}/generate-reference`, {
        method: 'POST',
        headers,
      }),
      app.request(`/api/entities/${entityId}/reference/confirm`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          selected_s3_keys: ['tmp/user-1/entities/imports/source.png'],
        }),
      }),
      app.request(`/api/entities/${entityId}/reference/ref-1`, {
        method: 'DELETE',
        headers,
      }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'CONFIGURATION_ERROR' },
      });
    }
  });

  it('Entity成功JSONを返す4 endpointは契約外Service値を500にする', async () => {
    const entityService = new FakeEntityService();
    const invalidEntity = await entityService.getEntity(user.id, '');
    entityService.createEntity = async () => invalidEntity;
    entityService.listEntities = async () => [invalidEntity];
    entityService.getEntity = async () => invalidEntity;
    entityService.updateEntity = async () => invalidEntity;
    const app = createTestApp(
      new FakeEntityReferenceService(),
      new FakeEntityReferenceImageExportService(),
      entityService,
    );
    const token = await createToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const responses = await Promise.all([
      app.request(`/api/works/${workId}/entities`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ entity_type: 'character', name: 'ミヅキ' }),
      }),
      app.request(`/api/works/${workId}/entities`, { headers }),
      app.request(`/api/entities/${entityId}`, { headers }),
      app.request(`/api/entities/${entityId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ name: '更新' }),
      }),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'CONFIGURATION_ERROR' },
      });
    }
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

describe('entity shipped timestamp contract', () => {
  it('PUTはtimestampをServiceへ渡しstaleを409のまま返す', async () => {
    const service = new FakeEntityService();
    const app = createTestApp(undefined,undefined,service);
    const token = await createToken();
    const request = () => app.request(`/api/entities/${entityId}`, {
      method:'PUT', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({name:'updated',expected_updated_at:'2026-10-01T12:00:00.123Z'}),
    });
    expect((await request()).status).toBe(200);
    expect(service.lastUpdate?.expectedUpdatedAt).toBe('2026-10-01T12:00:00.123Z');
    service.updateEntity = async (): Promise<never> => { throw new ResourceStaleError(); };
    const stale = await request();
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({error:{code:'RESOURCE_STALE'}});
  });
});

function createTestApp(
  entityReferenceService: EntityReferenceServicePort | undefined = new FakeEntityReferenceService(),
  entityReferenceImageExportService: EntityReferenceImageExportServicePort | undefined = new FakeEntityReferenceImageExportService(),
  entityService: EntityServicePort | undefined = new FakeEntityService(),
  entityStateReferenceService: EntityStateReferenceServicePort = new FakeEntityStateReferenceService(),
): ReturnType<typeof createApp> {
  return createApp({
    creditService: new FakeCreditService(),
    entityReferenceService: entityReferenceService ?? new FakeEntityReferenceService(),
    entityReferenceImageExportService: entityReferenceImageExportService ?? new FakeEntityReferenceImageExportService(),
    entityService: entityService ?? new FakeEntityService(),
    entityStateReferenceService,
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
