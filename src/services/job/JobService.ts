import { EPISODE_LONG_JOB_STALE_AFTER_MS } from '../../domain/constants/generation.js';
import {
  AppError,
  ConfigurationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../domain/errors/index.js';
import type { GenerationJob, GenerationJobStatus, GenerationJobType } from '../../domain/types/job.js';
import type {
  GenerationJobCancellationRepository,
  GenerationJobListCursor,
  GenerationJobRepository,
} from '../../repositories/GenerationJobRepository.js';
import {
  NoopEntityGenerationRecoveryService,
  type EntityGenerationRecoveryServicePort,
} from '../entity/EntityGenerationRecoveryService.js';
import {
  NoopPageGenerationRecoveryService,
  type PageGenerationRecoveryServicePort,
} from '../page/PageGenerationRecoveryService.js';
import {
  EPISODE_LONG_JOB_STALE_ERROR_MESSAGE,
  isStaleEpisodeLongJob,
} from '../story/EpisodeLongJobStalePolicy.js';

export interface JobServicePort {
  getJob(userId: string, jobId: string, organizationId?: string | null): Promise<GenerationJob>;
  listJobs?(input: ListJobsInput): Promise<GenerationJobListResponse>;
  cancelJob?(userId: string, jobId: string, organizationId: string | null): Promise<GenerationJob>;
  hideJobFromHistory?(userId: string, jobId: string, organizationId: string | null): Promise<void>;
}

export interface ListJobsInput {
  userId: string;
  organizationId: string | null;
  limit: number;
  cursor: string | null;
  statuses: readonly GenerationJobStatus[];
  jobTypes: readonly GenerationJobType[];
}

export interface GenerationJobListResponse {
  jobs: GenerationJob[];
  nextCursor: string | null;
}

export class JobService implements JobServicePort {
  public constructor(
    private readonly generationJobRepository: GenerationJobRepository & Partial<GenerationJobCancellationRepository>,
    private readonly pageGenerationRecoveryService: PageGenerationRecoveryServicePort = new NoopPageGenerationRecoveryService(),
    private readonly entityGenerationRecoveryService: EntityGenerationRecoveryServicePort = new NoopEntityGenerationRecoveryService(),
    private readonly episodeLongJobStaleAfterMs: number = EPISODE_LONG_JOB_STALE_AFTER_MS,
    private readonly now: () => number = () => Date.now(),
    private readonly cancellationEnabled = true,
  ) {}

  public async getJob(
    userId: string,
    jobId: string,
    organizationId: string | null = null,
  ): Promise<GenerationJob> {
    const job = await this.findJobForView(userId, jobId, organizationId);
    if (job === null) {
      throw new NotFoundError('Job not found');
    }

    if (job.status !== 'queued' && job.status !== 'processing') {
      return job;
    }

    const recovered = await this.recoverStaleActiveJob(userId, job);
    if (!recovered) {
      return job;
    }

    return (await this.findJobForView(userId, jobId, organizationId)) ?? job;
  }

  public async listJobs(input: ListJobsInput): Promise<GenerationJobListResponse> {
    if (this.generationJobRepository.listForScope === undefined) {
      throw new ConfigurationError('Generation job list repository is not configured');
    }

    const page = await this.generationJobRepository.listForScope({
      userId: input.userId,
      organizationId: input.organizationId,
      capability: 'view_work',
      limit: input.limit,
      cursor: decodeGenerationJobCursor(input.cursor),
      statuses: input.statuses,
      jobTypes: input.jobTypes,
    });
    return {
      jobs: page.jobs,
      nextCursor: page.nextCursor === null ? null : encodeGenerationJobCursor(page.nextCursor),
    };
  }

  public async cancelJob(
    userId: string,
    jobId: string,
    organizationId: string | null = null,
  ): Promise<GenerationJob> {
    const current = await this.findJobForView(userId, jobId, organizationId);
    if (current === null) {
      throw new NotFoundError('Job not found');
    }
    if (current.status === 'cancelled') {
      return current;
    }
    if (
      current.jobType === 'episode_story_autofill' &&
      !this.cancellationEnabled
    ) {
      throw new AppError(
        'JOB_CANCELLATION_DISABLED',
        'Job cancellation is temporarily unavailable.',
        409,
      );
    }
    if (current.commitStartedAt !== null && current.commitStartedAt !== undefined) {
      throw new ConflictError('This job is already saving its result and cannot be canceled');
    }

    if (this.generationJobRepository.cancelForScope === undefined) {
      if (this.generationJobRepository.requestCancellation === undefined) {
        throw new ConfigurationError('Generation job cancellation repository is not configured');
      }
      const requested = await this.generationJobRepository.requestCancellation(
        jobId,
        userId,
        organizationId,
      );
      if (requested !== null) {
        return requested;
      }
      const latest = await this.findJobForView(userId, jobId, organizationId);
      if (latest === null) {
        throw new NotFoundError('Job not found');
      }
      if (latest.status === 'cancelled') {
        return latest;
      }
      throw new ConflictError('This job is already saving its result or has finished');
    }

    const result = await this.generationJobRepository.cancelForScope({
      userId,
      organizationId,
      capability: 'generate',
      jobId,
    });
    if (result.kind === 'not_found') {
      throw new NotFoundError('Job not found');
    }
    if (result.kind === 'terminal') {
      if (result.job.status === 'cancelled') {
        return result.job;
      }
      throw new AppError(
        'JOB_CANCEL_NOT_QUEUED',
        'Only active jobs can be canceled.',
        409,
      );
    }
    return result.job;
  }

  public async hideJobFromHistory(
    userId: string,
    jobId: string,
    organizationId: string | null,
  ): Promise<void> {
    if (this.generationJobRepository.hideFromHistory === undefined) {
      throw new ConfigurationError('Generation job history repository is not configured');
    }

    const result = await this.generationJobRepository.hideFromHistory({
      userId,
      organizationId,
      capability: 'view_work',
      jobId,
    });
    if (result.kind === 'not_found') {
      throw new NotFoundError('Job not found');
    }
    if (result.kind === 'active') {
      throw new AppError(
        'JOB_HISTORY_HIDE_UNSUPPORTED',
        'Only completed, failed, or canceled jobs can be hidden.',
        409,
      );
    }
  }

  private async findJobForView(
    userId: string,
    jobId: string,
    organizationId: string | null,
  ): Promise<GenerationJob | null> {
    if (this.generationJobRepository.findByIdForScope === undefined) {
      return this.generationJobRepository.findByIdAndUserId(jobId, userId, organizationId);
    }
    return this.generationJobRepository.findByIdForScope({
      userId,
      organizationId,
      capability: 'view_work',
      jobId,
    });
  }

  private async recoverStaleActiveJob(userId: string, job: GenerationJob): Promise<boolean> {
    if (job.jobType === 'page_generate') {
      const pageId = readStringParam(job.params, 'page_id');
      if (pageId === null) {
        return false;
      }

      return (
        await this.pageGenerationRecoveryService.recoverStaleJobsForPage(
          userId,
          pageId,
          job.organizationId ?? null,
        )
      ) > 0;
    }

    if (job.jobType === 'episode_story_autofill' || job.jobType === 'episode_page_skeleton') {
      return this.recoverStaleEpisodeLongJob(job);
    }

    const entityId = readStringParam(job.params, 'entity_id');
    if (entityId === null) {
      return false;
    }

    return (
      await this.entityGenerationRecoveryService.recoverStaleJobsForEntity(
        userId,
        entityId,
        job.organizationId ?? null,
      )
    ) > 0;
  }

  private async recoverStaleEpisodeLongJob(job: GenerationJob): Promise<boolean> {
    if (!isStaleEpisodeLongJob(job, this.now(), this.episodeLongJobStaleAfterMs)) {
      return false;
    }

    if (
      (job.jobType === 'episode_story_autofill' || job.jobType === 'episode_page_skeleton') &&
      job.cancelRequestedAt !== null &&
      job.cancelRequestedAt !== undefined &&
      job.commitStartedAt === null
    ) {
      if (this.generationJobRepository.finalizeCancellationIfRequested !== undefined) {
        return this.generationJobRepository.finalizeCancellationIfRequested(job.id);
      }
      if (this.generationJobRepository.finalizeCancellation !== undefined) {
        return this.generationJobRepository.finalizeCancellation(job.id);
      }
      return false;
    }

    return this.generationJobRepository.markFailed(
      job.id,
      EPISODE_LONG_JOB_STALE_ERROR_MESSAGE,
    );
  }
}

function readStringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function decodeGenerationJobCursor(cursor: string | null): GenerationJobListCursor | null {
  if (cursor === null) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      Array.isArray(decoded) ||
      !('active_rank' in decoded) ||
      !('created_at' in decoded) ||
      !('id' in decoded)
    ) {
      throw new Error('Invalid cursor payload');
    }
    const cursorRecord = decoded as Record<string, unknown>;
    const createdAt = typeof cursorRecord.created_at === 'string'
      ? new Date(cursorRecord.created_at)
      : null;
    if (
      (cursorRecord.active_rank !== 0 && cursorRecord.active_rank !== 1) ||
      createdAt === null ||
      Number.isNaN(createdAt.getTime()) ||
      typeof cursorRecord.id !== 'string' ||
      !isUuid(cursorRecord.id)
    ) {
      throw new Error('Invalid cursor values');
    }
    return { activeRank: cursorRecord.active_rank, createdAt, id: cursorRecord.id };
  } catch {
    throw new ValidationError('cursor is invalid');
  }
}

function encodeGenerationJobCursor(cursor: GenerationJobListCursor): string {
  return Buffer.from(
    JSON.stringify({
      active_rank: cursor.activeRank,
      created_at: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
    'utf8',
  ).toString('base64url');
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
