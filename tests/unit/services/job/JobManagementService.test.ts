import { describe, expect, it, vi } from 'vitest';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type {
  GenerationJobCancellationRepository,
  GenerationJobRepository,
} from '../../../../src/repositories/GenerationJobRepository.js';
import { JobService } from '../../../../src/services/job/JobService.js';

const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';

describe('JobService management', () => {
  it('一覧取得では tenant scope と view_work 権限をリポジトリに渡す', async () => {
    const listForScope = vi.fn().mockResolvedValue({ jobs: [buildJob()], nextCursor: null });
    const service = new JobService(asJobRepository({ listForScope }));

    const result = await (service as unknown as {
      listJobs: (input: unknown) => Promise<unknown>;
    }).listJobs({
      userId,
      organizationId,
      limit: 25,
      cursor: null,
      statuses: ['queued'],
      jobTypes: ['page_generate'],
    });

    expect(result).toEqual({ jobs: [buildJob()], nextCursor: null });
    expect(listForScope).toHaveBeenCalledWith({
      userId,
      organizationId,
      capability: 'view_work',
      limit: 25,
      cursor: null,
      statuses: ['queued'],
      jobTypes: ['page_generate'],
    });
  });

  it('処理中ジョブの取消は安全な非対応理由を返す', async () => {
    const cancelForScope = vi.fn().mockResolvedValue({
      kind: 'requested',
      job: buildJob({
        status: 'processing',
        cancelRequestedAt: new Date('2026-07-25T00:05:00.000Z'),
        cancelRequestedBy: userId,
      }),
    });
    const findByIdForScope = vi.fn().mockResolvedValue(buildJob({ status: 'processing' }));
    const service = new JobService(asJobRepository({ cancelForScope, findByIdForScope }));

    await expect((service as unknown as {
      cancelJob: (userId: string, jobId: string, organizationId: string | null) => Promise<GenerationJob>;
    }).cancelJob(userId, jobId, organizationId)).resolves.toMatchObject({
      status: 'processing',
      cancelRequestedAt: new Date('2026-07-25T00:05:00.000Z'),
    });
    expect(cancelForScope).toHaveBeenCalledWith({
      userId,
      organizationId,
      capability: 'generate',
      jobId,
    });
  });

  it('完了済みジョブだけを論理非表示にする', async () => {
    const hideFromHistory = vi.fn().mockResolvedValue({ kind: 'active', job: buildJob({ status: 'queued' }) });
    const service = new JobService(asJobRepository({ hideFromHistory }));

    await expect(
      (service as unknown as {
        hideJobFromHistory: (userId: string, jobId: string, organizationId: string | null) => Promise<void>;
      }).hideJobFromHistory(userId, jobId, null),
    ).rejects.toMatchObject({
      code: 'JOB_HISTORY_HIDE_UNSUPPORTED',
      statusCode: 409,
    });
  });
});

function asJobRepository(
  repository: Partial<GenerationJobRepository & GenerationJobCancellationRepository>,
): GenerationJobRepository & Partial<GenerationJobCancellationRepository> {
  return repository as GenerationJobRepository & Partial<GenerationJobCancellationRepository>;
}

function buildJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: jobId,
    userId,
    organizationId: null,
    jobType: 'page_generate',
    status: 'queued',
    generationMode: 'standard',
    creditCost: 3,
    params: {},
    result: null,
    sqsMessageId: null,
    openaiRequestId: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: new Date('2026-07-25T00:00:00.000Z'),
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    ...overrides,
  };
}
