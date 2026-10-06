import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../src/app.js';
import { buildFencedStateReferenceKey, STATE_REFERENCE_COPY_V2_PROTOCOL } from '../../../src/domain/state/FencedStateReferenceKey.js';
import { computeStateReferenceFingerprint } from '../../../src/domain/state/StateReferenceFingerprint.js';
import type { ConfirmEntityStateReferenceInput, EntityStateReferenceContextCandidate } from '../../../src/domain/types/entityStateReference.js';
import type { GenerationJob } from '../../../src/domain/types/job.js';
import { env, parseEnv } from '../../../src/lib/env.js';
import { createFencedStateReferenceRuntime } from '../../../src/infrastructure/state/FencedStateReferenceRuntime.js';
import type { FencedImageReceipt, FencedStateReferenceRecoveryPort } from '../../../src/infrastructure/aws/FencedStateReferenceStorage.js';
import { PostgresEntityStateReferenceRepository } from '../../../src/repositories/EntityStateReferenceRepository.js';
import { PostgresGenerationJobRepository } from '../../../src/repositories/GenerationJobRepository.js';
import type { FencedStateReferenceAttempt, FencedStateReferenceRepository } from '../../../src/repositories/FencedStateReferenceRepository.js';
import { createStateReferenceCandidateToken } from '../../../src/services/entity/ReferenceCandidateToken.js';

afterEach(() => vi.restoreAllMocks());

function fixture(withRecovery: boolean) {
  const userId = '11111111-1111-4111-8111-111111111111';
  const entityId = '22222222-2222-4222-8222-222222222222';
  const stateId = '33333333-3333-4333-8333-333333333333';
  const jobId = '44444444-4444-4444-8444-444444444444';
  const attemptToken = '55555555-5555-4555-8555-555555555555';
  const stateRevision = '2026-10-01T00:00:00.000Z';
  const candidateS3Key = `session/${userId}/entities/${entityId}/${jobId}-1.png`;
  const context: EntityStateReferenceContextCandidate = {
    entityId, workId: '66666666-6666-4666-8666-666666666666', entityOwnerUserId: userId,
    entityType: 'character', entityName: 'Local test', entityFreeDescription: '', entityStructuredFields: {},
    entityPromptSupplement: null, entityStatus: 'ready', stateId, stateName: 'Variant', stateDescription: 'Local fixture',
    stateRevision, baseReference: { refId: 'base', s3Key: `saved/${userId}/entities/${entityId}/base.png`, storageOwnerUserId: userId },
    referenceImage: null,
  };
  const fingerprint = computeStateReferenceFingerprint({ entityId, stateId, name: 'Variant', description: 'Local fixture', baseRefId: 'base' });
  const job: GenerationJob = {
    id: jobId, userId, organizationId: null, status: 'completed',
    params: { target: 'entity_state', entity_id: entityId, entity_state_id: stateId, base_primary_ref_id: 'base',
      state_input_fingerprint: fingerprint, state_revision: stateRevision, image_model: 'gpt-image-2' },
    result: { candidates: [{ ref_id: `${jobId}-1`, s3_key: candidateS3Key }], created_at: stateRevision },
    jobType: 'entity_generate', generationMode: null, creditCost: 1, sqsMessageId: null,
    openaiRequestId: null, errorMessage: null, retryCount: 0, createdAt: new Date(stateRevision),
    startedAt: null, completedAt: new Date(stateRevision), expiresAt: null, cancelRequestedAt: null,
    cancelRequestedBy: null, cancelledAt: null, commitStartedAt: null,
  };
  vi.spyOn(PostgresEntityStateReferenceRepository.prototype, 'findContextByIdAndUserId').mockResolvedValue(context);
  vi.spyOn(PostgresGenerationJobRepository.prototype, 'findByIdAndUserId').mockResolvedValue(job);
  const legacyConfirmation = vi.spyOn(PostgresEntityStateReferenceRepository.prototype, 'confirmReference');
  const s3Key = buildFencedStateReferenceKey({ ownerUserId: userId, entityId, attemptToken, mimeType: 'image/png' });
  const receipt: FencedImageReceipt = { kind: 'image', protocol: STATE_REFERENCE_COPY_V2_PROTOCOL, attemptToken, s3Key,
    digest: 'a'.repeat(64), mimeType: 'image/png', sizeBytes: 10, eTag: '"synthetic-image"' };
  const input: ConfirmEntityStateReferenceInput = { userId, organizationId: null, entityId, stateId, jobId,
    candidateS3Key, expectedStateRevision: stateRevision,
    descriptor: { refId: `${jobId}-1`, s3Key, storageOwnerUserId: userId, imageModel: 'gpt-image-2',
      baseRefId: 'base', createdAt: stateRevision, inputFingerprint: fingerprint } };
  const attempt: FencedStateReferenceAttempt = { input,
    intent: { ...receipt, ownerUserId: userId, entityId, sourceRevision: { eTag: '"source"' } },
    state: 'unresolved', dispatchStartedAt: stateRevision, imageReceipt: null, erasureReceipt: null,
    fencingReason: null, deletionProcessingToken: null };
  const repository = {
    findActiveAttempt: vi.fn(async () => attempt),
    findPendingAttemptForRecovery: vi.fn(async () => null),
    confirmObservedImage: vi.fn(async () => ({ entityId, stateId, stateRevision, referenceImage: input.descriptor })),
  } as unknown as FencedStateReferenceRepository;
  const recovery: FencedStateReferenceRecoveryPort = { observe: vi.fn(async () => receipt), fenceAndErase: vi.fn() };
  const imageCreator = { loadSource: vi.fn(), createImage: vi.fn() };
  const runtime = createFencedStateReferenceRuntime(parseEnv({}), { query: vi.fn(), transaction: vi.fn() }, {
    repository, ...(withRecovery && { storage: { imageCreator, recovery } }),
  });
  const secret = 'synthetic-local-reference-token-secret';
  const previousSecret = env.REFERENCE_CANDIDATE_TOKEN_SECRET;
  env.REFERENCE_CANDIDATE_TOKEN_SECRET = secret;
  const app = createApp({ enableDevAuthBypass: true, devAuthBypassClaims: { sub: userId, email: 'synthetic@example.invalid' },
    fencedStateReferenceRuntime: runtime,
    userProvisioningService: { provisionFromSupabaseClaims: async () => ({ user: {
      id: userId, supabaseId: userId, email: 'synthetic@example.invalid', displayName: null, planCode: 'free' as const,
    }, isNewUser: false }) },
  });
  const token = createStateReferenceCandidateToken({ userId, organizationId: null, entityId, stateId, jobId, s3Key: candidateS3Key }, { secret });
  return { app, runtime, repository, recovery, imageCreator, legacyConfirmation,
    async confirm(extra: Record<string, unknown> = {}): Promise<Response> {
      try {
        return await app.request(`/api/entities/${entityId}/states/${stateId}/reference/confirm`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ candidate_token: token, expected_state_revision: stateRevision, ...extra }),
        });
      } finally { env.REFERENCE_CANDIDATE_TOKEN_SECRET = previousSecret; }
    },
  };
}

describe('fenced state reference app wiring', () => {
  it('the existing authenticated confirm route reaches injected recovery with admission OFF and preserves its response contract', async () => {
    const f = fixture(true);
    const response = await f.confirm();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ entity_id: expect.any(String), state_id: expect.any(String),
      state_revision: expect.any(String), reference_image: { ref_id: expect.any(String), image_model: 'gpt-image-2' } });
    expect(f.recovery.observe).toHaveBeenCalledOnce();
    expect(f.repository.confirmObservedImage).toHaveBeenCalledOnce();
    expect(f.imageCreator.loadSource).not.toHaveBeenCalled();
    expect(f.imageCreator.createImage).not.toHaveBeenCalled();
    expect(f.legacyConfirmation).not.toHaveBeenCalled();
  });

  it('an existing v2 row with no configured recovery fails closed without invoking the legacy copy', async () => {
    const f = fixture(false);
    const response = await f.confirm();
    expect(response.status).toBe(409);
    expect(f.legacyConfirmation).not.toHaveBeenCalled();
    expect(f.repository.confirmObservedImage).not.toHaveBeenCalled();
  });

  it('HTTP fields cannot grant storage attestation or admission capabilities', async () => {
    const f = fixture(false);
    const response = await f.confirm({ admissionEnabled: true, storageContractAttested: true });
    expect(response.status).not.toBe(200);
    expect(f.legacyConfirmation).not.toHaveBeenCalled();
    expect(f.imageCreator.createImage).not.toHaveBeenCalled();
  });
});
