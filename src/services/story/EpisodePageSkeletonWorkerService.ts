import { ValidationError } from '../../domain/errors/index.js';
import type { AppLanguage } from '../../domain/types/language.js';
import type { EpisodePagePlanApplyResult } from '../../domain/types/page.js';
import type { PageSkeletonPersistResult } from '../../domain/types/storyAi.js';
import type {
  EpisodePageSkeletonExecutionRepository,
} from '../../repositories/EpisodePageSkeletonExecutionRepository.js';
import type { GenerationJobCancellationCheckpointPort } from '../../repositories/GenerationJobRepository.js';
import { sanitizePersistedErrorMessage } from '../../lib/errorSanitizer.js';
import type {
  EpisodePagePlanProgress,
  EpisodePagePlanExecutionControl,
  PageServicePort,
} from '../page/PageService.js';
import type {
  PageSkeletonServicePort,
} from './PageSkeletonService.js';

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
    private readonly pageService?: PageServicePort,
    private readonly cancellationCheckpoint?: GenerationJobCancellationCheckpointPort,
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
    const applyStoryPlan = readBooleanParam(job.params, 'apply_story_plan');
    if (
      episodeId === null ||
      language === null ||
      overwriteExisting === null ||
      applyStoryPlan === null
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

      const prepareSkeleton = this.pageSkeletonService.prepareForEpisode;
      const persistSkeleton = this.pageSkeletonService.persistPrepared;
      if (prepareSkeleton === undefined || persistSkeleton === undefined) {
        throw new ValidationError('Atomic page skeleton preparation is not configured');
      }
      const preparedSkeleton = await prepareSkeleton.call(
        this.pageSkeletonService,
        job.userId,
        episodeId,
        {
          overwriteExisting,
          language,
          allowCompilerFallback: false,
        },
        job.organizationId,
      );

      if (await this.finalizeCancellationIfRequested(job.id)) {
        return { status: 'processed', jobStatus: 'cancelled' };
      }

      let storyPlanResult: EpisodePagePlanApplyResult | null = null;
      let result: PageSkeletonPersistResult;
      if (applyStoryPlan) {
        const prepareStoryPlan = this.pageService?.prepareEpisodePlanForSkeleton;
        const commitCombinedPlan = this.pageService?.commitPreparedEpisodeSkeletonPlan;
        if (prepareStoryPlan === undefined || commitCombinedPlan === undefined) {
          throw new ValidationError('Atomic story plan autofill is not configured');
        }

        await this.recordProgress(job.id, job.userId, {
          stage: 'applying_story_plan',
          message: 'Applying story plan to pages and panels. This process can take around 20 minutes.',
        });
        const preparedPlan = await prepareStoryPlan.call(
          this.pageService,
          job.userId,
          episodeId,
          preparedSkeleton,
          language,
          async (progress) => {
            if (await this.finalizeCancellationIfRequested(job.id)) {
              throw new ProcessingCancellationRequestedError();
            }
            await this.recordEpisodePlanProgress(job.id, job.userId, progress);
          },
          job.organizationId,
        );
        if (await this.finalizeCancellationIfRequested(job.id)) {
          return { status: 'processed', jobStatus: 'cancelled' };
        }
        const committed = await commitCombinedPlan.call(
          this.pageService,
          job.userId,
          preparedSkeleton,
          preparedPlan,
          overwriteExisting,
          job.organizationId ?? null,
          this.createExecutionControl(job.id, job.userId),
        );
        result = committed.skeletonResult;
        storyPlanResult = committed.storyPlanResult;
      } else {
        const executionControl = this.createExecutionControl(job.id, job.userId);
        await executionControl.checkpoint();
        await executionControl.beginCommit();
        result = await persistSkeleton.call(
          this.pageSkeletonService,
          job.userId,
          preparedSkeleton,
          { overwriteExisting },
          job.organizationId,
        );
      }

      const completed = await this.repository.completeEpisodePageSkeleton({
        jobId: job.id,
        userId: job.userId,
        result,
        storyPlanApplied: applyStoryPlan,
        storyPlanResult,
      });
      if (!completed) {
        if (await this.finalizeCancellationIfRequested(job.id)) {
          return { status: 'processed', jobStatus: 'cancelled' };
        }
        throw new ValidationError('Failed to persist episode page skeleton result');
      }
      console.info('episode_page_skeleton_completed', {
        jobId: job.id,
        userId: job.userId,
        episodeId,
        pagesCreated: result.pagesCreated,
        panelsCreated: result.panelsCreated,
        storyPlanApplied: applyStoryPlan,
      });
      return { status: 'processed', jobStatus: 'completed' };
    } catch (error) {
      if (error instanceof ProcessingCancellationRequestedError) {
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
    return this.cancellationCheckpoint?.finalizeCancellationIfRequested(jobId) ?? false;
  }

  private createExecutionControl(
    jobId: string,
    userId: string,
  ): EpisodePagePlanExecutionControl {
    return {
      checkpoint: async () => {
        if (await this.finalizeCancellationIfRequested(jobId)) {
          throw new ProcessingCancellationRequestedError();
        }
      },
      beginCommit: async () => {
        const beginCommit = this.repository.beginEpisodePageSkeletonCommit;
        if (beginCommit === undefined) {
          throw new ValidationError('Page skeleton commit gate is not configured');
        }
        if (await beginCommit.call(this.repository, jobId, userId)) {
          return;
        }
        if (await this.finalizeCancellationIfRequested(jobId)) {
          throw new ProcessingCancellationRequestedError();
        }
        throw new ValidationError('Page skeleton could not enter the save phase');
      },
    };
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

  private async recordEpisodePlanProgress(
    jobId: string,
    userId: string,
    progress: EpisodePagePlanProgress,
  ): Promise<void> {
    try {
      await this.repository.updateEpisodePageSkeletonProgress({
        jobId,
        userId,
        stage: progress.stage,
        message: progress.message,
        currentChunk: progress.currentChunk,
        totalChunks: progress.totalChunks,
      });
    } catch (error) {
      console.warn('episode_page_skeleton_progress_update_failed', {
        jobId,
        reason: sanitizePersistedErrorMessage(error, 'Progress update failed'),
      });
    }
  }

}

class ProcessingCancellationRequestedError extends Error {}

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
