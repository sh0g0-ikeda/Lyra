import { describe, expect, it, vi } from 'vitest';
import { computeStateReferenceFingerprint } from '../../../../src/domain/state/StateReferenceFingerprint.js';
import type {
  ConfirmedEntityStateReference,
  ConfirmEntityStateReferenceInput,
  EntityStateReferenceContextCandidate,
} from '../../../../src/domain/types/entityStateReference.js';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type { EntityImageStoragePort } from '../../../../src/infrastructure/aws/S3EntityImageStorage.js';
import type { StoredImageLoaderPort } from '../../../../src/infrastructure/aws/S3StoredImageLoader.js';
import type { EntityStateReferenceRepository } from '../../../../src/repositories/EntityStateReferenceRepository.js';
import type {
  CreateGenerationJobInput,
  GenerationJobRepository,
} from '../../../../src/repositories/GenerationJobRepository.js';
import type { CreditServicePort } from '../../../../src/services/credit/CreditService.js';
import type { EntityGenerationQueuePort } from '../../../../src/services/entity/EntityGenerationQueue.js';
import { EntityStateReferenceService } from '../../../../src/services/entity/EntityStateReferenceService.js';
import type { OrganizationServicePort } from '../../../../src/services/organization/OrganizationService.js';

const userId = '00000000-0000-4000-8000-000000000001';
const ownerUserId = '00000000-0000-4000-8000-000000000002';
const organizationId = '00000000-0000-4000-8000-000000000003';
const entityId = '00000000-0000-4000-8000-000000000004';
const stateId = '00000000-0000-4000-8000-000000000005';
const jobId = '00000000-0000-4000-8000-000000000006';
const stateRevision = '2026-09-30T00:00:00.000Z';

describe('EntityStateReferenceService', () => {
  it('Hy4 primaryをstate baseに使う場合はjob作成と課金前に409を返す', async () => {
    const fixture = createFixture({ generationEnabled: true, baseImageModel: 'hy4-preview' });

    await expect(
      fixture.service.enqueueReferenceGeneration(userId, entityId, stateId, null),
    ).rejects.toMatchObject({ code: 'ENTITY_REFERENCE_MODEL_INCOMPATIBLE', statusCode: 409 });

    expect(fixture.jobs.create).not.toHaveBeenCalled();
    expect(fixture.credit.consumeCredits).not.toHaveBeenCalled();
  });

  it('feature OFFではjob作成と課金の前に409を返す', async () => {
    const fixture = createFixture({ generationEnabled: false });

    await expect(
      fixture.service.enqueueReferenceGeneration(userId, entityId, stateId, null),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(fixture.jobs.create).not.toHaveBeenCalled();
    expect(fixture.credit.consumeCredits).not.toHaveBeenCalled();
    expect(fixture.stateRepository.findCalls).toBe(0);
  });

  it('法人actorが作成者と異なってもstate入力をjobへ固定し1クレジットを課金する', async () => {
    const fixture = createFixture({ generationEnabled: true });

    const result = await fixture.service.enqueueReferenceGeneration(
      userId,
      entityId,
      stateId,
      organizationId,
    );
    expect(result).toEqual({ jobId: expect.any(String), stateRevision });

    expect(fixture.jobs.create).toHaveBeenCalledWith(expect.objectContaining({
      id: result.jobId,
      userId,
      organizationId,
      creditCost: 1,
      params: expect.objectContaining({
        target: 'entity_state',
        entity_state_id: stateId,
        state_revision: stateRevision,
        state_name: '外傷',
        state_description: '左頬に傷、服の右肩が破れている',
        base_primary_ref_id: 'base-ref-1',
        image_model: 'gpt-image-2',
      }),
    }));
    expect(fixture.organization.consumeCredits).toHaveBeenCalledWith(expect.objectContaining({
      userId,
      organizationId,
      cost: 1,
      jobId: result.jobId,
    }));
  });

  it('queue失敗時は作成済みjobをfailedにして1クレジットを返金する', async () => {
    const fixture = createFixture({ generationEnabled: true, queueError: new Error('queue failed') });

    await expect(
      fixture.service.enqueueReferenceGeneration(userId, entityId, stateId, null),
    ).rejects.toThrow('queue failed');

    const createdJobId = fixture.jobs.create.mock.calls[0]?.[0].id;
    expect(createdJobId).toEqual(expect.any(String));
    expect(fixture.jobs.markFailed).toHaveBeenCalledWith(
      createdJobId,
      'Failed to enqueue entity state reference generation job',
    );
    expect(fixture.credit.refundCredits).toHaveBeenCalledWith(expect.objectContaining({
      userId,
      amount: 1,
      jobId: createdJobId,
    }));
  });

  it('CDNがなくてもstate jobに属する候補だけを認証済み読取できる', async () => {
    const fixture = createFixture({ generationEnabled: false, completedJob: true });
    const key = `session/${userId}/entities/${entityId}/${jobId}-1.png`;
    const result = await fixture.service.exportCandidateImage(userId, entityId, stateId,
      { jobId, candidateS3Key:key, expectedStateRevision:stateRevision }, organizationId);
    expect(result.mimeType).toBe('image/png');
    expect(fixture.loader.loadByS3Key).toHaveBeenCalledWith(key);
    expect(fixture.credit.consumeCredits).not.toHaveBeenCalled();
  });

  it('別候補・古いrevision・別actorでは画像を読まない', async () => {
    for (const change of [
      { candidateS3Key:`session/${userId}/entities/${entityId}/${jobId}-2.png` },
      { expectedStateRevision:'2026-09-30T00:00:01.000Z' },
    ]) {
      const fixture = createFixture({generationEnabled:false,completedJob:true});
      await expect(fixture.service.exportCandidateImage(userId,entityId,stateId,{
        jobId,candidateS3Key:`session/${userId}/entities/${entityId}/${jobId}-1.png`,expectedStateRevision:stateRevision,...change,
      },organizationId)).rejects.toMatchObject({code:'CONFLICT'});
      expect(fixture.loader.loadByS3Key).not.toHaveBeenCalled();
    }
    const fixture = createFixture({generationEnabled:false,completedJob:true});
    await expect(fixture.service.exportCandidateImage(ownerUserId,entityId,stateId,{
      jobId,candidateS3Key:`session/${userId}/entities/${entityId}/${jobId}-1.png`,expectedStateRevision:stateRevision,
    },organizationId)).rejects.toMatchObject({code:'CONFLICT'});
    expect(fixture.loader.loadByS3Key).not.toHaveBeenCalled();
  });

  it('confirmはjob候補をstate saved keyへ昇格しstorage ownerを生成actorにする', async () => {
    const fixture = createFixture({ generationEnabled: false, completedJob: true });

    const result = await fixture.service.confirmReference(userId, entityId, stateId, {
      jobId,
      candidateS3Key: `session/${userId}/entities/${entityId}/${jobId}-1.png`,
      expectedStateRevision: stateRevision,
    }, organizationId);

    expect(fixture.storage.finalizeStateReferenceImage).toHaveBeenCalledWith(expect.objectContaining({
      userId,
      entityId,
      stateId,
      refId: `${jobId}-1`,
    }));
    expect(fixture.stateRepository.confirmed?.descriptor).toMatchObject({
      storageOwnerUserId: userId,
      baseRefId: 'base-ref-1',
      refId: `${jobId}-1`,
    });
    expect(result.referenceImage.storageOwnerUserId).toBe(userId);
  });

  it('状態専用storageがない場合は通常copyへfallbackせずintent前に拒否する', async () => {
    const fixture = createFixture({ generationEnabled: false, completedJob: true });
    Reflect.deleteProperty(fixture.storage, 'finalizeStateReferenceImage');
    const admission = vi.spyOn(fixture.stateRepository, 'confirmReference');
    await expect(fixture.service.confirmReference(userId, entityId, stateId, {
      jobId, candidateS3Key: `session/${userId}/entities/${entityId}/${jobId}-1.png`,
      expectedStateRevision: stateRevision,
    }, organizationId)).rejects.toMatchObject({ code: 'CONFIGURATION_ERROR' });
    expect(fixture.storage.finalizeReferenceImage).not.toHaveBeenCalled();
    expect(admission).not.toHaveBeenCalled();
  });

  it('repositoryのadmission拒否ではsaved画像をcopyしない', async () => {
    const fixture = createFixture({ generationEnabled: false, completedJob: true });
    vi.spyOn(fixture.stateRepository, 'confirmReference').mockRejectedValue(new Error('Account deletion has started'));

    await expect(fixture.service.confirmReference(userId, entityId, stateId, {
      jobId,
      candidateS3Key: `session/${userId}/entities/${entityId}/${jobId}-1.png`,
      expectedStateRevision: stateRevision,
    }, organizationId)).rejects.toThrow('Account deletion has started');

    expect(fixture.storage.finalizeStateReferenceImage).not.toHaveBeenCalled();
  });

  it('別jobの候補keyはstorage copy前に拒否する', async () => {
    const fixture = createFixture({ generationEnabled: false, completedJob: true });

    await expect(fixture.service.confirmReference(userId, entityId, stateId, {
      jobId,
      candidateS3Key: `session/${userId}/entities/${entityId}/other-job-1.png`,
      expectedStateRevision: stateRevision,
    }, organizationId)).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(fixture.storage.finalizeStateReferenceImage).not.toHaveBeenCalled();
    expect(fixture.stateRepository.confirmed).toBeNull();
  });
});

function createFixture(options: {
  generationEnabled: boolean;
  queueError?: Error;
  completedJob?: boolean;
  baseImageModel?: string;
}) {
  const context = buildContext();
  if (context.baseReference !== null && options.baseImageModel !== undefined) {
    context.baseReference.imageModel = options.baseImageModel;
    context.baseReference.providerModelId = options.baseImageModel;
    context.baseReference.provider = options.baseImageModel === 'hy4-preview' ? 'tencent' : 'openai';
  }
  const stateRepository = new FakeStateRepository(context);
  const create = vi.fn(async (input: CreateGenerationJobInput): Promise<GenerationJob> => ({
    ...buildJob(input.params, 'queued'),
    id: input.id ?? jobId,
    userId: input.userId,
    organizationId: input.organizationId ?? null,
    creditCost: input.creditCost,
  }));
  const completedJob = buildJob(buildStateJobParams(context), 'completed');
  const jobs = {
    create,
    findByIdAndUserId: vi.fn(async () => options.completedJob === true ? completedJob : null),
    findActiveEntityGenerationJob: vi.fn(async () => null),
    attachQueueMessageId: vi.fn(async () => true),
    markFailed: vi.fn(async () => true),
  };
  const credit = {
    consumeCredits: vi.fn(async () => ({ userId, monthlyCredits: 0, purchasedCredits: 9, totalCredits: 9 })),
    refundCredits: vi.fn(async () => ({ userId, monthlyCredits: 0, purchasedCredits: 10, totalCredits: 10 })),
  };
  const organization = {
    consumeCredits: vi.fn(async () => ({ organizationId, monthlyCredits: 0, purchasedCredits: 9, totalCredits: 9 })),
    refundCredits: vi.fn(async () => ({ organizationId, monthlyCredits: 0, purchasedCredits: 10, totalCredits: 10 })),
  };
  const storage = {
    storeImportedImage: vi.fn(),
    storeGeneratedCandidate: vi.fn(),
    finalizeReferenceImage: vi.fn(),
    finalizeStateReferenceImage: vi.fn(async (input: { refId: string }) => ({
      s3Key: `saved/${userId}/entities/${entityId}/states/${stateId}/${input.refId}.png`,
      cdnUrl: 'https://cdn.lyra.test/state.png',
    })),
  };
  const queue = {
    enqueue: vi.fn(async () => {
      if (options.queueError !== undefined) {
        throw options.queueError;
      }
      return { messageId: 'message-1' };
    }),
  };
  const loader = {
    loadByS3Key: vi.fn(async () => ({ imageData: Buffer.from('image'), mimeType: 'image/png' as const })),
  };
  return {
    loader,
    stateRepository,
    jobs,
    credit,
    organization,
    storage,
    service: new EntityStateReferenceService({
      stateRepository,
      generationJobRepository: jobs as unknown as GenerationJobRepository,
      creditService: credit as unknown as CreditServicePort,
      imageStorage: storage as unknown as EntityImageStoragePort,
      storedImageLoader: loader as StoredImageLoaderPort,
      generationQueue: queue as EntityGenerationQueuePort,
      imageModel: 'gpt-image-2',
      generationEnabled: options.generationEnabled,
      organizationService: organization as unknown as OrganizationServicePort,
    }),
  };
}

class FakeStateRepository implements EntityStateReferenceRepository {
  public findCalls = 0;
  public confirmed: ConfirmEntityStateReferenceInput | null = null;

  public constructor(private readonly context: EntityStateReferenceContextCandidate) {}

  public async findContextByIdAndUserId(): Promise<EntityStateReferenceContextCandidate> {
    this.findCalls += 1;
    return this.context;
  }

  public async confirmReference(input: ConfirmEntityStateReferenceInput, copyImage: () => Promise<void>): Promise<ConfirmedEntityStateReference> {
    await copyImage();
    this.confirmed = input;
    return {
      entityId: input.entityId,
      stateId: input.stateId,
      stateRevision: '2026-09-30T00:00:00.001Z',
      referenceImage: input.descriptor,
    };
  }
}

function buildContext(): EntityStateReferenceContextCandidate {
  return {
    entityId,
    workId: '00000000-0000-4000-8000-000000000007',
    entityOwnerUserId: ownerUserId,
    entityType: 'character',
    entityName: 'ユキ',
    entityFreeDescription: '高校生',
    entityStructuredFields: {},
    entityPromptSupplement: null,
    entityStatus: 'ready',
    stateId,
    stateName: '外傷',
    stateDescription: '左頬に傷、服の右肩が破れている',
    stateRevision,
    baseReference: {
      refId: 'base-ref-1',
      s3Key: `saved/${ownerUserId}/entities/${entityId}/base-ref-1.png`,
      storageOwnerUserId: ownerUserId,
    },
    referenceImage: null,
  };
}

function buildStateJobParams(context: EntityStateReferenceContextCandidate): Record<string, unknown> {
  if (context.stateName === null || context.stateDescription === null || context.baseReference === null) {
    throw new Error('invalid test context');
  }
  return {
    target: 'entity_state',
    entity_id: entityId,
    entity_type: 'character',
    previous_entity_status: 'ready',
    entity_state_id: stateId,
    base_primary_ref_id: context.baseReference.refId,
    state_input_fingerprint: computeStateReferenceFingerprint({
      entityId,
      stateId,
      name: context.stateName,
      description: context.stateDescription,
      baseRefId: context.baseReference.refId,
    }),
    state_revision: stateRevision,
    state_name: context.stateName,
    state_description: context.stateDescription,
    image_model: 'gpt-image-2',
    pricing_version: 'entity-state-reference-v1',
  };
}

function buildJob(params: Record<string, unknown>, status: GenerationJob['status']): GenerationJob {
  return {
    id: jobId,
    userId,
    organizationId,
    jobType: 'entity_generate',
    status,
    generationMode: null,
    creditCost: 1,
    params,
    result: status === 'completed'
      ? {
          candidates: [{
            ref_id: `${jobId}-1`,
            s3_key: `session/${userId}/entities/${entityId}/${jobId}-1.png`,
          }],
          created_at: '2026-09-30T00:00:01.000Z',
        }
      : null,
    sqsMessageId: null,
    openaiRequestId: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: new Date('2026-09-30T00:00:00.000Z'),
    startedAt: null,
    completedAt: status === 'completed' ? new Date('2026-09-30T00:00:01.000Z') : null,
    expiresAt: null,
    cancelRequestedAt: null,
    cancelRequestedBy: null,
    cancelledAt: null,
    commitStartedAt: null,
  };
}
