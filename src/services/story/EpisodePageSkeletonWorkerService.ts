import { ConfigurationError } from '../../domain/errors/index.js';
import type { AppLanguage } from '../../domain/types/language.js';
import type {
  EpisodePageSkeletonExecutionRepository,
} from '../../repositories/EpisodePageSkeletonExecutionRepository.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';
import type { PageServicePort } from '../page/PageService.js';
import type { PageSkeletonServicePort } from './PageSkeletonService.js';
import type {
  GenerationJobCancellationControlRepository,
} from '../../repositories/GenerationJobRepository.js';

export interface ProcessEpisodePageSkeletonJobResult {
  status: 'processed' | 'skipped';
  jobStatus?: 'completed' | 'failed' | 'cancelled';
}

export interface EpisodePageSkeletonWorkerPort {
  processJob(jobId: string): Promise<ProcessEpisodePageSkeletonJobResult>;
}

export class EpisodePageSkeletonWorkerService implements EpisodePageSkeletonWorkerPort {
  public constructor(
    private readonly repository: EpisodePageSkeletonExecutionRepository,
    private readonly pageSkeletonService: PageSkeletonServicePort,
    _pageService?: PageServicePort,
    private readonly cancellationControl?: GenerationJobCancellationControlRepository,
  ) {}

  public async processJob(jobId: string): Promise<ProcessEpisodePageSkeletonJobResult> {
    const job = await this.repository.claimQueuedEpisodePageSkeletonJob(jobId);
    if (job === null) {
      return { status: 'skipped' };
    }
    if (await this.finalizeCancellationIfRequested(job.id)) {
      return { status: 'processed', jobStatus: 'cancelled' };
    }

    const episodeId = readStringParam(job.params, 'episode_id');
    const language = readLanguageParam(job.params, 'language');
    const overwriteExisting = readBooleanParam(job.params, 'overwrite_existing');
    if (
      episodeId === null ||
      language === null ||
      overwriteExisting === null
    ) {
      await this.repository.failEpisodePageSkeleton({
        jobId: job.id,
        userId: job.userId,
        errorMessage: 'Episode page skeleton job is missing required params',
      });
      return { status: 'processed', jobStatus: 'failed' };
    }

    try {
      await this.recordProgress(job.id, job.userId, {
        stage: 'started',
        message: 'Generating page skeleton. This process can take around 20 minutes.',
      });
      console.info('episode_page_skeleton_started', {
        jobId: job.id,
        userId: job.userId,
        episodeId,
      });

      const preparation = await this.pageSkeletonService.prepareForEpisode(job.userId, episodeId, {
        overwriteExisting,
        language,
        allowCompilerFallback: false,
      }, job.organizationId);
      if (await this.finalizeCancellationIfRequested(job.id)) {
        return { status: 'processed', jobStatus: 'cancelled' };
      }
      if (!(await this.beginCommit(job.id))) {
        return { status: 'processed', jobStatus: 'cancelled' };
      }
      const result = await this.pageSkeletonService.persistPreparedForEpisode(preparation);

      // Old queued apply_story_plan=true jobs also remain skeleton-only.
      const completed = await this.repository.completeEpisodePageSkeleton({
        jobId: job.id,
        userId: job.userId,
        result,
        storyPlanApplied: false,
        storyPlanResult: null,
      });
      if (!completed) {
        throw new ConfigurationError('Page skeleton terminal state could not be committed');
      }
      console.info('episode_page_skeleton_completed', {
        jobId: job.id,
        userId: job.userId,
        episodeId,
        pagesCreated: result.pagesCreated,
        panelsCreated: result.panelsCreated,
        storyPlanApplied: false,
      });
      return { status: 'processed', jobStatus: 'completed' };
    } catch (error) {
      if (await this.finalizeCancellationIfRequested(job.id)) {
        return { status: 'processed', jobStatus: 'cancelled' };
      }
      console.warn('episode_page_skeleton_failed', {
        jobId: job.id,
        userId: job.userId,
        episodeId,
        reason: sanitizePersistedErrorMessage(error, 'Episode page skeleton failed'),
      });
      await this.repository.failEpisodePageSkeleton({
        jobId: job.id,
        userId: job.userId,
        errorMessage: sanitizePersistedErrorMessage(error, 'Episode page skeleton failed'),
      });
      return { status: 'processed', jobStatus: 'failed' };
    }
  }

  private async finalizeCancellationIfRequested(jobId: string): Promise<boolean> {
    return this.cancellationControl?.finalizeCancellation(jobId) ?? false;
  }

  private async beginCommit(jobId: string): Promise<boolean> {
    if (this.cancellationControl === undefined) {
      return true;
    }
    if (await this.cancellationControl.beginCommit(jobId)) {
      return true;
    }
    if (await this.cancellationControl.finalizeCancellation(jobId)) {
      return false;
    }
    throw new ConfigurationError('Page skeleton commit gate could not be acquired');
  }

  private async recordProgress(
    jobId: string,
    userId: string,
    progress: { stage: string; message: string },
  ): Promise<void> {
    try {
      await this.repository.updateEpisodePageSkeletonProgress({
        jobId,
        userId,
        stage: progress.stage,
        message: progress.message,
      });
    } catch (error) {
      console.warn('episode_page_skeleton_progress_update_failed', {
        jobId,
        reason: sanitizePersistedErrorMessage(error, 'Progress update failed'),
      });
    }
  }
}

function readStringParam(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readLanguageParam(params: Record<string, unknown>, key: string): AppLanguage | null {
  const value = params[key];
  return value === 'ja' || value === 'en' ? value : null;
}

function readBooleanParam(params: Record<string, unknown>, key: string): boolean | null {
  const value = params[key];
  return typeof value === 'boolean' ? value : null;
}
