import { describe, expect, it } from 'vitest';
import type { GenerationJob } from '../../../../src/domain/types/job.js';
import type {
  CreateGenerationJobInput,
  GenerationJobCancellationRepository,
  GenerationJobRepository,
} from '../../../../src/repositories/GenerationJobRepository.js';
import { JobService } from '../../../../src/services/job/JobService.js';

const now = new Date('2026-07-14T00:00:00.000Z');

class FakeCancellationRepository
  implements GenerationJobRepository, GenerationJobCancellationRepository
{
  public job: GenerationJob | null = null;
  public cancellationRequests: Array<{
    jobId: string;
    userId: string;
    organizationId: string | null;
  }> = [];

  public async create(_input: CreateGenerationJobInput): Promise<GenerationJob> {
    throw new Error('not used');
  }

  public async findByIdAndUserId(
    jobId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<GenerationJob | null> {
    return this.job?.id === jobId &&
      this.job.userId === userId &&
      (this.job.organizationId ?? null) === organizationId
      ? this.job
      : null;
  }

  public async requestCancellation(
    jobId: string,
    userId: string,
    organizationId: string | null = null,
  ): Promise<GenerationJob | null> {
    this.cancellationRequests.push({ jobId, userId, organizationId });
    if (
      this.job === null ||
      this.job.id !== jobId ||
      this.job.userId !== userId ||
      (this.job.organizationId ?? null) !== organizationId
    ) {
      return null;
    }

    const requestedAt = now;
    this.job = {
      ...this.job,
      cancelRequestedAt: requestedAt,
      cancelRequestedBy: userId,
      ...(this.job.status === 'queued'
        ? {
            status: 'cancelled' as const,
            cancelledAt: requestedAt,
            completedAt: requestedAt,
          }
        : {}),
    };
    return this.job;
  }

  public async findActivePageGenerationJob(): Promise<GenerationJob | null> {
    throw new Error('not used');
  }

  public async findActiveEntityGenerationJob(): Promise<GenerationJob | null> {
    throw new Error('not used');
  }

  public async countActiveGenerationJobsByUser(): Promise<number> {
    throw new Error('not used');
  }

  public async countActiveGenerationJobs(): Promise<number> {
    throw new Error('not used');
  }

  public async attachQueueMessageId(): Promise<boolean> {
    throw new Error('not used');
  }

  public async markFailed(): Promise<boolean> {
    throw new Error('not used');
  }

  public async prepareRetry(): Promise<boolean> {
    throw new Error('not used');
  }

  public async finalizeCancellation(): Promise<boolean> {
    throw new Error('not used');
  }
}

describe('JobService cancellation', () => {
  it('キュー待機中の話全体反映を停止すると即時に cancelled になる', async () => {
    const repository = new FakeCancellationRepository();
    repository.job = buildJob({ status: 'queued' });
    const service = new JobService(repository);

    const job = await service.cancelJob('user-1', 'job-1');

    expect(job.status).toBe('cancelled');
    expect(job.cancelRequestedAt).toEqual(now);
    expect(repository.cancellationRequests).toEqual([
      { jobId: 'job-1', userId: 'user-1', organizationId: null },
    ]);
  });

  it('処理中の話全体反映を停止すると停止要求を保存して処理中を維持する', async () => {
    const repository = new FakeCancellationRepository();
    repository.job = buildJob({ status: 'processing', startedAt: now });
    const service = new JobService(repository);

    const job = await service.cancelJob('user-1', 'job-1');

    expect(job.status).toBe('processing');
    expect(job.cancelRequestedAt).toEqual(now);
    expect(job.cancelledAt).toBeNull();
  });

  it('保存開始後の話全体反映は停止できない', async () => {
    const repository = new FakeCancellationRepository();
    repository.job = buildJob({
      status: 'processing',
      startedAt: now,
      commitStartedAt: now,
    });
    const service = new JobService(repository);

    await expect(service.cancelJob('user-1', 'job-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(repository.cancellationRequests).toEqual([]);
  });

  it('別ユーザーのジョブは存在を隠して停止できない', async () => {
    const repository = new FakeCancellationRepository();
    repository.job = buildJob({ userId: 'other-user' });
    const service = new JobService(repository);

    await expect(service.cancelJob('user-1', 'job-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(repository.cancellationRequests).toEqual([]);
  });

  it('停止済みジョブへの再停止は同じ結果を返す', async () => {
    const repository = new FakeCancellationRepository();
    repository.job = buildJob({
      status: 'cancelled',
      cancelRequestedAt: now,
      cancelRequestedBy: 'user-1',
      cancelledAt: now,
      completedAt: now,
    });
    const service = new JobService(repository);

    const job = await service.cancelJob('user-1', 'job-1');

    expect(job.status).toBe('cancelled');
    expect(repository.cancellationRequests).toEqual([]);
  });
  it('法人ジョブは同じ法人スコープを指定した場合だけ停止できる', async () => {
    const repository = new FakeCancellationRepository();
    repository.job = buildJob({
      organizationId: '11111111-1111-4111-8111-111111111111',
      status: 'queued',
    });
    const service = new JobService(repository);

    const job = await service.cancelJob(
      'user-1',
      'job-1',
      '11111111-1111-4111-8111-111111111111',
    );

    expect(job.status).toBe('cancelled');
    expect(repository.cancellationRequests).toEqual([
      {
        jobId: 'job-1',
        userId: 'user-1',
        organizationId: '11111111-1111-4111-8111-111111111111',
      },
    ]);
  });

  it.each(['page_generate', 'entity_generate', 'episode_page_skeleton'] as const)(
    'generic cancellation有効時は%sも停止できる',
    async (jobType) => {
      const repository = new FakeCancellationRepository();
      repository.job = buildJob({ jobType, status: 'queued' });
      const service = new JobService(
        repository,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        true,
      );

      const job = await service.cancelJob('user-1', 'job-1');

      expect(job.status).toBe('cancelled');
      expect(repository.cancellationRequests).toHaveLength(1);
    },
  );

  it('generic cancellation無効時はpage jobを変更せず拒否する', async () => {
    const repository = new FakeCancellationRepository();
    repository.job = buildJob({ jobType: 'page_generate', status: 'queued' });
    const service = new JobService(repository);

    await expect(service.cancelJob('user-1', 'job-1')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(repository.cancellationRequests).toEqual([]);
  });
});

function buildJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    organizationId: null,
    jobType: 'episode_story_autofill',
    status: 'queued',
    generationMode: null,
    creditCost: 0,
    params: { episode_id: 'episode-1', language: 'ja' },
    result: null,
    sqsMessageId: null,
    openaiRequestId: null,
    errorMessage: null,
    retryCount: 0,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    expiresAt: null,
    cancelRequestedAt: null,
    cancelRequestedBy: null,
    cancelledAt: null,
    commitStartedAt: null,
    ...overrides,
  };
}
